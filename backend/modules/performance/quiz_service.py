"""
AI Quiz Generation Service
Generates MCQ quizzes from lecture content aligned with learning outcomes using Ollama LLM.
Uses smart RAG retrieval and chunk compression to fit within context window limits.
Stores quizzes and student responses in the database.
"""
import logging
import re
import uuid
from typing import List, Dict, Optional
from sqlalchemy.orm import Session

from .llm_service import generate_complete, is_ollama_available, estimate_tokens, DEFAULT_NUM_CTX
from .vector_store import get_all_content, retrieve_relevant_chunks
from .chunk_compressor import compress_for_budget
from .learning_outcomes import get_learning_outcomes
from .models import Quiz, QuizQuestion, QuizResponse

logger = logging.getLogger(__name__)

# Token budget constants (for num_ctx=8192)
SYSTEM_PROMPT_BUDGET = 200    # tokens for system prompt
INSTRUCTION_BUDGET = 400      # tokens for prompt template + format instructions
OUTCOMES_BUDGET = 300         # tokens for learning outcomes text
OVERHEAD_TOKENS = SYSTEM_PROMPT_BUDGET + INSTRUCTION_BUDGET + OUTCOMES_BUDGET  # ~900
OUTPUT_TOKENS_PER_QUESTION = 150  # ~150 tokens per JSON question object


# ─── LLM Prompt ────────────────────────────────────────────────────────────

QUIZ_SYSTEM_PROMPT = """You are an expert quiz designer. Create MCQ questions from lecture content.
Rules: 4 options per question, one correct answer, based ONLY on the content provided.
Respond with valid JSON array only, no extra text."""

QUIZ_GENERATION_PROMPT = """Based on the following lecture content and learning outcomes, generate {num_questions} multiple-choice questions at {difficulty} difficulty level.

LECTURE CONTENT:
{content}

LEARNING OUTCOMES TO ASSESS:
{outcomes}

Generate exactly {num_questions} questions. Each question MUST be mapped to one of the learning outcomes above.

Respond with ONLY a JSON array (no markdown, no explanation) in this exact format:
[
  {{
    "question": "The question text",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "correctAnswer": 0,
    "learningOutcome": "The learning outcome text this question assesses",
    "difficulty": "{difficulty}"
  }}
]

IMPORTANT:
- correctAnswer is a 0-based index (0-3)
- Each question must clearly test understanding related to a learning outcome
- Options should be plausible but only one should be correct
- For Beginner: test recall and basic understanding
- For Intermediate: test application and analysis
- For Advanced: test evaluation and synthesis"""

SINGLE_QUESTION_PROMPT = """Based on the following lecture content and learning outcomes, generate exactly ONE multiple-choice question at {difficulty} difficulty level.

This is a REGENERATION request. The new question MUST be different from the previous question provided below:
PREVIOUS QUESTION TO REPLACE:
{previous_question}

LECTURE CONTENT:
{content}

LEARNING OUTCOMES TO ASSESS:
{outcomes}

Respond with ONLY a JSON array containing a single question object (no markdown, no explanation) in this exact format:
[
  {{
    "question": "The question text",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "correctAnswer": 0,
    "learningOutcome": "The learning outcome text this question assesses",
    "difficulty": "{difficulty}"
  }}
]"""


def _parse_quiz_json(raw: str) -> List[Dict]:
    """
    Parse LLM output into a list of question dicts.
    Handles cases where the LLM wraps JSON in markdown code blocks,
    and attempts to repair gracefully if cut off by token limit.
    """
    import json
    import re
    
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r'^```\w*\n?', '', cleaned)
        cleaned = re.sub(r'\n?```$', '', cleaned)
        cleaned = cleaned.strip()

    start = cleaned.find('[')
    end = cleaned.rfind(']')
    
    # Try normal JSON parsing first
    parse_target = cleaned
    if start != -1 and end != -1 and end > start:
        parse_target = cleaned[start:end+1]
        
    try:
        questions = json.loads(parse_target)
        if not isinstance(questions, list):
            raise ValueError("Expected a JSON array")
        return questions
    except json.JSONDecodeError as e:
        logger.warning(f"Standard JSON parsing failed: {e}. Attempting robust recovery.")
        
        # Robust recovery: Extract objects by counting braces
        objects = []
        brace_count = 0
        in_string = False
        escape_next = False
        obj_start = -1
        
        for i, char in enumerate(cleaned):
            if escape_next:
                escape_next = False
                continue
                
            if char == '\\':
                escape_next = True
                continue
                
            if char == '"':
                in_string = not in_string
                continue
                
            if not in_string:
                if char == '{':
                    if brace_count == 0:
                        obj_start = i
                    brace_count += 1
                elif char == '}':
                    if brace_count > 0:
                        brace_count -= 1
                        if brace_count == 0 and obj_start != -1:
                            # We have a complete object string
                            obj_str = cleaned[obj_start:i+1]
                            try:
                                obj = json.loads(obj_str)
                                if isinstance(obj, dict) and "question" in obj:
                                    objects.append(obj)
                            except:
                                pass
                            obj_start = -1
        
        if objects:
            logger.info(f"Successfully recovered {len(objects)} complete quiz questions from cut-off JSON.")
            return objects
            
        logger.error(f"Failed to parse quiz JSON entirely.\nRaw: {raw[:500]}...")
        raise ValueError(f"LLM returned invalid JSON and recovery failed: {e}")


def _calculate_content_budget(num_questions: int, num_ctx: int = DEFAULT_NUM_CTX) -> int:
    """
    Calculate how many tokens we can spend on lecture content,
    given the context window and expected output size.
    """
    output_budget = num_questions * OUTPUT_TOKENS_PER_QUESTION
    content_budget = num_ctx - OVERHEAD_TOKENS - output_budget
    # Ensure at least 500 tokens for content
    return max(500, content_budget)


def _generate_questions_batch(
    content_text: str,
    outcomes_text: str,
    num_questions: int,
    difficulty: str,
) -> List[Dict]:
    """
    Generate a batch of questions from compressed content.
    Returns parsed and validated question dicts.
    """
    prompt = QUIZ_GENERATION_PROMPT.format(
        num_questions=num_questions,
        difficulty=difficulty,
        content=content_text,
        outcomes=outcomes_text,
    )

    # Calculate appropriate output budget
    output_tokens = num_questions * OUTPUT_TOKENS_PER_QUESTION + 100  # +100 for JSON array overhead
    
    # Calculate required context: input + output
    input_tokens = estimate_tokens(prompt) + estimate_tokens(QUIZ_SYSTEM_PROMPT)
    required_ctx = input_tokens + output_tokens
    # Use at least DEFAULT_NUM_CTX, but bump up if needed
    num_ctx = max(DEFAULT_NUM_CTX, required_ctx + 200)

    logger.info(
        f"Batch generation: {num_questions} questions, "
        f"~{input_tokens} input tokens, ~{output_tokens} output tokens, "
        f"num_ctx={num_ctx}"
    )

    raw_response = generate_complete(
        prompt=prompt,
        system_prompt=QUIZ_SYSTEM_PROMPT,
        temperature=0.4,
        max_tokens=output_tokens,
        num_ctx=num_ctx,
    )

    if not raw_response:
        logger.warning("LLM returned empty response for batch")
        return []

    try:
        return _parse_quiz_json(raw_response)
    except ValueError as e:
        logger.error(f"Failed to parse batch response: {e}")
        return []


def generate_quiz(
    db: Session,
    num_questions: int = 5,
    difficulty: str = "Intermediate",
) -> Dict:
    """
    Generate a quiz using Ollama LLM based on lecture content and learning outcomes.
    
    Uses smart RAG retrieval to find relevant content, compresses it to fit
    within the context window, and batches generation for large quizzes.
    
    Args:
        db: Database session
        num_questions: Number of questions to generate (1-15)
        difficulty: One of Beginner, Intermediate, Advanced

    Returns:
        Quiz dict with id, questions, metadata
    """
    if not is_ollama_available():
        raise RuntimeError(
            "Ollama LLM is not available. Please install and run Ollama to generate quizzes."
        )

    # Get learning outcomes
    outcomes = get_learning_outcomes(db)
    if not outcomes:
        raise ValueError(
            "No learning outcomes found. Please upload a learning outcomes PDF first."
        )

    # ── Smart Retrieval ──────────────────────────────────────────────────
    # Instead of get_all_content(limit=50)[:15], we now retrieve only
    # chunks that are semantically relevant to the learning outcomes.
    outcome_texts = [o['text'] for o in outcomes]
    
    relevant_chunks = retrieve_relevant_chunks(
        queries=outcome_texts,
        top_k_per_query=3,
        min_similarity=0.2,
        max_total_chunks=12,
    )

    # Fallback to get_all_content if vector search returns nothing
    # (e.g. empty collection or embedding issues)
    if not relevant_chunks:
        logger.warning("Smart retrieval returned no results, falling back to get_all_content")
        all_content = get_all_content(limit=15)
        if not all_content:
            raise ValueError(
                "No lecture content found. Please upload slides or submit transcripts first."
            )
        relevant_chunks = [{"text": c["text"], "source": c.get("source", "unknown")} 
                          for c in all_content]

    # ── Decide: single-shot vs batched ───────────────────────────────────
    if num_questions <= 5:
        # Single-shot: compress all content and generate at once
        content_budget = _calculate_content_budget(num_questions)
        content_text, tokens_used = compress_for_budget(
            chunks=relevant_chunks,
            token_budget=content_budget,
        )
        outcomes_text = "\n".join(
            f"{i+1}. {o['text']}" for i, o in enumerate(outcomes)
        )

        logger.info(
            f"Single-shot generation: {num_questions} {difficulty} questions, "
            f"{len(relevant_chunks)} chunks compressed to ~{tokens_used} tokens "
            f"(budget: {content_budget})"
        )

        all_questions = _generate_questions_batch(
            content_text, outcomes_text, num_questions, difficulty
        )
    else:
        # Batched: split outcomes into groups, generate per-group
        batch_size = 2  # outcomes per batch
        outcome_batches = [
            outcomes[i:i+batch_size] 
            for i in range(0, len(outcomes), batch_size)
        ]
        
        # Distribute questions across batches
        base_per_batch = num_questions // len(outcome_batches)
        remainder = num_questions % len(outcome_batches)
        
        all_questions = []
        
        for batch_idx, outcome_batch in enumerate(outcome_batches):
            batch_query_texts = [o['text'] for o in outcome_batch]
            
            # Retrieve chunks specific to this batch of outcomes
            batch_chunks = retrieve_relevant_chunks(
                queries=batch_query_texts,
                top_k_per_query=3,
                min_similarity=0.2,
                max_total_chunks=6,
            )
            
            # Fallback if batch retrieval is empty
            if not batch_chunks:
                batch_chunks = relevant_chunks  # use the global set
            
            # How many questions for this batch
            batch_q_count = base_per_batch + (1 if batch_idx < remainder else 0)
            if batch_q_count <= 0:
                continue
            
            # Compress for this batch's budget
            content_budget = _calculate_content_budget(batch_q_count)
            content_text, tokens_used = compress_for_budget(
                chunks=batch_chunks,
                token_budget=content_budget,
            )
            outcomes_text = "\n".join(
                f"{i+1}. {o['text']}" for i, o in enumerate(outcome_batch)
            )

            logger.info(
                f"Batch {batch_idx+1}/{len(outcome_batches)}: "
                f"{batch_q_count} questions, {len(batch_chunks)} chunks, "
                f"~{tokens_used} content tokens"
            )

            batch_questions = _generate_questions_batch(
                content_text, outcomes_text, batch_q_count, difficulty
            )
            all_questions.extend(batch_questions)

    # ── Validate & normalise ────────────────────────────────────────────
    if not all_questions:
        raise RuntimeError("LLM returned an empty response. Please try again.")

    validated = []
    for i, q in enumerate(all_questions):
        if not all(k in q for k in ("question", "options", "correctAnswer")):
            logger.warning(f"Skipping malformed question {i}: {q}")
            continue
        if not isinstance(q["options"], list) or len(q["options"]) != 4:
            logger.warning(f"Skipping question {i} with bad options count")
            continue
        correct = q["correctAnswer"]
        if not isinstance(correct, int) or correct < 0 or correct > 3:
            correct = 0
        validated.append({
            "id": i + 1,
            "question": str(q["question"]),
            "options": [str(o) for o in q["options"]],
            "correctAnswer": correct,
            "learningOutcome": q.get("learningOutcome", ""),
            "difficulty": q.get("difficulty", difficulty),
        })

    if not validated:
        raise RuntimeError(
            "LLM generated questions but none were in a valid format. Please try again."
        )

    # Create quiz object
    quiz_db = Quiz(
        difficulty=difficulty,
        num_questions=len(validated),
        status="draft"
    )
    db.add(quiz_db)
    db.flush()  # To get quiz_db.id

    db_questions = []
    for q in validated:
        db_q = QuizQuestion(
            quiz_id=quiz_db.id,
            question=q["question"],
            options=q["options"],
            correct_answer=q["correctAnswer"],
            learning_outcome=q["learningOutcome"],
            difficulty=q["difficulty"]
        )
        db.add(db_q)
        db_questions.append(db_q)

    db.commit()

    logger.info(f"Generated quiz {quiz_db.id} with {len(validated)} questions")
    return get_quiz(quiz_db.id, db)


def regenerate_quiz_question(
    question_id: int,
    db: Session,
) -> Dict:
    """
    Generate a single replacement question for a specific question ID.
    Re-uses the context and learning outcomes to fetch a new question from the LLM.
    
    Args:
        question_id: The ID of the QuizQuestion to replace
        db: Database session
        
    Returns:
        The updated question dictionary
    """
    if not is_ollama_available():
        raise RuntimeError("Ollama LLM is not available. Please install and run Ollama.")

    # Get the existing question
    question = db.query(QuizQuestion).filter(QuizQuestion.id == question_id).first()
    if not question:
        raise ValueError(f"Question with ID {question_id} not found.")

    # Get the parent quiz
    quiz = db.query(Quiz).filter(Quiz.id == question.quiz_id).first()
    if not quiz:
        raise ValueError("Parent quiz not found.")

    # Get learning outcomes
    outcomes = get_learning_outcomes(db)
    if not outcomes:
        raise ValueError("Required learning outcomes missing for regeneration.")

    # ── Smart retrieval for regeneration ─────────────────────────────────
    outcome_queries = [question.learning_outcome] if question.learning_outcome else [o['text'] for o in outcomes]
    
    relevant_chunks = retrieve_relevant_chunks(
        queries=outcome_queries,
        top_k_per_query=3,
        min_similarity=0.2,
        max_total_chunks=5,
    )

    # Fallback
    if not relevant_chunks:
        logger.warning("Smart retrieval returned no results for regeneration, using get_all_content")
        all_content = get_all_content(limit=10)
        relevant_chunks = [{"text": c["text"], "source": c.get("source", "unknown")} 
                          for c in all_content]

    content_budget = _calculate_content_budget(1)  # single question
    content_text, tokens_used = compress_for_budget(
        chunks=relevant_chunks,
        token_budget=content_budget,
    )
    outcomes_text = "\n".join(f"{i+1}. {o['text']}" for i, o in enumerate(outcomes))
    
    prev_question_text = f"Q: {question.question}\nA: {question.options[question.correct_answer]}"

    prompt = SINGLE_QUESTION_PROMPT.format(
        difficulty=quiz.difficulty,
        previous_question=prev_question_text,
        content=content_text,
        outcomes=outcomes_text,
    )

    logger.info(f"Regenerating question {question_id} at {quiz.difficulty} difficulty")

    raw_response = generate_complete(
        prompt=prompt,
        system_prompt=QUIZ_SYSTEM_PROMPT,
        temperature=0.6,
        max_tokens=500,
        num_ctx=DEFAULT_NUM_CTX,
    )

    if not raw_response:
        raise RuntimeError("LLM returned an empty response. Please try again.")

    parsed_q = _parse_quiz_json(raw_response)
    if not parsed_q or not isinstance(parsed_q, list) or len(parsed_q) == 0:
        raise RuntimeError("Failed to parse a valid replacement question.")
        
    new_q = parsed_q[0]
    
    # Validation
    if not all(k in new_q for k in ("question", "options", "correctAnswer")):
        raise RuntimeError("Generated question missing required fields.")
    if not isinstance(new_q["options"], list) or len(new_q["options"]) != 4:
        raise RuntimeError("Generated question must have exactly 4 options.")
        
    correct = new_q["correctAnswer"]
    if not isinstance(correct, int) or correct < 0 or correct > 3:
        correct = 0

    # Update database
    question.question = str(new_q["question"])
    question.options = [str(o) for o in new_q["options"]]
    question.correct_answer = correct
    if new_q.get("learningOutcome"):
        question.learning_outcome = new_q.get("learningOutcome")
        
    db.commit()

    return {
        "id": question.id,
        "question": question.question,
        "options": question.options,
        "correctAnswer": question.correct_answer,
        "learningOutcome": question.learning_outcome,
        "difficulty": question.difficulty,
    }


# ─── Quiz CRUD ──────────────────────────────────────────────────────────────

def _format_quiz(quiz: Quiz) -> Dict:
    return {
        "id": quiz.id,
        "difficulty": quiz.difficulty,
        "num_questions": quiz.num_questions,
        "status": quiz.status,
        "created_at": quiz.created_at.isoformat() if quiz.created_at else None,
        "released_at": quiz.released_at.isoformat() if quiz.released_at else None,
        "questions": [
            {
                "id": q.id,
                "question": q.question,
                "options": q.options,
                "correctAnswer": q.correct_answer,
                "learningOutcome": q.learning_outcome,
                "difficulty": q.difficulty,
            }
            for q in quiz.questions
        ]
    }


def get_all_quizzes(db: Session) -> List[Dict]:
    """Get all quizzes."""
    quizzes = db.query(Quiz).order_by(Quiz.created_at.desc()).all()
    return [_format_quiz(q) for q in quizzes]


def get_quiz(quiz_id: str, db: Session) -> Optional[Dict]:
    """Get a specific quiz by ID."""
    quiz = db.query(Quiz).filter(Quiz.id == quiz_id).first()
    if not quiz:
        return None
    return _format_quiz(quiz)


def release_quiz(quiz_id: str, db: Session) -> Optional[Dict]:
    """Mark a quiz as released to students."""
    from datetime import datetime
    import pytz
    quiz = db.query(Quiz).filter(Quiz.id == quiz_id).first()
    if not quiz:
        return None
        
    quiz.status = "released"
    quiz.released_at = datetime.now(pytz.UTC)
    db.commit()
    logger.info(f"Released quiz {quiz_id}")
    return _format_quiz(quiz)


def delete_quiz(quiz_id: str, db: Session) -> bool:
    """Delete a quiz."""
    quiz = db.query(Quiz).filter(Quiz.id == quiz_id).first()
    if not quiz:
        return False
    db.delete(quiz)
    db.commit()
    logger.info(f"Deleted quiz {quiz_id}")
    return True


def update_quiz_questions(quiz_id: str, updated_questions: List[Dict], db: Session) -> Optional[Dict]:
    """
    Update the questions of an existing quiz.
    Replaces the text, options, and correct answers.
    """
    quiz = db.query(Quiz).filter(Quiz.id == quiz_id).first()
    if not quiz:
        return None

    for q_data in updated_questions:
        q_id = q_data.get("id")
        if not q_id:
            continue
            
        question = db.query(QuizQuestion).filter(
            QuizQuestion.id == q_id, 
            QuizQuestion.quiz_id == quiz_id
        ).first()
        
        if question:
            question.question = str(q_data.get("question", question.question))
            if "options" in q_data and isinstance(q_data["options"], list) and len(q_data["options"]) == 4:
                question.options = [str(o) for o in q_data["options"]]
            
            if "correctAnswer" in q_data:
                correct = q_data["correctAnswer"]
                if isinstance(correct, int) and 0 <= correct <= 3:
                    question.correct_answer = correct
                    
            if "learningOutcome" in q_data:
                question.learning_outcome = q_data.get("learningOutcome")

    db.commit()
    logger.info(f"Updated questions for quiz {quiz_id}")
    return get_quiz(quiz_id, db)


def get_released_quizzes(db: Session) -> List[Dict]:
    """Get only released quizzes (student-facing)."""
    quizzes = db.query(Quiz).filter(Quiz.status == "released").order_by(Quiz.released_at.desc()).all()
    return [_format_quiz(q) for q in quizzes]


# ─── Student Responses ──────────────────────────────────────────────────────

def submit_quiz_response(
    quiz_id: str,
    student_id: str,
    student_name: str,
    answers: List[Dict],
    db: Session,
) -> Dict:
    """
    Submit a student's quiz answers.
    
    Args:
        quiz_id: ID of the quiz
        student_id: Student identifier
        student_name: Student display name
        answers: List of {questionId, selectedAnswer}
        db: Database session
    
    Returns:
        Results dict with score and per-question results
    """
    quiz = get_quiz(quiz_id, db)
    if not quiz:
        raise ValueError(f"Quiz {quiz_id} not found")

    # Grade the answers
    results = []
    correct_count = 0
    answers_dict = {}
    
    for ans in answers:
        q_id = ans.get("questionId")
        selected = ans.get("selectedAnswer")
        answers_dict[str(q_id)] = selected
        
        # Find matching question
        question = None
        for q in quiz["questions"]:
            if q["id"] == q_id:
                question = q
                break
        if question is None:
            continue
        is_correct = selected == question["correctAnswer"]
        if is_correct:
            correct_count += 1
        results.append({
            "questionId": q_id,
            "selectedAnswer": selected,
            "correctAnswer": question["correctAnswer"],
            "isCorrect": is_correct,
            "learningOutcome": question.get("learningOutcome", ""),
        })

    # Build response record
    db_response = QuizResponse(
        quiz_id=quiz_id,
        student_id=student_id,
        student_name=student_name,
        score=correct_count,
        total_questions=len(results),
        answers=answers_dict
    )
    db.add(db_response)
    db.commit()

    logger.info(
        f"Student {student_name} submitted quiz {quiz_id}: "
        f"{correct_count}/{len(results)} correct"
    )

    percentage = round(correct_count / len(results) * 100) if results else 0

    return {
        "id": db_response.id,
        "quiz_id": quiz_id,
        "student_id": student_id,
        "student_name": student_name,
        "answers": results,
        "score": correct_count,
        "total": len(results),
        "percentage": percentage,
        "submitted_at": db_response.submitted_at.isoformat() if db_response.submitted_at else None,
    }

def _format_response(r: QuizResponse, quiz_data: Dict) -> Dict:
    # Reconstruct the "answers" array format expected by the frontend
    results = []
    for q in quiz_data.get("questions", []):
        q_id = str(q["id"])
        if q_id in r.answers:
            selected = r.answers[q_id]
            is_correct = selected == q["correctAnswer"]
            results.append({
                "questionId": q["id"],
                "selectedAnswer": selected,
                "correctAnswer": q["correctAnswer"],
                "isCorrect": is_correct,
                "learningOutcome": q.get("learningOutcome", ""),
            })
            
    percentage = round(r.score / r.total_questions * 100) if r.total_questions else 0

    return {
        "id": r.id,
        "quiz_id": r.quiz_id,
        "student_id": r.student_id,
        "student_name": r.student_name,
        "score": r.score,
        "total": r.total_questions,
        "percentage": percentage,
        "answers": results,
        "submitted_at": r.submitted_at.isoformat() if r.submitted_at else None,
    }


def get_quiz_responses(quiz_id: Optional[str] = None, db: Session = None) -> List[Dict]:
    """Get student responses, optionally filtered by quiz ID."""
    if not db:
        return []
        
    query = db.query(QuizResponse)
    if quiz_id:
        query = query.filter(QuizResponse.quiz_id == quiz_id)
    
    responses = query.order_by(QuizResponse.submitted_at.desc()).all()
    
    # We need the quiz data to format the responses properly
    quiz_cache = {}
    formatted = []
    
    for r in responses:
        if r.quiz_id not in quiz_cache:
            quiz_cache[r.quiz_id] = get_quiz(r.quiz_id, db) or {}
        
        formatted.append(_format_response(r, quiz_cache[r.quiz_id]))
        
    return formatted


def get_quiz_analytics(quiz_id: str, db: Session) -> Dict:
    """
    Compute analytics for a quiz: stats, score distribution, pass/fail,
    learning-outcome achievement, and difficulty breakdown.
    """
    quiz = get_quiz(quiz_id, db)
    if not quiz:
        raise ValueError(f"Quiz {quiz_id} not found")

    responses = get_quiz_responses(quiz_id, db)
    total_submissions = len(responses)

    if total_submissions == 0:
        return {
            "quiz_id": quiz_id,
            "total_submissions": 0,
            "stats": None,
            "score_distribution": [],
            "pass_fail": {"passed": 0, "failed": 0},
            "learning_outcome_achievement": [],
            "difficulty_breakdown": [],
        }

    # --- Overall stats ---
    percentages = [r.get("percentage", 0) for r in responses]
    scores = [r.get("score", 0) for r in responses]
    totals = [r.get("total", 1) for r in responses]
    avg_pct = round(sum(percentages) / total_submissions, 1)
    avg_score = round(sum(scores) / total_submissions, 1)
    max_score = max(scores)
    min_score = min(scores)
    max_total = totals[0] if totals else 0

    # --- Score distribution buckets ---
    buckets = {"0-20%": 0, "21-40%": 0, "41-60%": 0, "61-80%": 0, "81-100%": 0}
    for pct in percentages:
        if pct <= 20:
            buckets["0-20%"] += 1
        elif pct <= 40:
            buckets["21-40%"] += 1
        elif pct <= 60:
            buckets["41-60%"] += 1
        elif pct <= 80:
            buckets["61-80%"] += 1
        else:
            buckets["81-100%"] += 1
    score_distribution = [{"range": k, "count": v} for k, v in buckets.items()]

    # --- Pass / fail (>=60% = pass) ---
    passed = sum(1 for p in percentages if p >= 60)
    failed = total_submissions - passed

    # --- Per-learning-outcome achievement ---
    lo_stats: Dict[str, Dict] = {}  # lo_text -> {correct, total}
    for resp in responses:
        for ans in resp.get("answers", []):
            lo = ans.get("learningOutcome", "General")
            if lo not in lo_stats:
                lo_stats[lo] = {"correct": 0, "total": 0}
            lo_stats[lo]["total"] += 1
            if ans.get("isCorrect"):
                lo_stats[lo]["correct"] += 1

    lo_achievement = []
    for lo_text, st in lo_stats.items():
        lo_achievement.append({
            "outcome": lo_text[:80],  # truncate for chart labels
            "correct": st["correct"],
            "total": st["total"],
            "percentage": round(st["correct"] / st["total"] * 100, 1) if st["total"] else 0,
        })

    # --- Difficulty breakdown ---
    diff_stats: Dict[str, Dict] = {}
    for q in quiz.get("questions", []):
        diff = q.get("difficulty", "Unknown")
        if diff not in diff_stats:
            diff_stats[diff] = {"correct": 0, "total": 0}
    for resp in responses:
        for ans in resp.get("answers", []):
            q_id = ans.get("questionId")
            question = None
            for q in quiz.get("questions", []):
                if q["id"] == q_id:
                    question = q
                    break
            if question:
                diff = question.get("difficulty", "Unknown")
                if diff not in diff_stats:
                    diff_stats[diff] = {"correct": 0, "total": 0}
                diff_stats[diff]["total"] += 1
                if ans.get("isCorrect"):
                    diff_stats[diff]["correct"] += 1

    difficulty_breakdown = []
    for diff, st in diff_stats.items():
        difficulty_breakdown.append({
            "difficulty": diff,
            "correct": st["correct"],
            "incorrect": st["total"] - st["correct"],
            "total": st["total"],
            "percentage": round(st["correct"] / st["total"] * 100, 1) if st["total"] else 0,
        })

    return {
        "quiz_id": quiz_id,
        "total_submissions": total_submissions,
        "stats": {
            "average_score": avg_score,
            "average_percentage": avg_pct,
            "max_score": max_score,
            "min_score": min_score,
            "max_total": max_total,
        },
        "score_distribution": score_distribution,
        "pass_fail": {"passed": passed, "failed": failed},
        "learning_outcome_achievement": lo_achievement,
        "difficulty_breakdown": difficulty_breakdown,
    }
