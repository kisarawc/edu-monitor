"""
Performance Module API Routes
Handles lecture content upload, transcript processing, AI-powered summarization/Q&A,
learning outcomes management, and AI quiz generation.
Gracefully handles cases when Ollama LLM is not available.
"""
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, List
from sqlalchemy.orm import Session
from database import get_db
import json
import logging
import os
import shutil
import subprocess
import sys

# Silence ONNX Runtime diagnostics
os.environ["ORT_LOGGING_LEVEL"] = "3"
os.environ["ONNXRUNTIME_QUIET"] = "1"

from .document_processor import process_document
from .vector_store import (
    add_documents,
    add_points_with_embeddings,
    search_similar,
    get_all_content,
    get_collection_stats,
    clear_collection
)
from .content_filter import filter_and_clean_transcript
from .whisper_stt import transcribe_audio, is_whisper_available
from .llm_service import (
    check_ollama_connection,
    is_ollama_available,
    generate_summary,
    answer_question,
    get_available_models
)
from .learning_outcomes import (
    extract_learning_outcomes,
    save_approved_outcomes,
    get_learning_outcomes,
    delete_learning_outcome,
    clear_all_outcomes,
)
from .quiz_service import (
    generate_quiz,
    get_all_quizzes,
    get_quiz,
    release_quiz,
    delete_quiz,
    get_released_quizzes,
    submit_quiz_response,
    get_quiz_responses,
    get_quiz_analytics,
    regenerate_quiz_question,
    update_quiz_questions
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/performance", tags=["performance"])


class TranscriptRequest(BaseModel):
    """Request body for transcript submission."""
    transcript: str
    use_llm_filter: bool = True
    skip_filter: bool = False  # When True, store transcript as-is (no filtering)


class QuestionRequest(BaseModel):
    """Request body for asking questions."""
    question: str


class StatusResponse(BaseModel):
    """Generic status response."""
    success: bool
    message: str
    data: Optional[dict] = None


class QuizGenerateRequest(BaseModel):
    """Request body for quiz generation."""
    num_questions: int = 5
    difficulty: str = "Intermediate"


class QuizAnswerItem(BaseModel):
    """Single answer in a quiz submission."""
    questionId: int
    selectedAnswer: int


class QuizSubmitRequest(BaseModel):
    """Request body for submitting quiz answers."""
    student_id: str = "anonymous"
    student_name: str = "Anonymous Student"
    answers: List[QuizAnswerItem]


class SaveOutcomesRequest(BaseModel):
    """Request body for saving teacher-approved learning outcomes."""
    outcomes: List[str]
    source_filename: str


@router.get("/health")
async def health_check():
    """Check health of the performance module and dependencies."""
    ollama_status = check_ollama_connection()
    vector_stats = get_collection_stats()
    models = get_available_models() if ollama_status else []
    
    status_message = "healthy" if ollama_status else "degraded (LLM unavailable)"
    
    return {
        "status": status_message,
        "ollama_connected": ollama_status,
        "ollama_models": models,
        "vector_store": vector_stats,
        "message": "All features available" if ollama_status else "Upload/storage works, but summary/Q&A requires Ollama LLM"
    }


@router.post("/upload", response_model=StatusResponse)
async def upload_lecture_slides(file: UploadFile = File(...)):
    """
    Upload lecture slides (PDF) for processing and storage.
    Runs in the main process (now safe since migration to Qdrant).
    """
    # Validate file type
    if not file.filename.lower().endswith(('.pdf', '.txt')):
        raise HTTPException(
            status_code=400,
            detail="Only PDF and TXT files are supported"
        )
    
    try:
        content = await file.read()
        
        # Extract text and chunk it
        chunks = process_document(content, file.filename)
        
        if not chunks:
            raise ValueError("No meaningful text could be extracted from the file.")
            
        # Store in vector database
        num_stored = add_documents(
            texts=chunks,
            source="slides",
            metadata={"filename": file.filename, "type": "lecture_slides"}
        )
        
        logger.info(f"Uploaded and stored {num_stored} chunks from {file.filename}")
        
        sample_chunk = chunks[0] if chunks else ""
        
        return StatusResponse(
            success=True,
            message=f"Successfully processed and stored {num_stored} content chunks",
            data={
                "filename": file.filename,
                "chunks_stored": num_stored,
                "sample_chunk": sample_chunk[:200] + "..." if len(sample_chunk) > 200 else sample_chunk
            }
        )

    except Exception as e:
        logger.error(f"Upload processing error: {e}")
        raise HTTPException(status_code=500, detail=f"Processing error: {str(e)}")


@router.post("/transcript", response_model=StatusResponse)
async def submit_transcript(request: TranscriptRequest):
    """
    Submit live transcript text for processing.
    Filters the transcript to extract meaningful content and stores it.
    Works without Ollama (falls back to regex-based filtering).
    """
    if not request.transcript or len(request.transcript.strip()) < 10:
        return StatusResponse(
            success=False,
            message="Transcript is too short or empty"
        )
    
    try:
        raw_text = request.transcript.strip()

        # If skip_filter is True, store the transcript directly without filtering
        if request.skip_filter:
            num_stored = add_documents(
                texts=[raw_text],
                source="transcript",
                metadata={"type": "live_speech", "llm_filtered": False, "raw": True}
            )
            logger.info(f"Stored raw transcript: {num_stored} chunks ({len(raw_text)} chars)")
            return StatusResponse(
                success=True,
                message=f"Stored {num_stored} content chunks (unfiltered)",
                data={
                    "original_length": len(raw_text),
                    "cleaned_length": len(raw_text),
                    "chunks_stored": num_stored,
                    "llm_filtered": False,
                    "preview": raw_text[:200] + "..." if len(raw_text) > 200 else raw_text
                }
            )

        # Check if LLM is available for filtering
        llm_available = is_ollama_available()
        use_llm = request.use_llm_filter and llm_available
        
        if request.use_llm_filter and not llm_available:
            logger.info("LLM not available, using regex-based transcript filtering")
        
        # Filter the transcript (works with or without LLM)
        cleaned_content = filter_and_clean_transcript(
            request.transcript,
            use_llm=use_llm
        )
        
        if not cleaned_content:
            return StatusResponse(
                success=False,
                message="No meaningful content extracted from transcript"
            )
        
        # Store in vector database
        num_stored = add_documents(
            texts=[cleaned_content],
            source="transcript",
            metadata={"type": "live_speech", "llm_filtered": use_llm}
        )
        
        logger.info(f"Stored transcript: {num_stored} chunks (LLM filter: {use_llm})")
        
        return StatusResponse(
            success=True,
            message="Transcript processed and stored successfully" + (" (regex filter - LLM unavailable)" if not use_llm else ""),
            data={
                "original_length": len(request.transcript),
                "cleaned_length": len(cleaned_content),
                "chunks_stored": num_stored,
                "llm_filtered": use_llm,
                "preview": cleaned_content[:200] + "..." if len(cleaned_content) > 200 else cleaned_content
            }
        )
    
    except Exception as e:
        logger.error(f"Transcript processing error: {e}")
        raise HTTPException(status_code=500, detail=f"Processing error: {str(e)}")


@router.get("/summary")
async def get_summary():
    """
    Generate a summary of all stored lecture content.
    Returns a streaming response as the LLM generates the summary.
    REQUIRES Ollama to be running.
    """
    # Check Ollama connection
    if not is_ollama_available():
        logger.warning("Summary requested but Ollama is not available")
        # Return a helpful message as streaming response instead of error
        def unavailable_message():
            message = "Ollama LLM is not available. To enable AI summaries:\n\n"
            message += "1. Install Ollama from https://ollama.com\n"
            message += "2. Run: ollama run llama3-it\n"
            message += "3. Refresh this page"
            yield f"data: {json.dumps({'text': message})}\n\n"
            yield "data: [DONE]\n\n"
        
        return StreamingResponse(
            unavailable_message(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive"
            }
        )
    
    # Get all stored content
    all_content = get_all_content(limit=50)
    
    if not all_content:
        def no_content_message():
            yield f"data: {json.dumps({'text': 'No lecture content found. Please upload slides or submit transcripts first.'})}\n\n"
            yield "data: [DONE]\n\n"
        
        return StreamingResponse(
            no_content_message(),
            media_type="text/event-stream"
        )
    
    # Combine content for context (extracting the 'text' field from each dict)
    context_chunks = [item.get("text", "") if isinstance(item, dict) else str(item) for item in all_content[:20]]
    context = "\n\n---\n\n".join(context_chunks)  # Limit context size

    logger.info(f"Generating summary for {len(all_content)} content chunks")
    
    # Stream the summary
    def generate():
        try:
            for chunk in generate_summary(context):
                yield f"data: {json.dumps({'text': chunk})}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            logger.error(f"Summary generation error: {e}")
            yield f"data: {json.dumps({'text': f'[Error generating summary: {str(e)}]'})}\n\n"
            yield "data: [DONE]\n\n"
    
    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


@router.post("/ask")
async def ask_question(request: QuestionRequest):
    """
    Ask a question about the lecture content.
    Uses RAG to retrieve relevant content and streams the answer.
    REQUIRES Ollama to be running.
    """
    if not request.question or len(request.question.strip()) < 3:
        raise HTTPException(status_code=400, detail="Question is too short")
    
    # Check Ollama connection
    if not is_ollama_available():
        logger.warning("Question asked but Ollama is not available")
        def unavailable_message():
            message = "Ollama LLM is not available. To enable Q&A:\n\n"
            message += "1. Install Ollama from https://ollama.com\n"
            message += "2. Run: ollama run llama3-it\n"
            message += "3. Try asking again"
            yield f"data: {json.dumps({'text': message})}\n\n"
            yield "data: [DONE]\n\n"
        
        return StreamingResponse(
            unavailable_message(),
            media_type="text/event-stream"
        )
    
    # Search for relevant content
    search_results = search_similar(request.question, n_results=5)
    
    if not search_results:
        def no_content_message():
            yield f"data: {json.dumps({'text': 'No relevant content found. Please upload lecture materials first.'})}\n\n"
            yield "data: [DONE]\n\n"
        
        return StreamingResponse(
            no_content_message(),
            media_type="text/event-stream"
        )
    
    # Build context from search results
    context_parts = [doc for doc, dist, meta in search_results]
    context = "\n\n---\n\n".join(context_parts)
    
    logger.info(f"Answering question with {len(search_results)} context chunks")
    
    # Stream the answer
    def generate():
        try:
            for chunk in answer_question(context, request.question):
                yield f"data: {json.dumps({'text': chunk})}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            logger.error(f"Q&A generation error: {e}")
            yield f"data: {json.dumps({'text': f'[Error generating answer: {str(e)}]'})}\n\n"
            yield "data: [DONE]\n\n"
    
    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


@router.get("/stats")
async def get_stats():
    """Get statistics about stored content."""
    stats = get_collection_stats()
    ollama_status = is_ollama_available()
    
    return {
        "success": True,
        "data": {
            **stats,
            "llm_available": ollama_status
        }
    }


@router.get("/chunks")
async def get_stored_chunks():
    """Get all stored transcript/content chunks from the database."""
    try:
        chunks = get_all_content(limit=200)
        return {
            "success": True,
            "count": len(chunks),
            "chunks": chunks
        }
    except Exception as e:
        logger.error(f"Error fetching chunks: {e}")
        return {
            "success": False,
            "count": 0,
            "chunks": [],
            "error": str(e)
        }


@router.delete("/clear")
async def clear_content():
    """Clear all stored lecture content."""
    try:
        success = clear_collection()
        logger.info("Cleared all lecture content")
        return StatusResponse(
            success=success,
            message="Content cleared successfully" if success else "Failed to clear content"
        )
    except Exception as e:
        logger.error(f"Error clearing content: {e}")
        return StatusResponse(
            success=False,
            message=f"Error clearing content: {str(e)}"
        )


@router.post("/transcribe-audio")
async def transcribe_audio_chunk(file: UploadFile = File(...)):
    """
    Transcribe an audio chunk using local Faster Whisper.
    Accepts audio file (WAV, WebM, etc.), transcribes it, stores in vector DB,
    and returns the transcript text.
    """
    try:
        audio_bytes = await file.read()

        if len(audio_bytes) < 100:
            return StatusResponse(
                success=False,
                message="Audio chunk too small"
            )

        # Transcribe locally with Faster Whisper
        transcript = transcribe_audio(audio_bytes, filename=file.filename or "audio.webm")

        if transcript is None:
            transcript = ""

        # Filter common Whisper hallucinations (when mic is muted but recording)
        hallucinations = ["thank you.", "bye.", "subscribe", "thanks for watching", "subtitles by"]
        lower_transcript = transcript.lower().strip()
        
        is_hallucination = any(h in lower_transcript for h in hallucinations) or len(lower_transcript) < 5
        
        if not transcript or is_hallucination:
            return StatusResponse(
                success=True,
                message="No speech detected (or silenced hallucination)",
                data={"transcript": "", "chunks_stored": 0}
            )

        # We intentionally DO NOT save the transcript to the vector DB here!
        # The frontend handles saving it by calling the `/transcript` endpoint
        # if the teacher has the "Auto-Save" toggle enabled.

        logger.info(f"Transcribed successfully: {len(transcript)} chars (NOT automatically saved)")

        return StatusResponse(
            success=True,
            message="Transcribed successfully",
            data={
                "transcript": transcript,
                "chunks_stored": 0,
                "audio_size": len(audio_bytes),
            }
        )

    except Exception as e:
        logger.error(f"Audio transcription error: {e}")
        raise HTTPException(status_code=500, detail=f"Transcription error: {str(e)}")


# ═══════════════════════════════════════════════════════════════════════════
# LEARNING OUTCOMES ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════

@router.post("/learning-outcomes/upload", response_model=StatusResponse)
async def upload_outcomes(file: UploadFile = File(...)):
    """Upload a learning outcomes PDF/TXT and extract individual outcomes without saving them."""
    if not file.filename.lower().endswith(('.pdf', '.txt')):
        raise HTTPException(status_code=400, detail="Only PDF and TXT files are supported")
    try:
        content = await file.read()
        extracted = extract_learning_outcomes(content, file.filename)
        return StatusResponse(
            success=True,
            message=f"Successfully extracted {len(extracted)} proposed learning outcomes",
            data={
                "extracted_outcomes": extracted,
                "source_filename": file.filename
            },
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Learning outcomes extraction error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/learning-outcomes/save", response_model=StatusResponse)
async def save_outcomes_endpoint(request: SaveOutcomesRequest, db: Session = Depends(get_db)):
    """Save teacher-approved learning outcomes to the database."""
    try:
        result = save_approved_outcomes(request.outcomes, request.source_filename, db)
        return StatusResponse(
            success=True,
            message=f"Successfully saved {result['outcomes_added']} learning outcomes",
            data=result,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Learning outcomes save error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/learning-outcomes")
async def list_outcomes(db: Session = Depends(get_db)):
    """Get all stored learning outcomes."""
    outcomes = get_learning_outcomes(db)
    return {"success": True, "count": len(outcomes), "outcomes": outcomes}


@router.delete("/learning-outcomes/{outcome_id}")
async def remove_outcome(outcome_id: str, db: Session = Depends(get_db)):
    """Delete a specific learning outcome."""
    deleted = delete_learning_outcome(outcome_id, db)
    if not deleted:
        raise HTTPException(status_code=404, detail="Learning outcome not found")
    return StatusResponse(success=True, message="Learning outcome deleted")


@router.delete("/learning-outcomes")
async def clear_outcomes(db: Session = Depends(get_db)):
    """Clear all learning outcomes."""
    count = clear_all_outcomes(db)
    return StatusResponse(success=True, message=f"Cleared {count} learning outcomes")


# ═══════════════════════════════════════════════════════════════════════════
# QUIZ ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════

@router.post("/quiz/generate")
async def generate_quiz_endpoint(request: QuizGenerateRequest, db: Session = Depends(get_db)):
    """Generate a quiz from lecture content aligned with learning outcomes."""
    try:
        quiz = generate_quiz(
            db=db,
            num_questions=request.num_questions,
            difficulty=request.difficulty,
        )
        return {"success": True, "quiz": quiz}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error(f"Quiz generation error: {e}")
        raise HTTPException(status_code=500, detail=f"Quiz generation failed: {str(e)}")


@router.post("/quiz/regenerate-question")
async def regenerate_question_endpoint(request: Request, db: Session = Depends(get_db)):
    """Regenerate a single quiz question."""
    try:
        data = await request.json()
        question_id = data.get("question_id")
        
        if not question_id:
            raise HTTPException(status_code=400, detail="question_id is required")
            
        new_question = regenerate_quiz_question(question_id, db)
        return {"success": True, "question": new_question}
        
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error(f"Generate question error: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to regenerate question: {str(e)}")


@router.get("/quizzes")
async def list_quizzes(db: Session = Depends(get_db)):
    """Get all generated quizzes (teacher view)."""
    quizzes = get_all_quizzes(db)
    return {"success": True, "count": len(quizzes), "quizzes": quizzes}


@router.get("/quiz/responses/all")
async def get_all_responses(db: Session = Depends(get_db)):
    """Get all student responses across all quizzes."""
    responses = get_quiz_responses(db=db)
    return {"success": True, "count": len(responses), "responses": responses}


@router.get("/quiz/released")
async def list_released_quizzes(db: Session = Depends(get_db)):
    """Get released quizzes (student view)."""
    quizzes = get_released_quizzes(db)
    return {"success": True, "count": len(quizzes), "quizzes": quizzes}


@router.get("/quiz/{quiz_id}")
async def get_quiz_endpoint(quiz_id: str, db: Session = Depends(get_db)):
    """Get a specific quiz."""
    quiz = get_quiz(quiz_id, db)
    if not quiz:
        raise HTTPException(status_code=404, detail="Quiz not found")
    return {"success": True, "quiz": quiz}


@router.put("/quiz/{quiz_id}")
async def update_quiz_endpoint(quiz_id: str, request: Request, db: Session = Depends(get_db)):
    """Update quiz questions."""
    data = await request.json()
    questions = data.get("questions", [])
    if not questions:
        raise HTTPException(status_code=400, detail="No questions provided to update")
        
    updated_quiz = update_quiz_questions(quiz_id, questions, db)
    if not updated_quiz:
        raise HTTPException(status_code=404, detail="Quiz not found")
        
    return {"success": True, "quiz": updated_quiz}


@router.put("/quiz/{quiz_id}/release")
async def release_quiz_endpoint(quiz_id: str, db: Session = Depends(get_db)):
    """Release a quiz to students."""
    quiz = release_quiz(quiz_id, db)
    if not quiz:
        raise HTTPException(status_code=404, detail="Quiz not found")
    return StatusResponse(success=True, message="Quiz released to students", data={"quiz_id": quiz_id})


@router.delete("/quiz/{quiz_id}")
async def delete_quiz_endpoint(quiz_id: str, db: Session = Depends(get_db)):
    """Delete a quiz."""
    deleted = delete_quiz(quiz_id, db)
    if not deleted:
        raise HTTPException(status_code=404, detail="Quiz not found")
    return StatusResponse(success=True, message="Quiz deleted")


@router.post("/quiz/{quiz_id}/submit")
async def submit_quiz(quiz_id: str, request: QuizSubmitRequest, db: Session = Depends(get_db)):
    """Submit student answers for a quiz."""
    try:
        result = submit_quiz_response(
            quiz_id=quiz_id,
            student_id=request.student_id,
            student_name=request.student_name,
            answers=[a.dict() for a in request.answers],
            db=db,
        )
        return {"success": True, "result": result}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Quiz submission error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/quiz/{quiz_id}/responses")
async def get_responses(quiz_id: str, db: Session = Depends(get_db)):
    """Get all student responses for a quiz."""
    responses = get_quiz_responses(quiz_id, db)
    return {"success": True, "count": len(responses), "responses": responses}


@router.get("/quiz/{quiz_id}/analytics")
async def quiz_analytics(quiz_id: str, db: Session = Depends(get_db)):
    """Get aggregated analytics for a quiz."""
    try:
        analytics = get_quiz_analytics(quiz_id, db)
        return {"success": True, "analytics": analytics}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Quiz analytics error: {e}")
        raise HTTPException(status_code=500, detail=str(e))



