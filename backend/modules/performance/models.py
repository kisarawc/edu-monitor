from sqlalchemy import Column, String, Integer, DateTime, ForeignKey, JSON
from sqlalchemy.orm import relationship
import uuid
from datetime import datetime
import pytz

from database import Base

class LearningOutcome(Base):
    __tablename__ = "learning_outcomes"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    text = Column(String, nullable=False)
    source_filename = Column(String, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(pytz.UTC))


class Quiz(Base):
    __tablename__ = "quizzes"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    difficulty = Column(String, nullable=False, default="Beginner")
    num_questions = Column(Integer, nullable=False, default=5)
    status = Column(String, nullable=False, default="draft")  # draft or released
    created_at = Column(DateTime, default=lambda: datetime.now(pytz.UTC))
    released_at = Column(DateTime, nullable=True)

    questions = relationship("QuizQuestion", back_populates="quiz", cascade="all, delete-orphan")
    responses = relationship("QuizResponse", back_populates="quiz", cascade="all, delete-orphan")


class QuizQuestion(Base):
    __tablename__ = "quiz_questions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    quiz_id = Column(String, ForeignKey("quizzes.id", ondelete="CASCADE"), nullable=False)
    question = Column(String, nullable=False)
    options = Column(JSON, nullable=False)  # List of strings
    correct_answer = Column(Integer, nullable=False)
    learning_outcome = Column(String, nullable=True)
    difficulty = Column(String, nullable=True)

    quiz = relationship("Quiz", back_populates="questions")


class QuizResponse(Base):
    __tablename__ = "quiz_responses"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    quiz_id = Column(String, ForeignKey("quizzes.id", ondelete="CASCADE"), nullable=False)
    student_id = Column(String, nullable=False)
    student_name = Column(String, nullable=True)
    score = Column(Integer, nullable=False, default=0)
    total_questions = Column(Integer, nullable=False, default=0)
    submitted_at = Column(DateTime, default=lambda: datetime.now(pytz.UTC))
    answers = Column(JSON, nullable=False)  # Dictionary pairing question id to selected option index

    quiz = relationship("Quiz", back_populates="responses")


class AIFeedback(Base):
    """
    Stores per-interaction feedback from students on AI-generated content.
    Used for Human-in-the-Loop evaluation of the AI system.
    """
    __tablename__ = "ai_feedback"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    feature = Column(String, nullable=False)          # "qa" | "summary"
    rating = Column(Integer, nullable=False)           # 1 = positive, 0 = negative
    comment = Column(String, nullable=True)            # optional free-text feedback
    student_id = Column(String, nullable=True)         # who gave feedback

    # Context fields — what was rated
    question = Column(String, nullable=True)           # the student's question (for qa)
    response = Column(String, nullable=True)           # the AI response that was rated
    summary_type = Column(String, nullable=True)       # "quick" | "advanced" (for summary)

    created_at = Column(DateTime, default=lambda: datetime.now(pytz.UTC))


class QuizEditLog(Base):
    """
    Tracks teacher edits to AI-generated quizzes.
    A low edit rate indicates the AI produces high-quality, publication-ready content.
    """
    __tablename__ = "quiz_edit_logs"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    quiz_id = Column(String, ForeignKey("quizzes.id", ondelete="CASCADE"), nullable=False)
    question_id = Column(Integer, nullable=True)       # specific question edited (null for quiz-level actions)
    action = Column(String, nullable=False)            # "edit" | "regenerate" | "delete"
    details = Column(String, nullable=True)            # optional context (e.g. what was changed)
    created_at = Column(DateTime, default=lambda: datetime.now(pytz.UTC))
