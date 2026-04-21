"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
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

/** Which custom confirmation modal to show (null = none) */
export type ConfirmModalType = "start" | "leave" | "already-completed" | null;

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
    isStartingQuiz: boolean;
    /* Custom confirm-modal state */
    confirmModal: ConfirmModalType;
    confirmModalQuiz: Quiz | null;
    onConfirmModal: () => void;
    onCancelModal: () => void;
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
    const [isStartingQuiz, setIsStartingQuiz] = useState(false);

    // Custom confirm-modal state
    const [confirmModal, setConfirmModal] = useState<ConfirmModalType>(null);
    const [confirmModalQuiz, setConfirmModalQuiz] = useState<Quiz | null>(null);
    // Refs to resolve the modal promise
    const confirmResolverRef = useRef<((ok: boolean) => void) | null>(null);

    const { user } = useAuth();

    const [completedQuizzes, setCompletedQuizzes] = useState<Set<string>>(new Set());

    // ── Helper: show a custom modal and wait for the user's choice ───────
    const showModal = (type: ConfirmModalType, quiz: Quiz | null = null): Promise<boolean> => {
        return new Promise((resolve) => {
            confirmResolverRef.current = resolve;
            setConfirmModalQuiz(quiz);
            setConfirmModal(type);
        });
    };

    const onConfirmModal = () => {
        confirmResolverRef.current?.(true);
        confirmResolverRef.current = null;
        setConfirmModal(null);
        setConfirmModalQuiz(null);
    };

    const onCancelModal = () => {
        confirmResolverRef.current?.(false);
        confirmResolverRef.current = null;
        setConfirmModal(null);
        setConfirmModalQuiz(null);
    };

    // ── Fetch released quizzes ───────────────────────────────────────────
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
        const interval = setInterval(fetchReleasedQuizzes, 60000);
        return () => clearInterval(interval);
    }, [fetchReleasedQuizzes]);

    // ── Trigger (start) a quiz ───────────────────────────────────────────
    const triggerQuiz = async (quiz?: Quiz) => {
        let target = quiz;
        if (!target) target = releasedQuizzes.find(q => !completedQuizzes.has(q.id));
        if (!target && releasedQuizzes.length > 0) target = releasedQuizzes[0];
        if (!target) return;

        setIsStartingQuiz(true);

        try {
            // Server-side completion check
            const currentStudentId = user?.id ? String(user.id) : "anonymous";
            const checkRes = await fetch(
                `${API_BASE_URL}/api/performance/quiz/${target.id}/check-attempt?student_id=${encodeURIComponent(currentStudentId)}`
            );
            if (checkRes.ok) {
                const checkData = await checkRes.json();
                if (checkData.completed) {
                    // Show "already completed" modal
                    await showModal("already-completed", target);
                    setCompletedQuizzes(prev => { const s = new Set(prev); s.add(target!.id); return s; });
                    setIsStartingQuiz(false);
                    return;
                }
            }

            // Show start-confirmation modal
            const confirmed = await showModal("start", target);
            if (!confirmed) {
                setIsStartingQuiz(false);
                return;
            }

            // Open the quiz
            setActiveQuiz(target);
            setCurrentQuizIndex(0);
            setShowQuizPopup(true);
            setSelectedAnswer(null);
            setHasSubmitted(false);
            setQuizNotification(false);
            setQuizResult(null);
            setQuizAnswers([]);
        } catch (e) {
            console.error("Failed to start quiz:", e);
        } finally {
            setIsStartingQuiz(false);
        }
    };

    // ── Close quiz mid-progress ──────────────────────────────────────────
    const closeQuiz = async () => {
        // If result is showing, close freely
        if (quizResult) {
            setShowQuizPopup(false);
            setSelectedAnswer(null);
            setHasSubmitted(false);
            setActiveQuiz(null);
            return;
        }

        // If student has progress, show "leave" modal
        const hasProgress = quizAnswers.length > 0 || selectedAnswer !== null;
        if (hasProgress) {
            const confirmed = await showModal("leave");
            if (!confirmed) return;
        }

        // Discard everything
        setShowQuizPopup(false);
        setSelectedAnswer(null);
        setHasSubmitted(false);
        setActiveQuiz(null);
        setQuizAnswers([]);
        setCurrentQuizIndex(0);
    };

    // ── Submit answer for current question ───────────────────────────────
    const submitQuizAnswer = () => {
        if (selectedAnswer !== null && activeQuiz) {
            const currentQuestion = activeQuiz.questions[currentQuizIndex];
            setHasSubmitted(true);
            setQuizAnswers((prev) => [...prev, { questionId: currentQuestion.id, selectedAnswer }]);
        }
    };

    // ── Next question / finish quiz ──────────────────────────────────────
    const nextQuestion = async () => {
        if (!activeQuiz) return;
        if (currentQuizIndex < activeQuiz.questions.length - 1) {
            setCurrentQuizIndex(currentQuizIndex + 1);
            setSelectedAnswer(null);
            setHasSubmitted(false);
        } else {
            const allAnswers = [...quizAnswers];
            const currentStudentId = user?.id ? String(user.id) : "anonymous";
            const currentStudentName = user?.username
                ? user.username
                : `Student (${currentStudentId.substring(8)})`;
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

                if (res.status === 409) {
                    await showModal("already-completed", activeQuiz);
                    setCompletedQuizzes(prev => { const s = new Set(prev); s.add(activeQuiz.id); return s; });
                    setShowQuizPopup(false);
                    return;
                }

                if (res.ok && data.success) {
                    setQuizResult({ score: data.result.score, total: data.result.total });
                    setCompletedQuizzes(prev => { const s = new Set(prev); s.add(activeQuiz.id); return s; });
                } else {
                    console.error("Quiz submission failed:", data);
                    setShowQuizPopup(false);
                }
            } catch (e) {
                console.error("Failed to submit quiz:", e);
                setShowQuizPopup(false);
            }
        }
    };

    // ── Reset (back to dashboard from result screen) ─────────────────────
    const resetQuiz = () => {
        setShowQuizPopup(false);
        setQuizResult(null);
        setActiveQuiz(null);
        setSelectedAnswer(null);
        setHasSubmitted(false);
        setQuizAnswers([]);
        setCurrentQuizIndex(0);
        fetchReleasedQuizzes();
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
                isStartingQuiz,
                confirmModal,
                confirmModalQuiz,
                onConfirmModal,
                onCancelModal,
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
