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
SUMMARY_SYSTEM_PROMPT = """You are an educational assistant that creates clear, structured summaries of lecture content.
You receive TWO types of content:
1. LECTURE SLIDES — the official slide material
2. LIVE LECTURE SPEECH — what the teacher actually said during the lecture (transcribed)

Your summaries MUST:
- Cover key concepts from BOTH the slides AND the live speech
- Highlight important points the teacher mentioned verbally that are NOT in the slides (these are often the most valuable for students who missed part of the lecture)
- Be well-organized with clear headings
- Use simple language accessible to students
- ONLY include information from the provided content — do NOT add external knowledge"""

SUMMARY_PROMPT_TEMPLATE = """Based on the following lecture content, provide a comprehensive summary for students.
Pay special attention to things the teacher said in the live speech that go beyond what's in the slides — students need to catch those details.

{context}

Please provide a well-structured summary with these sections:
1. **Key Concepts** — main topics and definitions from slides and lecture
2. **Important Details from Lecture** — things the teacher explained verbally (examples, clarifications, tips)
3. **Key Takeaways** — the most important points students should remember"""

QUICK_SUMMARY_PROMPT_TEMPLATE = """Based on the following lecture content, provide a QUICK, high-level overview for students.
Keep it brief and focus only on the core message.

{context}

Please provide a short summary with:
- A 2-3 sentence overview of the lecture
- A bulleted list of the 3-5 most important points covered (from slides or speech)"""

QA_SYSTEM_PROMPT = """You are a lecture assistant. Give SHORT, DIRECT answers only.

STRICT RULES:
- Answer in 2-4 sentences maximum
- Do NOT explain your reasoning or thinking process
- Do NOT say "Let's analyze" or "Step by step" — just give the answer
- ONLY use information from the provided lecture content
- If the answer is NOT in the content, say "This was not covered in the lecture."
- Do NOT add information from outside the lecture content"""

QA_PROMPT_TEMPLATE = """LECTURE CONTENT:
{context}

QUESTION: {question}

Give a SHORT, DIRECT answer (2-4 sentences max) using ONLY the lecture content above. No analysis, no reasoning — just the answer."""

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


def generate_summary(context: str, summary_type: str = "advanced", model: str = DEFAULT_MODEL) -> Generator[str, None, None]:
    """Generate a streaming summary of lecture content."""
    if not is_ollama_available():
        yield "[Summary generation requires Ollama LLM. Please install and run Ollama.]"
        return
        
    if summary_type == "quick":
        prompt = QUICK_SUMMARY_PROMPT_TEMPLATE.format(context=context)
        # Lower max_tokens for quicker generation
        yield from generate_streaming(prompt, model, SUMMARY_SYSTEM_PROMPT, temperature=0.3, max_tokens=600)
    else:
        prompt = SUMMARY_PROMPT_TEMPLATE.format(context=context)
        yield from generate_streaming(prompt, model, SUMMARY_SYSTEM_PROMPT, temperature=0.5)


def answer_question(context: str, question: str, model: str = DEFAULT_MODEL) -> Generator[str, None, None]:
    """Answer a question based on lecture content with streaming response."""
    if not is_ollama_available():
        yield "[Q&A requires Ollama LLM. Please install and run Ollama to use this feature.]"
        return
    prompt = QA_PROMPT_TEMPLATE.format(context=context, question=question)
    yield from generate_streaming(prompt, model, QA_SYSTEM_PROMPT, temperature=0.1, max_tokens=512)


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
