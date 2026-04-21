"""
Chunk Compressor
Deduplicates, truncates, and compresses text chunks to fit within
a given token budget for LLM context windows.
"""
import logging
import re
from typing import List, Dict, Tuple

logger = logging.getLogger(__name__)


def _word_set(text: str) -> set:
    """Extract a set of lowercase words from text."""
    return set(re.findall(r'\b\w+\b', text.lower()))


def _word_overlap_ratio(text_a: str, text_b: str) -> float:
    """
    Calculate the word overlap ratio between two texts.
    Returns a value between 0.0 (no overlap) and 1.0 (identical words).
    """
    words_a = _word_set(text_a)
    words_b = _word_set(text_b)

    if not words_a or not words_b:
        return 0.0

    intersection = words_a & words_b
    smaller_set = min(len(words_a), len(words_b))

    return len(intersection) / smaller_set if smaller_set > 0 else 0.0


def estimate_tokens(text: str) -> int:
    """Rough token count estimate for Llama models (~4 chars per token)."""
    return len(text) // 4 if text else 0


def deduplicate_chunks(chunks: List[Dict], overlap_threshold: float = 0.80) -> List[Dict]:
    """
    Remove chunks that are >overlap_threshold similar to each other.
    When two chunks overlap, keeps the longer one (more information).

    Args:
        chunks: List of chunk dicts with at least a 'text' key
        overlap_threshold: Similarity threshold (0.0 to 1.0) for deduplication

    Returns:
        Deduplicated list of chunks
    """
    if len(chunks) <= 1:
        return chunks

    # Sort by text length descending so we prefer keeping longer chunks
    sorted_chunks = sorted(chunks, key=lambda c: len(c.get("text", "")), reverse=True)

    kept = []
    for chunk in sorted_chunks:
        chunk_text = chunk.get("text", "")
        is_duplicate = False

        for existing in kept:
            existing_text = existing.get("text", "")
            overlap = _word_overlap_ratio(chunk_text, existing_text)
            if overlap >= overlap_threshold:
                is_duplicate = True
                logger.debug(
                    f"Dedup: dropped chunk ({len(chunk_text)} chars, "
                    f"{overlap:.0%} overlap with existing {len(existing_text)} char chunk)"
                )
                break

        if not is_duplicate:
            kept.append(chunk)

    if len(kept) < len(chunks):
        logger.info(f"Deduplication: {len(chunks)} → {len(kept)} chunks (removed {len(chunks) - len(kept)} duplicates)")

    return kept


def truncate_chunk(text: str, max_chars: int = 500) -> str:
    """
    Truncate a chunk to max_chars, breaking at the nearest sentence boundary.

    Args:
        text: The text to truncate
        max_chars: Maximum character length

    Returns:
        Truncated text
    """
    if not text or len(text) <= max_chars:
        return text

    # Look for a sentence boundary near the cut point
    truncated = text[:max_chars]

    # Try to break at a sentence end
    sentence_ends = ['. ', '! ', '? ', '.\n', '!\n', '?\n']
    best_break = -1

    for end_char in sentence_ends:
        pos = truncated.rfind(end_char)
        if pos > max_chars * 0.5:  # Don't break too early (at least 50% of max)
            best_break = max(best_break, pos + len(end_char))

    if best_break > 0:
        return truncated[:best_break].strip()

    # Fallback: break at last space
    last_space = truncated.rfind(' ')
    if last_space > max_chars * 0.5:
        return truncated[:last_space].strip() + "..."

    return truncated.strip() + "..."


def compress_for_budget(
    chunks: List[Dict],
    token_budget: int = 4000,
    max_chars_per_chunk: int = 500,
) -> Tuple[str, int]:
    """
    Compress chunks to fit within a token budget.
    Chunks should already be sorted by relevance (highest first).

    Steps:
    1. Deduplicate overlapping chunks
    2. Truncate each chunk
    3. Greedily pack chunks until budget is exhausted

    Args:
        chunks: List of chunk dicts with 'text' key, ordered by relevance
        token_budget: Maximum tokens for the combined content
        max_chars_per_chunk: Max characters per individual chunk

    Returns:
        Tuple of (compressed_text, tokens_used)
    """
    if not chunks:
        return "", 0

    # Step 1: Deduplicate
    unique_chunks = deduplicate_chunks(chunks)

    # Step 2: Truncate each chunk
    truncated_texts = []
    for chunk in unique_chunks:
        text = chunk.get("text", "")
        truncated = truncate_chunk(text, max_chars_per_chunk)
        if truncated:
            truncated_texts.append(truncated)

    # Step 3: Greedily pack within budget
    char_budget = token_budget * 4  # ~4 chars per token
    packed = []
    chars_used = 0
    separator = "\n\n---\n\n"
    sep_len = len(separator)

    for text in truncated_texts:
        text_len = len(text)
        # Account for separator between chunks
        extra = sep_len if packed else 0

        if chars_used + extra + text_len > char_budget:
            # Try to fit a truncated version of this chunk
            remaining = char_budget - chars_used - extra
            if remaining > 200:  # Only worth including if >200 chars
                partial = truncate_chunk(text, remaining)
                packed.append(partial)
                chars_used += extra + len(partial)
            break

        packed.append(text)
        chars_used += extra + text_len

    combined = separator.join(packed)
    tokens_used = estimate_tokens(combined)

    logger.info(
        f"Compression: {len(chunks)} chunks → {len(packed)} packed, "
        f"~{tokens_used} tokens used (budget: {token_budget})"
    )

    return combined, tokens_used
