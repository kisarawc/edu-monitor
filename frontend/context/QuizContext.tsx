"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useAuth } from "./AuthContext";

const API_BASE_URL = "http://localhost:8000";

interface QuizQuestion {
    id: number;
    question: string;
    options: string[];
    correctAnswer: number;
    learningOutcome: string;
    difficulty: string;
}

interface Quiz {
    id: string;
    questions: QuizQuestion[];
    difficulty: string;
    num_questions: number;
    status: string;
    created_at: string;
}

interface QuizContextType {
    releasedQuizzes: Quiz[];
    activeQuiz: Quiz | null;
    showQuizPopup: boolean;
    quizNotification: boolean;
    quizResult: { score: number; total: number } | null;
    currentQuizIndex: number;
    selectedAnswer: number | null;
    hasSubmitted: boolean;
    triggerQuiz: (quiz?: Quiz) => void;
    closeQuiz: () => void;
    submitQuizAnswer: () => void;
    nextQuestion: () => void;
    resetQuiz: () => void;
    setSelectedAnswer: (index: number | null) => void;
    completedQuizzes: Set<string>;
}

const QuizContext = createContext<QuizContextType | undefined>(undefined);

export function QuizProvider({ children }: { children: React.ReactNode }) {
    const [releasedQuizzes, setReleasedQuizzes] = useState<Quiz[]>([]);
    const [activeQuiz, setActiveQuiz] = useState<Quiz | null>(null);
    const [showQuizPopup, setShowQuizPopup] = useState(false);
    const [quizNotification, setQuizNotification] = useState(false);
    const [quizResult, setQuizResult] = useState<{ score: number; total: number } | null>(null);
    const [currentQuizIndex, setCurrentQuizIndex] = useState(0);
    const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
    const [hasSubmitted, setHasSubmitted] = useState(false);
    const [quizAnswers, setQuizAnswers] = useState<{ questionId: number; selectedAnswer: number }[]>([]);

    const { user } = useAuth();

    const [completedQuizzes, setCompletedQuizzes] = useState<Set<string>>(new Set());

    const fetchReleasedQuizzes = useCallback(async () => {
        try {
            const res = await fetch(`${API_BASE_URL}/api/performance/quiz/released`);
            const rRes = await fetch(`${API_BASE_URL}/api/performance/quiz/responses/all`);

            if (res.ok && rRes.ok) {
                const data = await res.json();
                const rData = await rRes.json();

                const quizzes: Quiz[] = data.quizzes || [];
                const currentStudentId = user?.id ? String(user.id) : "anonymous";
                const studentResponses = (rData.responses || []).filter(
                    (r: any) => String(r.student_id) === currentStudentId
                );

                const completedSet = new Set<string>();
                studentResponses.forEach((r: any) => completedSet.add(r.quiz_id));
                setCompletedQuizzes(completedSet);
                setReleasedQuizzes(quizzes);

                const uncompleted = quizzes.filter(q => !completedSet.has(q.id));
                if (uncompleted.length > 0) setQuizNotification(true);
                else setQuizNotification(false);
            }
        } catch (e) {
            console.error("Failed to fetch quizzes:", e);
        }
    }, [user?.id]);

    useEffect(() => {
        fetchReleasedQuizzes();
        // Refresh every minute
        const interval = setInterval(fetchReleasedQuizzes, 60000);
        return () => clearInterval(interval);
    }, [fetchReleasedQuizzes]);

    const triggerQuiz = (quiz?: Quiz) => {
        let target = quiz;

        if (!target) {
            // Find first uncompleted quiz
            target = releasedQuizzes.find(q => !completedQuizzes.has(q.id));
        }

        if (!target && releasedQuizzes.length > 0) {
            // Fallback to first quiz if all are completed (just to show something, though it will be blocked)
            target = releasedQuizzes[0];
        }

        if (!target) return;

        setActiveQuiz(target);
        setCurrentQuizIndex(0);
        setShowQuizPopup(true);
        setSelectedAnswer(null);
        setHasSubmitted(false);
        setQuizNotification(false);
        setQuizResult(null);
        setQuizAnswers([]);
    };

    const closeQuiz = () => {
        setShowQuizPopup(false);
        setSelectedAnswer(null);
        setHasSubmitted(false);
        setActiveQuiz(null);
    };

    const submitQuizAnswer = () => {
        if (selectedAnswer !== null && activeQuiz) {
            const currentQuestion = activeQuiz.questions[currentQuizIndex];
            setHasSubmitted(true);
            setQuizAnswers((prev) => [...prev, { questionId: currentQuestion.id, selectedAnswer }]);
        }
    };

    const nextQuestion = async () => {
        if (!activeQuiz) return;
        if (currentQuizIndex < activeQuiz.questions.length - 1) {
            setCurrentQuizIndex(currentQuizIndex + 1);
            setSelectedAnswer(null);
            setHasSubmitted(false);
        } else {
            const allAnswers = [...quizAnswers];
            const currentStudentId = user?.id ? String(user.id) : "anonymous";
            const currentStudentName = user?.username ? user.username : `Student (${currentStudentId.substring(8)})`;
            try {
                const res = await fetch(`${API_BASE_URL}/api/performance/quiz/${activeQuiz.id}/submit`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        student_id: currentStudentId,
                        student_name: currentStudentName,
                        answers: allAnswers,
                    }),
                });
                const data = await res.json();
                if (res.ok && data.success) {
                    setQuizResult({ score: data.result.score, total: data.result.total });
                    setCompletedQuizzes(prev => {
                        const newSet = new Set(prev);
                        newSet.add(activeQuiz.id);
                        return newSet;
                    });
                    // Keep showQuizPopup true to show the result modal!
                } else {
                    setShowQuizPopup(false);
                }
            } catch (e) {
                console.error("Failed to submit quiz:", e);
                setShowQuizPopup(false);
            }
        }
    };

    const resetQuiz = () => {
        setShowQuizPopup(false);
        setQuizResult(null);
        setActiveQuiz(null);
        setSelectedAnswer(null);
        setHasSubmitted(false);
        fetchReleasedQuizzes(); // Refresh list to update notifications
    };

    return (
        <QuizContext.Provider
            value={{
                releasedQuizzes,
                activeQuiz,
                showQuizPopup,
                quizNotification,
                quizResult,
                currentQuizIndex,
                selectedAnswer,
                hasSubmitted,
                triggerQuiz,
                closeQuiz,
                submitQuizAnswer,
                nextQuestion,
                resetQuiz,
                setSelectedAnswer,
                completedQuizzes,
            }}
        >
            {children}
        </QuizContext.Provider>
    );
}

export function useQuiz() {
    const context = useContext(QuizContext);
    if (context === undefined) {
        throw new Error("useQuiz must be used within a QuizProvider");
    }
    return context;
}
