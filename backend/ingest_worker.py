"""
Standalone worker script for ingesting documents into ChromaDB.
Running this in a separate process avoids [WinError 6] handle conflicts
conflicts between ONNX Runtime (Chroma), PyTorch (YOLO), and TensorFlow
when they all run in the same process on Windows.
"""
import sys
import os
import json
import logging
import traceback

# Silence ONNX Runtime diagnostics immediately
os.environ["ORT_LOGGING_LEVEL"] = "3" 
os.environ["ONNXRUNTIME_QUIET"] = "1"

# Add backend directory to path so we can import modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


# Configure logging to write to stderr so parent process can capture it
logging.basicConfig(level=logging.INFO, format='%(message)s')
logger = logging.getLogger("ingest_worker")

def main():
    try:
        if len(sys.argv) < 3:
            # Errors must be in JSON format for the parser
            sys.stdout.write(json.dumps({"success": False, "error": "Missing arguments: file_path, original_filename"}))
            return


        file_path = sys.argv[1]
        original_filename = sys.argv[2]
        
        # Import here to avoid loading heavy libraries until needed
        from modules.performance.document_processor import process_document
        from modules.performance.vector_store import generate_embeddings

        # Read the temp file
        with open(file_path, 'rb') as f:
            content = f.read()
            
        # Process
        logger.info(f"Processing {original_filename} ({len(content)} bytes)...")
        chunks = process_document(content, original_filename)
        
        if not chunks:
            sys.stdout.write(json.dumps({"success": False, "error": "No text extracted"}))
            return

        # Generate embeddings in the worker process (heavy task)
        logger.info(f"Generating embeddings for {len(chunks)} chunks...")
        embeddings = generate_embeddings(chunks)
        
        # Clean up temp file
        try:
            os.remove(file_path)
        except:
            pass
            
        # Return result as JSON explicitly to stdout
        # Including chunks and embeddings so the parent process can store them
        sys.stdout.write(json.dumps({
            "success": True,
            "filename": original_filename,
            "chunks": chunks,
            "embeddings": embeddings,
            "chunks_stored": len(chunks), # legacy field for compatibility if needed
            "sample_chunk": chunks[0][:200] + "..." if chunks else None
        }))
        sys.stdout.flush()

        
    except Exception as e:
        # Capture full traceback
        tb = traceback.format_exc()
        sys.stdout.write(json.dumps({"success": False, "error": str(e), "traceback": tb}))
        sys.stdout.flush()

        sys.exit(1)

if __name__ == "__main__":
    main()
