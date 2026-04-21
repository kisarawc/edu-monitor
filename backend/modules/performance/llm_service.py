"""
LLM Service for Ollama Integration
Provides streaming text generation and chat completion via Ollama instance.
Supports both local and remote Ollama (e.g., Camber GPU cloud).
Gracefully handles cases when Ollama is not installed or running.
"""
import os
import requests
import json
import logging
from typing import Generator, List, Dict, Optional

# Configure logging
logger = logging.getLogger(__name__)

# Ollama connection — configurable via environment variable
# Local: http://localhost:11434 (default)
# Remote (Camber): set OLLAMA_BASE_URL in .env to your Camber endpoint
OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
DEFAULT_MODEL = os.environ.get("OLLAMA_MODEL", "llama3-it")

# Context window configuration
# Local (16GB RAM): 8192 tokens (safe default, ~600MB KV cache)
# Camber GPU (24GB VRAM): set OLLAMA_NUM_CTX=16384 or higher in .env
DEFAULT_NUM_CTX = int(os.environ.get("OLLAMA_NUM_CTX", "8192"))


def estimate_tokens(text: str) -> int:
    """Rough token count estimate for Llama models (~4 chars per token)."""
    return len(text) // 4 if text else 0

# Remove global flag that permanently disabled Ollama
# _ollama_available = None

def check_ollama_connection() -> bool:
    """Check if Ollama is running and accessible."""
    try:
        response = requests.get(f"{OLLAMA_BASE_URL}/api/tags", timeout=1)
        return response.status_code == 200
    except (requests.exceptions.ConnectionError, requests.exceptions.Timeout, requests.exceptions.RequestException):
        logger.warning("⚠️ Cannot connect to Ollama. Ensure it is running (ollama serve).")
        return False

def is_ollama_available() -> bool:
    """Check if Ollama is available."""
    return check_ollama_connection()


def get_available_models() -> List[str]:
    """Get list of available models in Ollama."""
    if not is_ollama_available():
        return []
    try:
        response = requests.get(f"{OLLAMA_BASE_URL}/api/tags", timeout=3)
        if response.status_code == 200:
            data = response.json()
            models = [model["name"] for model in data.get("models", [])]
            logger.info(f"Available Ollama models: {models}")
            return models
        return []
    except requests.exceptions.RequestException:
        return []


def generate_streaming(
    prompt: str,
    model: str = DEFAULT_MODEL,
    system_prompt: Optional[str] = None,
    temperature: float = 0.7,
    max_tokens: int = 2048,
    num_ctx: int = DEFAULT_NUM_CTX
) -> Generator[str, None, None]:
    """
    Generate text with streaming response from Ollama.
    Yields text chunks as they arrive.
    Returns a graceful error message if Ollama is not available.
    """
    if not is_ollama_available():
        yield "[Ollama LLM is not available. Please install Ollama and run: ollama run llama3-it]"
        return

    url = f"{OLLAMA_BASE_URL}/api/generate"
    
    # Log token usage for debugging
    prompt_tokens = estimate_tokens(prompt)
    system_tokens = estimate_tokens(system_prompt) if system_prompt else 0
    total_input = prompt_tokens + system_tokens
    logger.info(f"LLM call: ~{total_input} input tokens, num_ctx={num_ctx}, max_output={max_tokens}")
    
    if total_input + max_tokens > num_ctx:
        logger.warning(
            f"⚠️ Token budget may overflow: input({total_input}) + output({max_tokens}) "
            f"= {total_input + max_tokens} > num_ctx({num_ctx})"
        )
    
    # Try with progressively smaller context windows if memory is insufficient
    ctx_sizes_to_try = [num_ctx]
    for fallback in [4096, 2048]:
        if fallback < num_ctx and fallback not in ctx_sizes_to_try:
            ctx_sizes_to_try.append(fallback)
    
    last_error = None
    for try_ctx in ctx_sizes_to_try:
        payload = {
            "model": model,
            "prompt": prompt,
            "stream": True,
            "options": {
                "temperature": temperature,
                "num_predict": max_tokens,
                "num_ctx": try_ctx
            }
        }
        
        if system_prompt:
            payload["system"] = system_prompt
        
        try:
            with requests.post(url, json=payload, stream=True, timeout=300) as response:
                if response.status_code == 500:
                    # Read error body to check if it's a memory issue
                    error_body = response.text
                    if "memory" in error_body.lower() or "system memory" in error_body.lower():
                        logger.warning(
                            f"⚠️ Ollama out of memory with num_ctx={try_ctx}. "
                            f"Error: {error_body.strip()}"
                        )
                        if try_ctx > ctx_sizes_to_try[-1]:
                            logger.info(f"Retrying with smaller context window...")
                            last_error = error_body.strip()
                            continue
                        else:
                            yield (
                                f"[Out of memory: your system doesn't have enough free RAM "
                                f"to load the model. Close some applications and try again. "
                                f"Ollama says: {error_body.strip()}]"
                            )
                            return
                    else:
                        # Non-memory 500 error
                        logger.error(f"Ollama 500 error: {error_body.strip()}")
                        yield f"[Ollama server error: {error_body.strip()}]"
                        return
                
                response.raise_for_status()
                
                if try_ctx != num_ctx:
                    logger.info(f"✅ Successfully using fallback num_ctx={try_ctx}")
                
                for line in response.iter_lines():
                    if line:
                        try:
                            data = json.loads(line)
                            if "response" in data:
                                yield data["response"]
                            if data.get("done", False):
                                break
                        except json.JSONDecodeError:
                            continue
                return  # Success — exit the retry loop
                
        except requests.exceptions.ConnectionError:
            logger.warning("Lost connection to Ollama during generation")
            yield "[Connection to Ollama lost. Please check if it's still running.]"
            return
        except requests.exceptions.Timeout:
            logger.warning("Ollama request timed out")
            yield "[Request timed out. The model may be loading or overloaded.]"
            return
        except requests.exceptions.HTTPError as e:
            if e.response and e.response.status_code == 500:
                # Already handled above in most cases, but catch edge cases
                last_error = str(e)
                continue
            logger.error(f"Ollama request error: {e}")
            yield f"[Error connecting to Ollama: {str(e)}]"
            return
        except requests.exceptions.RequestException as e:
            logger.error(f"Ollama request error: {e}")
            yield f"[Error connecting to Ollama: {str(e)}]"
            return
    
    # All retries failed
    yield f"[All context sizes failed. Last error: {last_error}. Please free up RAM and try again.]"


def generate_complete(
    prompt: str,
    model: str = DEFAULT_MODEL,
    system_prompt: Optional[str] = None,
    temperature: float = 0.7,
    max_tokens: int = 2048,
    num_ctx: int = DEFAULT_NUM_CTX
) -> str:
    """
    Generate text and return complete response (non-streaming).
    Returns empty string if Ollama is not available.
    """
    if not is_ollama_available():
        logger.info("Skipping LLM generation - Ollama not available")
        return ""
    
    chunks = list(generate_streaming(prompt, model, system_prompt, temperature, max_tokens, num_ctx))
    result = "".join(chunks)
    
    # Check if result is an error message generated by generate_streaming
    if result.startswith("[Error") or result.startswith("[Connection") or result.startswith("[Request timed out") or result.startswith("[Ollama LLM is not available"):
        if not result.startswith("[{"): # Don't accidentally match JSON arrays
            return ""
    
    return result


def chat_streaming(
    messages: List[Dict[str, str]],
    model: str = DEFAULT_MODEL,
    temperature: float = 0.7
) -> Generator[str, None, None]:
    """
    Chat completion with streaming response.
    Messages format: [{"role": "user"|"assistant"|"system", "content": "..."}]
    """
    if not is_ollama_available():
        yield "[Ollama LLM is not available. Please install and run Ollama.]"
        return

    url = f"{OLLAMA_BASE_URL}/api/chat"
    
    payload = {
        "model": model,
        "messages": messages,
        "stream": True,
        "options": {
            "temperature": temperature
        }
    }
    
    try:
        with requests.post(url, json=payload, stream=True, timeout=120) as response:
            response.raise_for_status()
            for line in response.iter_lines():
                if line:
                    try:
                        data = json.loads(line)
                        if "message" in data and "content" in data["message"]:
                            yield data["message"]["content"]
                        if data.get("done", False):
                            break
                    except json.JSONDecodeError:
                        continue
    except requests.exceptions.RequestException as e:
        logger.error(f"Ollama chat error: {e}")
        yield f"[Error connecting to Ollama: {str(e)}]"


# RAG Prompt Templates
SUMMARY_SYSTEM_PROMPT = """You are an educational assistant that creates clear, concise summaries of lecture content.
Your summaries should:
- Highlight key concepts and main ideas
- Be well-organized with clear structure
- Use simple language accessible to students
- Include important definitions and examples mentioned"""

SUMMARY_PROMPT_TEMPLATE = """Based on the following lecture content, provide a comprehensive summary for students:

LECTURE CONTENT:
{context}

Please provide a well-structured summary covering the main topics and key points."""

QA_SYSTEM_PROMPT = """You are an expert teaching assistant helping students learn from a lecture.
Your primary job is to answer the student's question by extracting information directly from the provided lecture transcript.
You must focus heavily on the provided text. Only use outside knowledge to explain or clarify what was said in the transcript.
If the answer cannot be deduced from the transcript, politely state that it was not covered in the lecture."""

QA_PROMPT_TEMPLATE = """Use the following lecture transcript to answer the student's question. Focus closely on what the teacher actually said.
If you need to use outside knowledge to explain a concept from the transcript, clearly relate it back to the transcript.
If the answer is completely missing from the transcript, acknowledge that before optionally providing general guidance.

--- LECTURE TRANSCRIPT ---
{context}
--------------------------

STUDENT QUESTION: {question}

Please provide a helpful, educational answer:"""

FILTER_SYSTEM_PROMPT = """You are a transcript processor. Your job is to:
1. Remove filler words (um, uh, like, you know, so, basically, etc.)
2. Fix grammar and sentence structure
3. Extract the meaningful educational content
4. Maintain the original meaning and key explanations
5. Return ONLY the cleaned, coherent text - no commentary"""

FILTER_PROMPT_TEMPLATE = """Clean the following raw speech transcript. Remove filler words, fix grammar, and extract only the meaningful educational content:

RAW TRANSCRIPT:
{transcript}

CLEANED CONTENT:"""


def generate_summary(context: str, model: str = DEFAULT_MODEL) -> Generator[str, None, None]:
    """Generate a streaming summary of lecture content."""
    if not is_ollama_available():
        yield "[Summary generation requires Ollama LLM. Please install and run Ollama.]"
        return
    prompt = SUMMARY_PROMPT_TEMPLATE.format(context=context)
    yield from generate_streaming(prompt, model, SUMMARY_SYSTEM_PROMPT, temperature=0.5)


def answer_question(context: str, question: str, model: str = DEFAULT_MODEL) -> Generator[str, None, None]:
    """Answer a question based on lecture content with streaming response."""
    if not is_ollama_available():
        yield "[Q&A requires Ollama LLM. Please install and run Ollama to use this feature.]"
        return
    prompt = QA_PROMPT_TEMPLATE.format(context=context, question=question)
    yield from generate_streaming(prompt, model, QA_SYSTEM_PROMPT, temperature=0.3)


def filter_transcript(raw_transcript: str, model: str = DEFAULT_MODEL) -> str:
    """Filter raw transcript to extract meaningful content (non-streaming for processing)."""
    if not is_ollama_available():
        # Return empty to fall back to regex-based filtering
        logger.info("LLM not available for transcript filtering, using regex fallback")
        return ""
    prompt = FILTER_PROMPT_TEMPLATE.format(transcript=raw_transcript)
    return generate_complete(prompt, model, FILTER_SYSTEM_PROMPT, temperature=0.2, max_tokens=1024)


# Log initial Ollama status at module load
def _init_check():
    """Check Ollama availability on module load."""
    logger.info("Checking Ollama LLM availability...")
    check_ollama_connection()

# Don't block on startup - check lazily
