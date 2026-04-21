"""
Local Speech-to-Text using Faster Whisper

Runs Whisper model locally on CPU for accurate transcription.
Model is loaded once and stays in memory for fast repeated transcription.
"""

import io
import os
import wave
import logging
import tempfile
from typing import Optional

logger = logging.getLogger(__name__)

# Global model instance (loaded once, reused)
_model = None
_model_loading = False


def get_whisper_model():
    """
    Get or initialize the Faster Whisper model.
    Uses 'small' model for good accuracy/speed balance on CPU.
    Downloads ~500MB on first run, then cached locally.
    """
    global _model, _model_loading

    if _model is not None:
        return _model

    if _model_loading:
        return None

    _model_loading = True
    try:
        from faster_whisper import WhisperModel

        model_size = os.environ.get("WHISPER_MODEL_SIZE", "small")
        
        # Check for GPU availability (torch is optional)
        has_gpu = False
        try:
            import torch
            has_gpu = torch.cuda.is_available()
        except ImportError:
            logger.info("PyTorch not installed — defaulting to CPU inference")
        
        device_type = "cuda" if has_gpu else "cpu"
        compute_type = "float16" if has_gpu else "int8"
        
        logger.info(f"Loading Faster Whisper model '{model_size}' on {device_type.upper()} (compute: {compute_type})...")

        _model = WhisperModel(
            model_size,
            device=device_type,
            compute_type=compute_type,
            cpu_threads=4 if not has_gpu else 0,
        )

        logger.info(f"✅ Faster Whisper model '{model_size}' loaded successfully")
        return _model

    except Exception as e:
        logger.error(f"Failed to load Whisper model: {e}")
        _model_loading = False
        return None


def transcribe_audio(audio_bytes: bytes, filename: str = "audio.webm") -> Optional[str]:
    """
    Transcribe an audio file using Faster Whisper.

    Args:
        audio_bytes: Raw audio file bytes (WAV, WebM, etc.)
        filename: Original filename (used to detect format)

    Returns:
        Transcribed text string, or None on failure
    """
    model = get_whisper_model()
    if model is None:
        logger.error("Whisper model not available")
        return None

    try:
        # Write audio to a temp file (faster-whisper needs a file path)
        suffix = os.path.splitext(filename)[1] if "." in filename else ".webm"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name

        try:
            # Transcribe with maximum speed settings (greedy decoding only)
            segments, info = model.transcribe(
                tmp_path,
                language="en",
                beam_size=1,  # Pure greedy decoding is the only way to get real-time CPU speeds
                best_of=1,    # Only evaluate top candidate
                temperature=0.0,
                condition_on_previous_text=False, # Disable to prevent slow context window building
                vad_filter=True,
                vad_parameters=dict(
                    min_silence_duration_ms=200,
                    speech_pad_ms=100,
                ),
                no_speech_threshold=0.6,
                log_prob_threshold=-1.0,
            )

            # Collect all segment text
            transcript_parts = []
            for segment in segments:
                text = segment.text.strip()
                if text and not _is_hallucination(text):
                    transcript_parts.append(text)

            transcript = " ".join(transcript_parts)

            if transcript:
                logger.info(f"Transcribed {len(audio_bytes)} bytes → {len(transcript)} chars")
            else:
                logger.debug("No speech detected in audio chunk")

            return transcript if transcript else None

        finally:
            # Clean up temp file
            try:
                os.unlink(tmp_path)
            except Exception:
                pass

    except Exception as e:
        logger.error(f"Transcription error: {e}")
        return None


def _is_hallucination(text: str) -> bool:
    """
    Detect common Whisper hallucinations (repeated phrases, filler).
    """
    text_lower = text.lower().strip()
    # Common hallucination patterns
    hallucinations = [
        "thank you", "thanks for watching", "subscribe",
        "please subscribe", "like and subscribe",
        "thank you for watching", "see you next time",
        "bye", "goodbye",
    ]
    if text_lower in hallucinations:
        return True
    # Detect repeated words (e.g. "the the the the")
    words = text_lower.split()
    if len(words) >= 3 and len(set(words)) == 1:
        return True
    return False


def is_whisper_available() -> bool:
    """Check if the Whisper model is loaded and ready."""
    return _model is not None


def preload_model():
    """Pre-load the model (call during startup to avoid first-request delay)."""
    get_whisper_model()
