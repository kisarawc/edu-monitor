"""
Vector Store Service using Qdrant (local persistent mode)
Handles embedding storage and similarity search for RAG.
Uses ChromaDB's built-in ONNX embedding (avoids PyTorch/sentence-transformers
thread conflicts with YOLO inference on Windows).
"""
import logging
from typing import List, Dict, Optional, Tuple
import os
import hashlib
import uuid

# Configure logging
logger = logging.getLogger(__name__)

# Initialize the embedding model (runs locally, free)
_embedding_model = None
_embedding_model_error = None

# Embedding dimension for all-MiniLM-L6-v2
EMBEDDING_DIM = 384


def get_embedding_model():
    """Lazy load the embedding model with error handling."""
    global _embedding_model, _embedding_model_error
    
    if _embedding_model_error:
        raise _embedding_model_error
    
    if _embedding_model is None:
        try:
            import os
            from sentence_transformers import SentenceTransformer
            logger.info("Loading sentence-transformers embedding model...")

            # Skip HuggingFace network check — the model is already cached
            # locally. Without this, sentence-transformers contacts HuggingFace
            # to check for updates, which hangs for 85+ seconds when the
            # servers are slow or unreachable.
            os.environ["HF_HUB_OFFLINE"] = "1"

            try:
                # Using a lightweight but effective model — forced to CPU because
                # the GPU (if any) may have limited VRAM and is not needed for
                # a 22MB embedding model. This also avoids CUDA conflicts with
                # CTranslate2 (Whisper) which manages CUDA separately.
                _embedding_model = SentenceTransformer(
                    'all-MiniLM-L6-v2', device='cpu', local_files_only=True
                )
            except OSError:
                # Model not cached yet — download it (one-time)
                logger.info("📥 Embedding model not cached — downloading from HuggingFace (one-time)...")
                os.environ.pop("HF_HUB_OFFLINE", None)
                _embedding_model = SentenceTransformer('all-MiniLM-L6-v2', device='cpu')

            # Restore so other HF components aren't affected
            os.environ.pop("HF_HUB_OFFLINE", None)
            logger.info("✅ Embedding model loaded successfully")
        except ImportError as e:
            _embedding_model_error = e
            logger.error("❌ sentence-transformers not installed. Run: pip install sentence-transformers")
            raise
        except Exception as e:
            _embedding_model_error = e
            logger.error(f"❌ Failed to load embedding model: {e}")
            raise
    
    return _embedding_model


def generate_embeddings(texts: List[str]) -> List[List[float]]:
    """Generate embeddings for a list of texts."""
    model = get_embedding_model()
    # SentenceTransformer encode returns a numpy array, convert it to list of floats for Qdrant
    embeddings = model.encode(texts)
    return embeddings.tolist()


# Qdrant client (persistent storage)
_qdrant_client = None
_qdrant_error = None
_db_path = os.path.join(os.path.dirname(__file__), "vector_db")


def get_qdrant_client():
    """Get or create Qdrant client with persistent local storage."""
    global _qdrant_client, _qdrant_error
    
    if _qdrant_error:
        raise _qdrant_error
    
    if _qdrant_client is None:
        try:
            from qdrant_client import QdrantClient
            os.makedirs(_db_path, exist_ok=True)
            _qdrant_client = QdrantClient(path=_db_path)
            logger.info(f"✅ Qdrant initialized at {_db_path}")
        except ImportError as e:
            _qdrant_error = e
            logger.error("❌ qdrant-client not installed. Run: pip install qdrant-client")
            raise
        except Exception as e:
            _qdrant_error = e
            logger.error(f"❌ Failed to initialize Qdrant: {e}")
            raise
    
    return _qdrant_client


def close_qdrant_client():
    """Close the Qdrant client to release file locks."""
    global _qdrant_client
    if _qdrant_client is not None:
        try:
            _qdrant_client.close()
            logger.info("✅ Qdrant client closed")
        except Exception as e:
            logger.error(f"Failed to close Qdrant client: {e}")
        finally:
            _qdrant_client = None


def _ensure_collection(collection_name: str = "lecture_content"):
    """Ensure a collection exists, create it if it doesn't."""
    from qdrant_client.models import Distance, VectorParams
    
    client = get_qdrant_client()
    
    # Check if collection exists
    existing = [c.name for c in client.get_collections().collections]
    if collection_name not in existing:
        client.create_collection(
            collection_name=collection_name,
            vectors_config=VectorParams(
                size=EMBEDDING_DIM,
                distance=Distance.COSINE,
            ),
        )
        logger.info(f"Created Qdrant collection: {collection_name}")
    
    return collection_name


def generate_doc_id(text: str, source: str) -> str:
    """Generate a unique document ID based on content hash."""
    content = f"{source}:{text[:100]}"
    return hashlib.md5(content.encode()).hexdigest()


def generate_embeddings(texts: List[str]) -> List[List[float]]:
    """Generate embeddings for a list of texts using sentence-transformers."""
    model = get_embedding_model()
    embeddings = model.encode(texts, convert_to_numpy=True)
    return embeddings.tolist()


def _md5_to_uuid(md5_hex: str) -> str:
    """Convert an MD5 hex string to a valid UUID string for Qdrant."""
    return str(uuid.UUID(md5_hex))


def add_documents(
    texts: List[str],
    source: str = "unknown",
    collection_name: str = "lecture_content",
    metadata: Optional[Dict] = None
) -> int:
    """
    Add documents to the vector store.
    
    ChromaDB will automatically generate embeddings using its built-in
    ONNX embedding function (no PyTorch/sentence-transformers needed).
    
    Args:
        texts: List of text chunks to store
        source: Source identifier (e.g., "slides", "transcript")
        collection_name: Name of the collection
        metadata: Additional metadata to store
    
    Returns:
        Number of documents added
    """
    if not texts:
        return 0
    
    try:
        from qdrant_client.models import PointStruct
        
        _ensure_collection(collection_name)
        client = get_qdrant_client()
        
        # Generate embeddings
        logger.debug(f"Generating embeddings for {len(texts)} texts")
        embeddings = generate_embeddings(texts)
        
        # Prepare points
        points = []
        for i, (text, embedding) in enumerate(zip(texts, embeddings)):
            doc_id = generate_doc_id(text, source)
            point_id = _md5_to_uuid(doc_id)
            
            payload = {
                "document": text,
                "source": source,
                "chunk_index": i,
                **(metadata or {})
            }
            
            points.append(PointStruct(
                id=point_id,
                vector=embedding,
                payload=payload,
            ))
        
        # Upsert to collection
        client.upsert(
            collection_name=collection_name,
            points=points,
        )
        
        logger.info(f"Added {len(texts)} documents to vector store (source: {source})")
        return len(texts)
    
    except Exception as e:
        logger.error(f"Failed to add documents: {e}")
        raise


def add_points_with_embeddings(
    texts: List[str],
    embeddings: List[List[float]],
    source: str = "unknown",
    collection_name: str = "lecture_content",
    metadata: Optional[Dict] = None
) -> int:
    """
    Add documents with pre-computed embeddings to the vector store.
    Used by the ingestion process to avoid lock conflicts.
    """
    if not texts or not embeddings or len(texts) != len(embeddings):
        logger.error(f"Invalid input: {len(texts)} texts, {len(embeddings)} embeddings")
        return 0
    
    try:
        from qdrant_client.models import PointStruct
        
        _ensure_collection(collection_name)
        client = get_qdrant_client()
        
        # Prepare points
        points = []
        for i, (text, embedding) in enumerate(zip(texts, embeddings)):
            doc_id = generate_doc_id(text, source)
            point_id = _md5_to_uuid(doc_id)
            
            payload = {
                "document": text,
                "source": source,
                "chunk_index": i,
                **(metadata or {})
            }
            
            points.append(PointStruct(
                id=point_id,
                vector=embedding,
                payload=payload,
            ))
        
        # Upsert to collection
        client.upsert(
            collection_name=collection_name,
            points=points,
        )
        
        logger.info(f"Added {len(texts)} documents with pre-computed embeddings (source: {source})")
        return len(texts)
    
    except Exception as e:
        logger.error(f"Failed to add points with embeddings: {e}")
        raise


def search_similar(
    query: str,
    n_results: int = 5,
    collection_name: str = "lecture_content",
    source_filter: Optional[str] = None
) -> List[Tuple[str, float, Dict]]:
    """
    Search for similar documents.
    Uses ChromaDB's built-in embedding for the query as well.
    
    Args:
        query: Search query
        n_results: Number of results to return
        collection_name: Name of the collection
        source_filter: Optional filter by source type
    
    Returns:
        List of (document, distance, metadata) tuples
    """
    try:
        from qdrant_client.models import Filter, FieldCondition, MatchValue
        
        _ensure_collection(collection_name)
        client = get_qdrant_client()
        
        # Generate query embedding
        query_embedding = generate_embeddings([query])[0]
        
        # Build filter
        query_filter = None
        if source_filter:
            query_filter = Filter(
                must=[
                    FieldCondition(
                        key="source",
                        match=MatchValue(value=source_filter),
                    )
                ]
            )
        
        # Search
        results = client.query_points(
            collection_name=collection_name,
            query=query_embedding,
            query_filter=query_filter,
            limit=n_results,
            with_payload=True,
        )
        
        # Format results
        output = []
        for point in results.points:
            doc = point.payload.get("document", "")
            score = point.score
            # Build metadata dict (everything except "document")
            meta = {k: v for k, v in point.payload.items() if k != "document"}
            # Convert score to distance (cosine similarity → distance)
            distance = 1.0 - score
            output.append((doc, distance, meta))
        
        logger.debug(f"Search returned {len(output)} results for query: {query[:50]}...")
        return output
    
    except Exception as e:
        logger.error(f"Search failed: {e}")
        return []


def get_all_content(
    collection_name: str = "lecture_content",
    limit: int = 100
) -> List[Dict]:
    """Get all documents from a collection with metadata."""
    try:
        _ensure_collection(collection_name)
        client = get_qdrant_client()
        
        results, _ = client.scroll(
            collection_name=collection_name,
            limit=limit,
            with_payload=True,
        )
        
        docs = []
        for point in results:
            payload = point.payload or {}
            docs.append({
                "id": str(point.id),
                "text": payload.get("document", ""),
                "source": payload.get("source", "unknown"),
                "metadata": {k: v for k, v in payload.items() if k != "document"},
            })
        return docs
    
    except Exception as e:
        logger.error(f"Failed to get content: {e}")
        return []


def get_collection_stats(collection_name: str = "lecture_content") -> Dict:
    """Get statistics about a collection."""
    try:
        _ensure_collection(collection_name)
        client = get_qdrant_client()
        info = client.get_collection(collection_name)
        
        return {
            "name": collection_name,
            "document_count": info.points_count,
        }
    except Exception as e:
        logger.warning(f"Failed to get stats: {e}")
        return {
            "name": collection_name,
            "document_count": 0,
            "error": str(e)
        }


def clear_collection(collection_name: str = "lecture_content") -> bool:
    """Clear all documents from a collection."""
    try:
        client = get_qdrant_client()
        client.delete_collection(collection_name)
        logger.info(f"Cleared collection: {collection_name}")
        return True
    except Exception as e:
        logger.error(f"Failed to clear collection: {e}")
        return False


def retrieve_relevant_chunks(
    queries: List[str],
    top_k_per_query: int = 3,
    min_similarity: float = 0.3,
    max_total_chunks: int = 8,
    collection_name: str = "lecture_content",
) -> List[Dict]:
    """
    Retrieve chunks relevant to multiple queries (e.g. learning outcomes),
    deduplicated and ranked by relevance score.

    Instead of blindly fetching the first N chunks from the database,
    this function:
    1. Runs a semantic search for each query
    2. Collects results, deduplicates by document ID
    3. Filters out low-similarity matches
    4. Returns the top max_total_chunks ranked by score

    Args:
        queries: List of query strings (e.g. learning outcome texts)
        top_k_per_query: How many results to fetch per query
        min_similarity: Minimum cosine similarity threshold (0.0 to 1.0)
        max_total_chunks: Maximum total chunks to return
        collection_name: Qdrant collection name

    Returns:
        List of chunk dicts with 'text', 'source', 'score', 'metadata' keys,
        sorted by relevance (highest score first)
    """
    if not queries:
        logger.warning("retrieve_relevant_chunks called with empty queries")
        return []

    # Collect all results, dedup by document ID
    seen_ids = set()
    all_results = []

    for query in queries:
        try:
            results = search_similar(
                query=query,
                n_results=top_k_per_query,
                collection_name=collection_name,
            )

            for doc_text, distance, metadata in results:
                # Convert distance back to similarity score (cosine)
                similarity = 1.0 - distance

                # Filter by minimum similarity
                if similarity < min_similarity:
                    continue

                # Deduplicate by content hash (first 100 chars + source)
                source = metadata.get("source", "unknown")
                doc_id = f"{source}:{doc_text[:100]}"

                if doc_id in seen_ids:
                    continue
                seen_ids.add(doc_id)

                all_results.append({
                    "text": doc_text,
                    "source": source,
                    "score": similarity,
                    "metadata": metadata,
                    "matched_query": query[:80],  # for debugging
                })

        except Exception as e:
            logger.error(f"Error searching for query '{query[:50]}...': {e}")
            continue

    # Sort by relevance score (highest first)
    all_results.sort(key=lambda x: x["score"], reverse=True)

    # Cap at max_total_chunks
    selected = all_results[:max_total_chunks]

    logger.info(
        f"Smart retrieval: {len(queries)} queries → "
        f"{len(all_results)} unique matches → {len(selected)} selected "
        f"(min_sim={min_similarity}, max={max_total_chunks})"
    )

    if selected:
        scores = [r["score"] for r in selected]
        logger.info(
            f"Score range: {min(scores):.3f} to {max(scores):.3f}, "
            f"avg: {sum(scores)/len(scores):.3f}"
        )

    return selected

