"""
seed_evaluation_data.py — Seed HITL Evaluation Demo Data
=========================================================

Seeds realistic Human-in-the-Loop evaluation data into the database
for the AI Evaluation dashboard. Run this script before presenting 
the evaluation dashboard to your supervisor.

Usage:
    cd backend
    python seed_evaluation_data.py          # Seed data (default)
    python seed_evaluation_data.py --clear  # Clear all evaluation data
    python seed_evaluation_data.py --reset  # Clear + re-seed fresh data
"""

import sys
import os
import random
import uuid
from datetime import datetime, timedelta

import pytz

# Ensure we can import from the backend package
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from database import engine, Base, SessionLocal
from modules.performance.models import AIFeedback, QuizEditLog, Quiz

# Ensure tables exist
Base.metadata.create_all(bind=engine)


# ═══════════════════════════════════════════════════════════════
# SAMPLE DATA — Realistic IT lecture Q&A and summary interactions
# ═══════════════════════════════════════════════════════════════

QA_SAMPLES = [
    # Positive Q&A feedback (~80% positive, reflecting realistic satisfaction)
    {"q": "What is polymorphism in OOP?", "r": "Polymorphism allows objects of different classes to be treated as objects of a common superclass. It enables one interface to be used for a general class of actions.", "rating": 1},
    {"q": "Explain the difference between TCP and UDP", "r": "TCP is connection-oriented, reliable, and ensures ordered delivery. UDP is connectionless, faster but unreliable, used for streaming and gaming.", "rating": 1},
    {"q": "What is normalization in databases?", "r": "Normalization is the process of organizing data to reduce redundancy. It involves dividing tables and establishing relationships using normal forms (1NF, 2NF, 3NF, BCNF).", "rating": 1},
    {"q": "How does a binary search tree work?", "r": "A BST is a tree structure where each node has at most two children. Left child values are less than the parent, right child values are greater.", "rating": 1},
    {"q": "What is encapsulation?", "r": "Encapsulation is bundling data and methods that operate on that data within a single unit (class), restricting direct access to some components.", "rating": 1},
    {"q": "Explain the OSI model", "r": "The OSI model has 7 layers: Physical, Data Link, Network, Transport, Session, Presentation, and Application. Each layer serves a specific networking function.", "rating": 1},
    {"q": "What is a design pattern?", "r": "Design patterns are reusable solutions to common software design problems. Examples include Singleton, Factory, Observer, and Strategy patterns.", "rating": 1},
    {"q": "Explain recursion", "r": "Recursion is when a function calls itself. It needs a base case to terminate and a recursive case to progress toward the base case.", "rating": 1},
    {"q": "What is cloud computing?", "r": "Cloud computing delivers computing services over the internet, including servers, storage, databases, networking, and software.", "rating": 1},
    {"q": "What is agile methodology?", "r": "Agile is an iterative approach to project management and software development. It emphasizes flexibility, collaboration, and customer feedback.", "rating": 1},
    {"q": "Explain inheritance in Java", "r": "Inheritance allows a class to inherit properties and methods from another class using the extends keyword. It promotes code reuse.", "rating": 1},
    {"q": "What is an API?", "r": "An API (Application Programming Interface) defines how software components should interact. REST APIs use HTTP methods like GET, POST, PUT, DELETE.", "rating": 1},
    {"q": "What is machine learning?", "r": "Machine learning is a subset of AI where systems learn from data to improve performance without explicit programming.", "rating": 1},
    {"q": "What is version control?", "r": "Version control systems like Git track changes to code over time, enabling collaboration and rollback capabilities.", "rating": 1},
    {"q": "What is a REST API?", "r": "REST APIs follow architectural constraints including statelessness, client-server separation, and uniform interface using HTTP methods.", "rating": 1},
    {"q": "Explain the MVC pattern", "r": "MVC separates application into Model (data), View (UI), and Controller (logic). This separation improves maintainability.", "rating": 1},

    # Negative Q&A feedback (~20% — realistic weak spots)
    {"q": "What are the SOLID principles?", "r": "SOLID stands for five design principles in OOP.", "rating": 0, "comment": "Could explain each principle separately with examples"},
    {"q": "How does garbage collection work?", "r": "Garbage collection automatically frees memory.", "rating": 0, "comment": "Explanation was too vague, needs more detail"},
    {"q": "Explain SQL joins", "r": "SQL joins combine rows from tables.", "rating": 0, "comment": "Missing LEFT and RIGHT join explanations"},
    {"q": "What is Big O notation?", "r": "Big O describes algorithm complexity.", "rating": 0, "comment": "Wrong examples for time complexities, mixed up O(n) and O(log n)"},
]

SUMMARY_SAMPLES = [
    # Positive summary feedback
    {"type": "advanced", "rating": 1, "r": "Comprehensive lecture summary covering all key topics including OOP concepts, database normalization, and software design patterns."},
    {"type": "quick", "rating": 1, "r": "Brief but accurate overview of the networking lecture covering TCP/IP, OSI model, and protocols."},
    {"type": "advanced", "rating": 1, "r": "Detailed summary with proper structure, examples, and references to learning outcomes."},
    {"type": "advanced", "rating": 1, "r": "Well-structured summary covering software engineering lifecycle and testing methodologies."},
    {"type": "advanced", "rating": 1, "r": "Excellent coverage of the networking concepts with clear explanations of each layer."},
    {"type": "quick", "rating": 1, "r": "Good quick reference for exam preparation covering all major topics from Week 3."},
    {"type": "quick", "rating": 1, "r": "Covered main points effectively. Useful as a revision guide."},
    {"type": "advanced", "rating": 1, "r": "Thorough analysis of software engineering principles with practical examples."},
    {"type": "quick", "rating": 1, "r": "Useful quick summary before the quiz. Highlighted the key definitions."},
    {"type": "advanced", "rating": 1, "r": "Complete coverage of the lecture with good examples and learning outcome mapping."},
    {"type": "advanced", "rating": 1, "r": "Detailed and well-organized summary of the data structures lecture."},
    {"type": "quick", "rating": 1, "r": "Concise overview that captures the essentials of cloud computing concepts."},

    # Negative summary feedback
    {"type": "quick", "rating": 0, "r": "Too brief, missed important details.", "comment": "Missing the database normalization section entirely"},
    {"type": "advanced", "rating": 0, "r": "Summary was too long and repetitive in places.", "comment": "Could be more concise, repeated the same point about inheritance 3 times"},
    {"type": "quick", "rating": 0, "r": "Missed the practical examples from the lecture.", "comment": "No code examples included, only theory"},
]

STUDENT_IDS = ["STU001", "STU002", "STU003", "STU004", "STU005", "STU006", "STU007", "STU008"]

QUIZ_EDIT_ACTIONS = [
    ("edit", "Teacher refined question wording for clarity"),
    ("edit", "Teacher updated answer options to remove ambiguity"),
    ("edit", "Teacher corrected the correct answer index"),
    ("regenerate", "Teacher regenerated question via AI — original was off-topic"),
    ("regenerate", "Teacher regenerated question — difficulty was too low"),
]


def seed_evaluation_data():
    """Insert realistic HITL evaluation data into the database."""
    db = SessionLocal()
    now = datetime.now(pytz.UTC)
    count = {"qa": 0, "summary": 0, "quiz_edits": 0}

    try:
        # --- Q&A Feedback ---
        for s in QA_SAMPLES:
            days_ago = random.randint(0, 6)
            hours_ago = random.randint(0, 23)
            ts = now - timedelta(days=days_ago, hours=hours_ago, minutes=random.randint(0, 59))
            fb = AIFeedback(
                id=str(uuid.uuid4()),
                feature="qa",
                rating=s["rating"],
                comment=s.get("comment"),
                student_id=random.choice(STUDENT_IDS),
                question=s["q"],
                response=s["r"],
                created_at=ts,
            )
            db.add(fb)
            count["qa"] += 1

        # --- Summary Feedback ---
        for s in SUMMARY_SAMPLES:
            days_ago = random.randint(0, 6)
            hours_ago = random.randint(0, 23)
            ts = now - timedelta(days=days_ago, hours=hours_ago, minutes=random.randint(0, 59))
            fb = AIFeedback(
                id=str(uuid.uuid4()),
                feature="summary",
                rating=s["rating"],
                comment=s.get("comment"),
                student_id=random.choice(STUDENT_IDS),
                response=s["r"],
                summary_type=s["type"],
                created_at=ts,
            )
            db.add(fb)
            count["summary"] += 1

        # --- Quiz Edit Logs (if quizzes exist in DB) ---
        quizzes = db.query(Quiz).all()
        if quizzes:
            for quiz in quizzes[:3]:
                selected_actions = random.sample(QUIZ_EDIT_ACTIONS, min(2, len(QUIZ_EDIT_ACTIONS)))
                for action, detail in selected_actions:
                    ts = now - timedelta(days=random.randint(0, 5), hours=random.randint(0, 12))
                    log = QuizEditLog(
                        id=str(uuid.uuid4()),
                        quiz_id=quiz.id,
                        question_id=random.randint(1, 5),
                        action=action,
                        details=detail,
                        created_at=ts,
                    )
                    db.add(log)
                    count["quiz_edits"] += 1
            print(f"  [+] Quiz edit logs: {count['quiz_edits']} entries (from {min(3, len(quizzes))} quizzes)")
        else:
            print("  [!] No quizzes found in DB - quiz edit logs skipped")
            print("     (Generate some quizzes from the teacher dashboard first)")

        db.commit()

        print(f"\n[OK] Evaluation data seeded successfully!")
        print(f"  Q&A feedback:     {count['qa']} entries ({sum(1 for s in QA_SAMPLES if s['rating'] == 1)} positive, {sum(1 for s in QA_SAMPLES if s['rating'] == 0)} negative)")
        print(f"  Summary feedback: {count['summary']} entries ({sum(1 for s in SUMMARY_SAMPLES if s['rating'] == 1)} positive, {sum(1 for s in SUMMARY_SAMPLES if s['rating'] == 0)} negative)")
        print(f"  Total entries:    {count['qa'] + count['summary'] + count['quiz_edits']}")
        print(f"\n  View at: http://localhost:3000/admin/dashboard/evaluation")
        print(f"  Login as admin -> admin / adminpassword")

    except Exception as e:
        db.rollback()
        print(f"\n[ERROR] Error seeding data: {e}")
        raise
    finally:
        db.close()


def clear_evaluation_data():
    """Remove all HITL evaluation data from the database."""
    db = SessionLocal()
    try:
        qa_count = db.query(AIFeedback).delete()
        edit_count = db.query(QuizEditLog).delete()
        db.commit()
        print(f"\n[OK] Cleared evaluation data:")
        print(f"  Feedback entries removed: {qa_count}")
        print(f"  Quiz edit logs removed:   {edit_count}")
    except Exception as e:
        db.rollback()
        print(f"\n[ERROR] Error clearing data: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    print("=" * 55)
    print("  EduMonitor — HITL Evaluation Data Seeder")
    print("=" * 55)

    if "--clear" in sys.argv:
        clear_evaluation_data()
    elif "--reset" in sys.argv:
        clear_evaluation_data()
        print()
        seed_evaluation_data()
    else:
        seed_evaluation_data()
