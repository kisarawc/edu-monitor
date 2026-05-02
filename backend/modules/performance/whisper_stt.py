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
_load_error = None  # Tracks why the last load failed


def get_whisper_model():
    """
    Get or initialize the Faster Whisper model.
    Uses 'base' model by default — fast to load (~3-5s) and reliable on CPU.
    Downloads ~74MB on first run, then cached locally.

    Env-var knobs (set in .env):
      WHISPER_MODEL_SIZE   – tiny / base / small / medium / large-v2
      WHISPER_FORCE_CPU    – 1 to skip all CUDA probing (recommended for ≤4GB VRAM)
      WHISPER_CPU_THREADS  – number of CPU threads (0 = auto)

    Device / compute-type selection logic:
      1. If WHISPER_FORCE_CPU=1                                  → cpu  + int8
      2. If CUDA is available AND GPU has ≥4GB VRAM + cc ≥ 7.0   → cuda + float16
      3. If CUDA is available AND GPU has ≥4GB VRAM + cc < 7.0   → cuda + float32
      4. Otherwise (no GPU / low VRAM / no torch)                → cpu  + int8
    """
    global _model, _model_loading

    if _model is not None:
        return _model

    if _model_loading:
        logger.warning("Whisper model is still loading... please wait")
        return None

    _model_loading = True
    try:
        # ── 0. Read configuration from environment ─────────────────────
        model_size = os.environ.get("WHISPER_MODEL_SIZE", "base")
        force_cpu = os.environ.get("WHISPER_FORCE_CPU", "0").strip() == "1"
        cpu_threads = int(os.environ.get("WHISPER_CPU_THREADS", "2") or "2")

        logger.info(f"Whisper model size requested: '{model_size}'")
        if force_cpu:
            logger.info("🔧 WHISPER_FORCE_CPU=1 — skipping all GPU/CUDA detection")

        # ── 1. Check faster-whisper availability ───────────────────────
        try:
            from faster_whisper import WhisperModel
        except ImportError:
            logger.error(
                "⛔ 'faster-whisper' package is NOT installed. "
                "Install it with: pip install faster-whisper"
            )
            _model_loading = False
            return None

        # ── 2. Determine device & compute type ─────────────────────────
        device_type = "cpu"
        compute_type = "int8"

        # Hide the GPU from CTranslate2 early — BEFORE torch import —
        # so the CUDA runtime is never initialised in this process context.
        # This is the key fix: previously, torch.cuda.is_available() triggered
        # CUDA init, then setting CUDA_VISIBLE_DEVICES="" afterwards caused
        # CTranslate2 to hang for ~160s trying to reconcile stale CUDA state.
        old_cuda_visible = os.environ.get("CUDA_VISIBLE_DEVICES")

        if force_cpu:
            # Fast path: no GPU probing at all
            os.environ["CUDA_VISIBLE_DEVICES"] = ""
            device_type = "cpu"
            compute_type = "float32"
            logger.info("Using CPU + float32 inference  [WHISPER_FORCE_CPU=1]")
        else:
            # Probe GPU only when not forced to CPU
            has_gpu = False
            gpu_name = "N/A"
            compute_capability = (0, 0)

            try:
                import torch

                has_gpu = torch.cuda.is_available()
                if has_gpu:
                    gpu_name = torch.cuda.get_device_name(0)
                    compute_capability = torch.cuda.get_device_capability(0)
                    logger.info(
                        f"🖥️  GPU detected: {gpu_name} | "
                        f"Compute capability: {compute_capability[0]}.{compute_capability[1]} | "
                        f"CUDA version: {torch.version.cuda}"
                    )
                else:
                    logger.warning(
                        "⚠️  PyTorch is installed but CUDA is NOT available — "
                        "will fall back to CPU inference"
                    )
            except ImportError:
                logger.warning(
                    "⚠️  PyTorch is not installed — GPU detection skipped, "
                    "defaulting to CPU inference"
                )

            # Check VRAM threshold
            MIN_VRAM_GB = 4
            if has_gpu:
                try:
                    vram_bytes = torch.cuda.get_device_properties(0).total_memory
                    vram_gb = vram_bytes / (1024 ** 3)
                    logger.info(f"🖥️  GPU VRAM: {vram_gb:.1f} GB")
                except Exception as vram_err:
                    logger.warning(f"⚠️  Could not read VRAM: {vram_err}")
                    vram_gb = 0

                if vram_gb < MIN_VRAM_GB:
                    logger.warning(
                        f"⚠️  GPU has only {vram_gb:.1f}GB VRAM (need ≥{MIN_VRAM_GB}GB). "
                        f"Skipping CUDA — CPU + int8 will be faster for {gpu_name}"
                    )
                    has_gpu = False

            # Select device/compute based on GPU capability
            if has_gpu and compute_capability[0] >= 7:
                device_type = "cuda"
                compute_type = "float16"
                logger.info(
                    f"✅ GPU compute capability {compute_capability[0]}.{compute_capability[1]} "
                    f"supports float16 — using CUDA + float16"
                )
            elif has_gpu:
                device_type = "cuda"
                compute_type = "float32"
                logger.info(
                    f"GPU compute capability {compute_capability[0]}.{compute_capability[1]} "
                    f"— using CUDA + float32 for {gpu_name}"
                )
            else:
                device_type = "cpu"
                compute_type = "float32"
                # Hide GPU from CTranslate2 to prevent CUDA probe hang
                os.environ["CUDA_VISIBLE_DEVICES"] = ""
                logger.info("Using CPU + float32 inference")

        # ── 3. Load the model (with CUDA → CPU fallback) ──────────────
        if device_type == "cpu":
            logger.info(
                f"Set CUDA_VISIBLE_DEVICES='' to prevent CUDA probe hang"
            )

        thread_label = f"{cpu_threads} threads" if cpu_threads > 0 else "auto threads"
        logger.info(
            f"Loading Faster Whisper model '{model_size}' on "
            f"{device_type.upper()} (compute: {compute_type}, {thread_label}) ..."
        )

        import time
        load_start = time.time()

        # Tell HuggingFace Hub to never make network requests.
        # The model is already cached locally (~141MB for 'base').
        # Without this, snapshot_download() tries to contact HuggingFace
        # servers to check for updates — this hangs for 2-3+ minutes when
        # the servers are slow or unreachable, which was the REAL cause of
        # the 169s load time.
        os.environ["HF_HUB_OFFLINE"] = "1"

        try:
            _model = WhisperModel(
                model_size,
                device=device_type,
                compute_type=compute_type,
                cpu_threads=cpu_threads if device_type == "cpu" else 0,
                local_files_only=True,   # Skip network — use cached model
            )
        except Exception as load_err:
            err_msg = str(load_err).lower()

            # If the model isn't cached yet, retry WITH network to download it
            if "local_files_only" in err_msg or "does not exist" in err_msg:
                logger.info(
                    f"📥 Model '{model_size}' not in local cache — "
                    f"downloading from HuggingFace (one-time, ~{74 if model_size == 'base' else '?'}MB)..."
                )
                os.environ.pop("HF_HUB_OFFLINE", None)
                _model = WhisperModel(
                    model_size,
                    device=device_type,
                    compute_type=compute_type,
                    cpu_threads=cpu_threads if device_type == "cpu" else 0,
                    local_files_only=False,
                )
            elif device_type == "cuda":
                logger.warning(
                    f"⚠️  CUDA loading failed ({load_err}). "
                    f"Retrying on CPU + float32..."
                )
                device_type = "cpu"
                compute_type = "float32"
                os.environ["CUDA_VISIBLE_DEVICES"] = ""
                _model = WhisperModel(
                    model_size,
                    device="cpu",
                    compute_type="float32",
                    cpu_threads=cpu_threads if cpu_threads > 0 else 2,
                    local_files_only=True,
                )
            else:
                raise

        elapsed = time.time() - load_start

        # Restore CUDA_VISIBLE_DEVICES so other components aren't affected
        if old_cuda_visible is not None:
            os.environ["CUDA_VISIBLE_DEVICES"] = old_cuda_visible
        elif "CUDA_VISIBLE_DEVICES" in os.environ and device_type == "cpu":
            del os.environ["CUDA_VISIBLE_DEVICES"]

        # Remove HF_HUB_OFFLINE so other HuggingFace models can still download
        os.environ.pop("HF_HUB_OFFLINE", None)

        logger.info(
            f"✅ Faster Whisper model '{model_size}' loaded successfully "
            f"[device={device_type}, compute={compute_type}] in {elapsed:.1f}s"
        )
        return _model

    except Exception as e:
        _load_error = str(e)
        logger.critical(
            f"⛔ Failed to load Whisper model: {e}",
            exc_info=True,
        )
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
        reason = _load_error or ("still loading" if _model_loading else "unknown")
        logger.error(f"Whisper model not available — reason: {reason}")
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
