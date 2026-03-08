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
    update_quiz_questions,
    has_student_completed_quiz,
)
from .models import AIFeedback, QuizEditLog

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/performance", tags=["performance"])

# Buffer to accumulate transcript text before storing in vector DB
# Stores context-rich paragraphs (≥200 chars) instead of tiny fragments
_transcript_buffer: list = []


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


class FeedbackRequest(BaseModel):
    """Request body for submitting AI feedback (Human-in-the-Loop evaluation)."""
    feature: str             # "qa" | "summary"
    rating: int              # 1 = positive, 0 = negative
    comment: Optional[str] = None
    student_id: Optional[str] = None
    question: Optional[str] = None
    response: Optional[str] = None
    summary_type: Optional[str] = None


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
        
        return StatusResponse(
            success=True,
            message=f"Successfully processed and stored {num_stored} content chunks",
            data={
                "filename": file.filename,
                "chunks_stored": num_stored,
                "sample_chunk": chunks[0][:200] + "..." if chunks else None
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
async def get_summary(type: str = "advanced"):
    """
    Generate a summary of all stored lecture content.
    Accepts 'type' parameter ('quick' or 'advanced') to adjust detail level.
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
    
    # Combine content for context — label by source so LLM can distinguish
    slide_chunks = []
    transcript_chunks = []
    for item in all_content[:30]:
        text = item.get("text", "") if isinstance(item, dict) else str(item)
        source = item.get("source", "unknown") if isinstance(item, dict) else "unknown"
        if not text.strip():
            continue
        if source == "slides":
            slide_chunks.append(text)
        else:
            transcript_chunks.append(text)
    
    context_parts = []
    if slide_chunks:
        context_parts.append("=== FROM LECTURE SLIDES ===\n" + "\n\n".join(slide_chunks))
    if transcript_chunks:
        context_parts.append("=== FROM LIVE LECTURE SPEECH (what the teacher actually said) ===\n" + "\n\n".join(transcript_chunks))
    
    context = "\n\n".join(context_parts) if context_parts else ""

    logger.info(f"Generating summary: {len(slide_chunks)} slide chunks, {len(transcript_chunks)} transcript chunks")
    
    # Stream the summary
    def generate():
        try:
            for chunk in generate_summary(context, summary_type=type):
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
    
    # Build context from search results — label by source
    labeled_parts = []
    for doc, dist, meta in search_results:
        source = meta.get("source", "unknown") if meta else "unknown"
        label = "[From Slides]" if source == "slides" else "[From Live Lecture Speech]"
        labeled_parts.append(f"{label}\n{doc}")
    context = "\n\n---\n\n".join(labeled_parts)
    
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
    Accumulates transcript text and stores to vector DB once a meaningful
    paragraph is built (≥200 chars). This ensures the Q&A system gets
    context-rich chunks rather than tiny sentence fragments.
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

        # Accumulate transcript text — only store when we have enough context
        _transcript_buffer.append(transcript)
        accumulated = " ".join(_transcript_buffer)
        chunks_stored = 0

        if len(accumulated) >= 200:
            # Enough context — store this accumulated segment in vector DB
            num_stored = add_documents(
                texts=[accumulated],
                source="transcript",
                metadata={"type": "live_speech", "method": "whisper_local", "raw": True}
            )
            chunks_stored = num_stored
            logger.info(f"Stored accumulated transcript: {len(accumulated)} chars, {num_stored} chunks")
            _transcript_buffer.clear()
        else:
            logger.info(f"Buffered transcript ({len(accumulated)} chars, waiting for ≥200)")

        return StatusResponse(
            success=True,
            message="Transcribed successfully",
            data={
                "transcript": transcript,
                "chunks_stored": chunks_stored,
                "audio_size": len(audio_bytes),
                "buffer_size": len(accumulated) if chunks_stored == 0 else 0,
            }
        )

    except Exception as e:
        logger.error(f"Audio transcription error: {e}")
        raise HTTPException(status_code=500, detail=f"Transcription error: {str(e)}")


@router.post("/transcribe-audio/flush")
async def flush_transcript_buffer():
    """Flush any remaining buffered transcript text to the vector DB."""
    accumulated = " ".join(_transcript_buffer)
    if not accumulated.strip():
        return StatusResponse(success=True, message="Buffer empty, nothing to flush")

    num_stored = add_documents(
        texts=[accumulated],
        source="transcript",
        metadata={"type": "live_speech", "method": "whisper_local", "raw": True}
    )
    logger.info(f"Flushed transcript buffer: {len(accumulated)} chars, {num_stored} chunks")
    _transcript_buffer.clear()

    return StatusResponse(
        success=True,
        message=f"Flushed and stored {num_stored} chunks",
        data={"transcript": accumulated, "chunks_stored": num_stored}
    )


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

        # --- HITL: Log regeneration for evaluation tracking ---
        from .models import QuizQuestion as QQ
        q = db.query(QQ).filter(QQ.id == question_id).first()
        if q:
            log = QuizEditLog(quiz_id=q.quiz_id, question_id=question_id, action="regenerate", details="Teacher regenerated question via AI")
            db.add(log)
            try:
                db.flush()
            except Exception:
                pass

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

    # --- HITL: Log edits for evaluation tracking ---
    for q_data in questions:
        q_id = q_data.get("id")
        if q_id:
            log = QuizEditLog(quiz_id=quiz_id, question_id=q_id, action="edit", details="Teacher edited question text/options")
            db.add(log)
    try:
        db.flush()
    except Exception:
        pass  # Non-critical — don't fail the edit if logging fails

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
        msg = str(e)
        # Return 409 Conflict when student already submitted
        if "already submitted" in msg:
            raise HTTPException(status_code=409, detail=msg)
        raise HTTPException(status_code=404, detail=msg)
    except Exception as e:
        logger.error(f"Quiz submission error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/quiz/{quiz_id}/check-attempt")
async def check_quiz_attempt(
    quiz_id: str,
    student_id: str,
    db: Session = Depends(get_db),
):
    """
    Check whether a student has already submitted a response for a given quiz.
    Returns {"completed": true/false}.
    """
    completed = has_student_completed_quiz(quiz_id, student_id, db)
    return {"completed": completed}


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


# ═══════════════════════════════════════════════════════════════════════════
# HUMAN-IN-THE-LOOP EVALUATION ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════

@router.post("/feedback")
async def submit_feedback(request: FeedbackRequest, db: Session = Depends(get_db)):
    """
    Submit student feedback on an AI-generated response.
    Used for Human-in-the-Loop evaluation of the AI system.
    """
    if request.feature not in ("qa", "summary"):
        raise HTTPException(status_code=400, detail="feature must be 'qa' or 'summary'")
    if request.rating not in (0, 1):
        raise HTTPException(status_code=400, detail="rating must be 0 (negative) or 1 (positive)")

    feedback = AIFeedback(
        feature=request.feature,
        rating=request.rating,
        comment=request.comment,
        student_id=request.student_id,
        question=request.question,
        response=request.response[:2000] if request.response else None,  # cap stored text
        summary_type=request.summary_type,
    )
    db.add(feedback)
    db.commit()

    logger.info(f"HITL feedback: {request.feature} {'👍' if request.rating else '👎'} from {request.student_id}")
    return {"success": True, "message": "Feedback recorded", "id": feedback.id}


@router.get("/feedback/analytics")
async def feedback_analytics(db: Session = Depends(get_db)):
    """
    Get aggregated Human-in-the-Loop evaluation analytics.
    Returns satisfaction rates, feedback counts, quiz edit stats, and trend data.
    """
    from sqlalchemy import func

    # --- Q&A feedback ---
    qa_all = db.query(AIFeedback).filter(AIFeedback.feature == "qa").all()
    qa_positive = sum(1 for f in qa_all if f.rating == 1)
    qa_total = len(qa_all)
    qa_with_comments = sum(1 for f in qa_all if f.comment)

    # --- Summary feedback ---
    summary_all = db.query(AIFeedback).filter(AIFeedback.feature == "summary").all()
    summary_helpful = sum(1 for f in summary_all if f.rating == 1)
    summary_total = len(summary_all)

    # Summary breakdown by type
    summary_by_type = {}
    for f in summary_all:
        st = f.summary_type or "unknown"
        if st not in summary_by_type:
            summary_by_type[st] = {"helpful": 0, "total": 0}
        summary_by_type[st]["total"] += 1
        if f.rating == 1:
            summary_by_type[st]["helpful"] += 1

    # --- Quiz edit logs ---
    edit_logs = db.query(QuizEditLog).all()
    edits = sum(1 for l in edit_logs if l.action == "edit")
    regenerations = sum(1 for l in edit_logs if l.action == "regenerate")
    deletions = sum(1 for l in edit_logs if l.action == "delete")

    # Total questions ever generated (across all quizzes)
    from .models import Quiz as QuizModel
    total_quizzes = db.query(QuizModel).count()
    total_questions_generated = db.query(func.sum(QuizModel.num_questions)).scalar() or 0
    total_modifications = edits + regenerations + deletions
    edit_rate = round(total_modifications / total_questions_generated * 100, 1) if total_questions_generated > 0 else 0

    # --- Trend data (daily feedback counts for charts) ---
    all_feedback = db.query(AIFeedback).order_by(AIFeedback.created_at.asc()).all()
    daily_trend = {}
    for f in all_feedback:
        day = f.created_at.strftime("%Y-%m-%d") if f.created_at else "unknown"
        if day not in daily_trend:
            daily_trend[day] = {"date": day, "qa_positive": 0, "qa_negative": 0, "summary_positive": 0, "summary_negative": 0}
        if f.feature == "qa":
            daily_trend[day]["qa_positive" if f.rating == 1 else "qa_negative"] += 1
        else:
            daily_trend[day]["summary_positive" if f.rating == 1 else "summary_negative"] += 1

    # --- Rating distribution for radar chart ---
    # Per-feature satisfaction for visual comparison
    features_summary = []
    if qa_total > 0:
        features_summary.append({"feature": "Q&A Answers", "satisfaction": round(qa_positive / qa_total * 100, 1), "total": qa_total})
    if summary_total > 0:
        features_summary.append({"feature": "Summaries", "satisfaction": round(summary_helpful / summary_total * 100, 1), "total": summary_total})
    if total_questions_generated > 0:
        acceptance_rate = round((total_questions_generated - total_modifications) / total_questions_generated * 100, 1)
        features_summary.append({"feature": "Quiz Questions", "satisfaction": acceptance_rate, "total": int(total_questions_generated)})

    date_range = {}
    if all_feedback:
        date_range = {
            "first": all_feedback[0].created_at.strftime("%Y-%m-%d") if all_feedback[0].created_at else None,
            "last": all_feedback[-1].created_at.strftime("%Y-%m-%d") if all_feedback[-1].created_at else None,
        }

    return {
        "success": True,
        "analytics": {
            "qa": {
                "total": qa_total,
                "positive": qa_positive,
                "negative": qa_total - qa_positive,
                "satisfaction_rate": round(qa_positive / qa_total * 100, 1) if qa_total > 0 else 0,
                "with_comments": qa_with_comments,
            },
            "summary": {
                "total": summary_total,
                "helpful": summary_helpful,
                "not_helpful": summary_total - summary_helpful,
                "helpfulness_rate": round(summary_helpful / summary_total * 100, 1) if summary_total > 0 else 0,
                "by_type": summary_by_type,
            },
            "quiz_edits": {
                "total_quizzes": total_quizzes,
                "total_questions_generated": int(total_questions_generated),
                "questions_edited": edits,
                "questions_regenerated": regenerations,
                "questions_deleted": deletions,
                "total_modifications": total_modifications,
                "edit_rate": edit_rate,
                "acceptance_rate": round(100 - edit_rate, 1),
            },
            "total_feedback": qa_total + summary_total,
            "daily_trend": list(daily_trend.values()),
            "features_summary": features_summary,
            "date_range": date_range,
        }
    }


@router.get("/feedback/recent")
async def recent_feedback(limit: int = 20, db: Session = Depends(get_db)):
    """
    Get recent feedback entries with full context for the admin evaluation log.
    """
    # Recent AI feedback
    feedbacks = db.query(AIFeedback).order_by(AIFeedback.created_at.desc()).limit(limit).all()

    # Recent quiz edit logs
    edit_logs = db.query(QuizEditLog).order_by(QuizEditLog.created_at.desc()).limit(limit).all()

    # Merge and sort by timestamp
    entries = []
    for f in feedbacks:
        entries.append({
            "type": "feedback",
            "feature": f.feature,
            "rating": f.rating,
            "comment": f.comment,
            "student_id": f.student_id,
            "question": f.question[:100] if f.question else None,
            "response": f.response[:150] if f.response else None,
            "summary_type": f.summary_type,
            "created_at": f.created_at.isoformat() if f.created_at else None,
        })
    for l in edit_logs:
        entries.append({
            "type": "quiz_edit",
            "action": l.action,
            "quiz_id": l.quiz_id,
            "question_id": l.question_id,
            "details": l.details,
            "created_at": l.created_at.isoformat() if l.created_at else None,
        })

    # Sort merged list by created_at descending
    entries.sort(key=lambda x: x.get("created_at", ""), reverse=True)

    return {"success": True, "count": len(entries), "entries": entries[:limit]}