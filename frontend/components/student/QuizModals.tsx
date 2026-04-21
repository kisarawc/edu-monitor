"use client";

import React, { useEffect } from 'react';
import {
    Brain,
    X,
    CheckCircle2,
    AlertCircle,
    GraduationCap,
    ShieldAlert,
    LogOut,
    ShieldCheck,
    Clock,
    Lock,
    AlertTriangle,
    ArrowRight,
    Ban
} from 'lucide-react';
import { useQuiz } from '@/context/QuizContext';

/* ═══════════════════════════════════════════════════════════════════════════
   Confirmation Modal — Beautiful custom popups that replace browser dialogs
   ═══════════════════════════════════════════════════════════════════════════ */

function ConfirmationModals() {
    const { confirmModal, confirmModalQuiz, onConfirmModal, onCancelModal } = useQuiz();

    if (!confirmModal) return null;

    // ── "Start Quiz" confirmation ─────────────────────────────────────────
    if (confirmModal === "start") {
        return (
            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-md animate-in fade-in duration-200">
                <div className="bg-gray-900 rounded-2xl border border-amber-500/40 shadow-2xl shadow-amber-500/10 w-full max-w-md mx-4 overflow-hidden animate-in zoom-in-95 duration-300">
                    {/* Glow header */}
                    <div className="relative bg-gradient-to-br from-amber-500/20 via-orange-500/10 to-transparent px-6 pt-7 pb-5">
                        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-amber-500/60 to-transparent" />
                        
                        <button 
                            type="button"
                            onClick={onCancelModal}
                            className="absolute top-4 right-4 p-1.5 text-gray-400 hover:text-white bg-gray-800/50 hover:bg-gray-700/50 rounded-lg transition-colors"
                        >
                            <X size={18} />
                        </button>

                        <div className="flex items-start gap-4">
                            <div className="p-3 bg-amber-500/20 rounded-xl border border-amber-500/30 shrink-0">
                                <ShieldAlert size={28} className="text-amber-400" />
                            </div>
                            <div>
                                <h2 className="text-xl font-bold text-white mb-1">Start Quiz?</h2>
                                <p className="text-sm text-gray-400">
                                    {confirmModalQuiz?.num_questions} questions • {confirmModalQuiz?.difficulty} difficulty
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Body with rules */}
                    <div className="px-6 py-5 space-y-4">
                        <div className="space-y-3">
                            <div className="flex items-start gap-3 p-3 bg-amber-500/5 rounded-xl border border-amber-500/10">
                                <Lock size={16} className="text-amber-400 shrink-0 mt-0.5" />
                                <p className="text-sm text-gray-300">
                                    You can only attempt this quiz <strong className="text-amber-400">once</strong>. After submitting, you cannot retake it.
                                </p>
                            </div>
                            <div className="flex items-start gap-3 p-3 bg-blue-500/5 rounded-xl border border-blue-500/10">
                                <Clock size={16} className="text-blue-400 shrink-0 mt-0.5" />
                                <p className="text-sm text-gray-300">
                                    Complete all questions in <strong className="text-blue-400">one sitting</strong> before submitting your answers.
                                </p>
                            </div>
                            <div className="flex items-start gap-3 p-3 bg-gray-800/50 rounded-xl border border-gray-700/50">
                                <LogOut size={16} className="text-gray-400 shrink-0 mt-0.5" />
                                <p className="text-sm text-gray-400">
                                    If you close without finishing, your progress won't be saved — but you can try again later.
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="px-6 py-4 border-t border-gray-800 bg-gray-900/50 flex gap-3">
                        <button
                            onClick={onCancelModal}
                            className="flex-1 py-3 px-4 rounded-xl border border-gray-700 text-gray-300 font-medium hover:bg-gray-800 hover:border-gray-600 transition-all"
                        >
                            Not Now
                        </button>
                        <button
                            onClick={onConfirmModal}
                            className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white font-semibold hover:from-amber-400 hover:to-orange-400 transition-all shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2"
                        >
                            Begin Quiz <ArrowRight size={16} />
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // ── "Leave Quiz" confirmation ─────────────────────────────────────────
    if (confirmModal === "leave") {
        return (
            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-md animate-in fade-in duration-200">
                <div className="bg-gray-900 rounded-2xl border border-red-500/40 shadow-2xl shadow-red-500/10 w-full max-w-md mx-4 overflow-hidden animate-in zoom-in-95 duration-300">
                    {/* Glow header */}
                    <div className="relative bg-gradient-to-br from-red-500/20 via-rose-500/10 to-transparent px-6 pt-7 pb-5">
                        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-red-500/60 to-transparent" />
                        
                        <button 
                            type="button"
                            onClick={onCancelModal}
                            className="absolute top-4 right-4 p-1.5 text-gray-400 hover:text-white bg-gray-800/50 hover:bg-gray-700/50 rounded-lg transition-colors"
                        >
                            <X size={18} />
                        </button>

                        <div className="flex items-start gap-4">
                            <div className="p-3 bg-red-500/20 rounded-xl border border-red-500/30 shrink-0">
                                <AlertTriangle size={28} className="text-red-400" />
                            </div>
                            <div>
                                <h2 className="text-xl font-bold text-white mb-1">Leave Quiz?</h2>
                                <p className="text-sm text-gray-400">
                                    Your progress will be lost
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Body */}
                    <div className="px-6 py-5 space-y-4">
                        <div className="flex items-start gap-3 p-4 bg-red-500/5 rounded-xl border border-red-500/10">
                            <AlertCircle size={18} className="text-red-400 shrink-0 mt-0.5" />
                            <div>
                                <p className="text-sm text-gray-300 mb-1">
                                    Your answers so far will <strong className="text-red-400">not be saved</strong>.
                                </p>
                                <p className="text-xs text-gray-500">
                                    You can attempt this quiz again later since it hasn't been submitted yet.
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="px-6 py-4 border-t border-gray-800 bg-gray-900/50 flex gap-3">
                        <button
                            onClick={onCancelModal}
                            className="flex-1 py-3 px-4 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-500 transition-all shadow-lg shadow-indigo-500/20"
                        >
                            Continue Quiz
                        </button>
                        <button
                            onClick={onConfirmModal}
                            className="flex-1 py-3 px-4 rounded-xl border border-red-500/30 text-red-400 font-medium hover:bg-red-500/10 hover:border-red-500/50 transition-all flex items-center justify-center gap-2"
                        >
                            <LogOut size={16} /> Leave
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // ── "Already Completed" alert ─────────────────────────────────────────
    if (confirmModal === "already-completed") {
        return (
            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-md animate-in fade-in duration-200">
                <div className="bg-gray-900 rounded-2xl border border-emerald-500/40 shadow-2xl shadow-emerald-500/10 w-full max-w-md mx-4 overflow-hidden animate-in zoom-in-95 duration-300">
                    {/* Glow header */}
                    <div className="relative bg-gradient-to-br from-emerald-500/20 via-teal-500/10 to-transparent px-6 pt-7 pb-5">
                        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-emerald-500/60 to-transparent" />
                        
                        <button 
                            type="button"
                            onClick={onConfirmModal}
                            className="absolute top-4 right-4 p-1.5 text-gray-400 hover:text-white bg-gray-800/50 hover:bg-gray-700/50 rounded-lg transition-colors"
                        >
                            <X size={18} />
                        </button>

                        <div className="flex items-start gap-4">
                            <div className="p-3 bg-emerald-500/20 rounded-xl border border-emerald-500/30 shrink-0">
                                <ShieldCheck size={28} className="text-emerald-400" />
                            </div>
                            <div>
                                <h2 className="text-xl font-bold text-white mb-1">Already Completed</h2>
                                <p className="text-sm text-gray-400">
                                    Your submission has been recorded
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Body */}
                    <div className="px-6 py-5">
                        <div className="flex items-start gap-3 p-4 bg-emerald-500/5 rounded-xl border border-emerald-500/10">
                            <Ban size={18} className="text-emerald-400 shrink-0 mt-0.5" />
                            <div>
                                <p className="text-sm text-gray-300 mb-1">
                                    You have already submitted answers for this quiz.
                                </p>
                                <p className="text-xs text-gray-500">
                                    Each quiz can only be attempted once. Your previous submission has been recorded.
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="px-6 py-4 border-t border-gray-800 bg-gray-900/50">
                        <button
                            onClick={onConfirmModal}
                            className="w-full py-3 px-4 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-500 transition-all shadow-lg shadow-emerald-500/20"
                        >
                            Got it
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return null;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Main Quiz Modals — Quiz UI (question modal + result modal)
   ═══════════════════════════════════════════════════════════════════════════ */

export default function QuizModals() {
    const {
        activeQuiz,
        showQuizPopup,
        quizResult,
        currentQuizIndex,
        selectedAnswer,
        hasSubmitted,
        closeQuiz,
        submitQuizAnswer,
        nextQuestion,
        resetQuiz,
        setSelectedAnswer
    } = useQuiz();

    const currentQuestion = activeQuiz ? activeQuiz.questions[currentQuizIndex] : null;

    // Warn student if they try to close/refresh the browser tab during a quiz
    useEffect(() => {
        if (!showQuizPopup || quizResult) return;

        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            e.preventDefault();
            e.returnValue = "You have an active quiz. If you leave, your progress will NOT be saved.";
            return e.returnValue;
        };

        window.addEventListener("beforeunload", handleBeforeUnload);
        return () => window.removeEventListener("beforeunload", handleBeforeUnload);
    }, [showQuizPopup, quizResult]);

    return (
        <>
            {/* Custom confirmation modals (always render so they overlay everything) */}
            <ConfirmationModals />

            {/* Quiz UI modals */}
            {showQuizPopup && activeQuiz && (
                <>
                    {/* ── Quiz Result Modal ───────────────────────────── */}
                    {quizResult ? (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
                            <div className="bg-gray-900 rounded-2xl border border-indigo-500/50 shadow-2xl shadow-indigo-500/20 w-full max-w-md mx-4 overflow-hidden text-center p-8 animate-in zoom-in-95 duration-300">
                                {(() => {
                                    const percentage = Math.round((quizResult.score / quizResult.total) * 100);
                                    const isPassing = percentage >= 60;
                                    return (
                                        <>
                                            <div className={`w-20 h-20 mx-auto rounded-full flex items-center justify-center mb-6 shadow-lg ${isPassing
                                                ? 'bg-gradient-to-br from-emerald-400 to-teal-500 shadow-emerald-500/20'
                                                : 'bg-gradient-to-br from-orange-400 to-red-500 shadow-red-500/20'
                                                }`}>
                                                <GraduationCap size={40} className="text-white" />
                                            </div>
                                            <h2 className="text-2xl font-bold text-white mb-2">Quiz Completed!</h2>
                                            <p className="text-gray-400 mb-8">Your answers have been recorded. You cannot retake this quiz.</p>

                                            <div className="bg-gray-800/80 rounded-xl p-6 mb-8 border border-gray-700">
                                                <p className="text-sm text-gray-400 mb-1">Your Score</p>
                                                <div className="flex items-baseline justify-center gap-1">
                                                    <span className={`text-5xl font-black text-transparent bg-clip-text ${isPassing
                                                        ? 'bg-gradient-to-r from-emerald-400 to-teal-400'
                                                        : 'bg-gradient-to-r from-orange-400 to-red-400'
                                                        }`}>
                                                        {quizResult.score}
                                                    </span>
                                                    <span className="text-xl text-gray-500">/ {quizResult.total}</span>
                                                </div>
                                                <div className="mt-4 pt-4 border-t border-gray-700 flex justify-around">
                                                    <div>
                                                        <p className="text-xs text-gray-500">Accuracy</p>
                                                        <p className="font-bold text-white">{percentage}%</p>
                                                    </div>
                                                    <div>
                                                        <p className="text-xs text-gray-500">Result</p>
                                                        <p className={`font-bold ${isPassing ? 'text-emerald-400' : 'text-orange-400'}`}>
                                                            {isPassing ? 'Passed ✓' : 'Keep Studying'}
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>

                                            <button
                                                onClick={resetQuiz}
                                                className="w-full py-3 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-all flex items-center justify-center gap-2"
                                            >
                                                Back to Dashboard
                                            </button>
                                        </>
                                    );
                                })()}
                            </div>
                        </div>
                    ) : currentQuestion ? (
                        /* ── Question Modal ──────────────────────────────── */
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
                            <div className="bg-gray-900 rounded-2xl border border-indigo-500/50 shadow-2xl shadow-indigo-500/20 w-full max-w-2xl mx-4 overflow-hidden animate-in zoom-in-95 duration-300">
                                {/* Header */}
                                <div className="bg-gradient-to-r from-indigo-600/30 to-purple-600/30 px-6 py-4 border-b border-gray-700 flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 bg-indigo-500/20 rounded-lg">
                                            <Brain size={22} className="text-indigo-400" />
                                        </div>
                                        <div>
                                            <h3 className="font-bold text-white text-lg flex items-center gap-2">
                                                Understanding Check
                                                <span className="px-2 py-0.5 bg-purple-500/20 text-purple-400 text-[10px] font-medium rounded-full border border-purple-500/30">
                                                    AI Generated
                                                </span>
                                            </h3>
                                            <p className="text-sm text-gray-400">Question {currentQuizIndex + 1} of {activeQuiz.questions.length}</p>
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            closeQuiz();
                                        }}
                                        className="p-2 hover:bg-gray-700 rounded-lg transition-colors group"
                                        title="Leave quiz (progress will not be saved)"
                                    >
                                        <X size={20} className="text-gray-400 group-hover:text-red-400 transition-colors" />
                                    </button>
                                </div>

                                {/* One-attempt notice banner */}
                                <div className="bg-amber-500/10 border-b border-amber-500/20 px-6 py-2 flex items-center gap-2">
                                    <Lock size={14} className="text-amber-400 shrink-0" />
                                    <p className="text-xs text-amber-400/90">
                                        One attempt only — answer carefully before submitting.
                                    </p>
                                </div>

                                {/* Progress Bar */}
                                <div className="w-full bg-gray-800 h-1.5">
                                    <div
                                        className="bg-gradient-to-r from-indigo-500 to-purple-500 h-full transition-all duration-500"
                                        style={{ width: `${((currentQuizIndex + 1) / activeQuiz.questions.length) * 100}%` }}
                                    />
                                </div>

                                {/* Question Content */}
                                <div className="p-6">
                                    {/* Topic/Outcome Badge */}
                                    <div className="mb-4 flex items-center gap-2 flex-wrap">
                                        <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${activeQuiz.difficulty === 'Beginner'
                                            ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                                            : activeQuiz.difficulty === 'Intermediate'
                                                ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
                                                : 'bg-red-500/20 text-red-400 border border-red-500/30'
                                            }`}>
                                            {activeQuiz.difficulty}
                                        </span>
                                        {currentQuestion.learningOutcome && (
                                            <span className="inline-block px-3 py-1 rounded-full text-[10px] font-medium bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 max-w-[300px] truncate" title={currentQuestion.learningOutcome}>
                                                LO: {currentQuestion.learningOutcome}
                                            </span>
                                        )}
                                    </div>

                                    {/* Question */}
                                    <h4 className="text-xl font-semibold text-white mb-6">{currentQuestion.question}</h4>

                                    {/* Answer Options */}
                                    <div className="space-y-3">
                                        {currentQuestion.options.map((option, idx) => {
                                            const isSelected = selectedAnswer === idx;
                                            const isCorrect = idx === currentQuestion.correctAnswer;
                                            const showResult = hasSubmitted;

                                            let optionClass = 'bg-gray-800 border-gray-700 hover:border-indigo-500/50 hover:bg-gray-700/50';
                                            if (isSelected && !showResult) {
                                                optionClass = 'bg-indigo-500/20 border-indigo-500 ring-2 ring-indigo-500/30';
                                            } else if (showResult && isCorrect) {
                                                optionClass = 'bg-emerald-500/20 border-emerald-500';
                                            } else if (showResult && isSelected && !isCorrect) {
                                                optionClass = 'bg-red-500/20 border-red-500';
                                            }

                                            return (
                                                <button
                                                    key={idx}
                                                    onClick={() => !hasSubmitted && setSelectedAnswer(idx)}
                                                    disabled={hasSubmitted}
                                                    className={`w-full text-left px-4 py-3 rounded-xl border transition-all flex items-center gap-3 ${optionClass} ${hasSubmitted ? 'cursor-default' : 'cursor-pointer'}`}
                                                >
                                                    <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${showResult && isCorrect ? 'bg-emerald-500 text-white' :
                                                        showResult && isSelected && !isCorrect ? 'bg-red-500 text-white' :
                                                            isSelected ? 'bg-indigo-500 text-white' :
                                                                'bg-gray-700 text-gray-300'
                                                        }`}>
                                                        {showResult && isCorrect ? <CheckCircle2 size={16} /> :
                                                            showResult && isSelected && !isCorrect ? <X size={16} /> :
                                                                String.fromCharCode(65 + idx)}
                                                    </span>
                                                    <span className={`flex-1 ${showResult && isCorrect ? 'text-emerald-400 font-medium' : 'text-gray-200'}`}>
                                                        {option}
                                                    </span>
                                                </button>
                                            );
                                        })}
                                    </div>

                                    {/* Feedback Message */}
                                    {hasSubmitted && (
                                        <div className={`mt-6 p-4 rounded-xl flex items-start gap-3 animate-in slide-in-from-bottom-2 duration-300 ${selectedAnswer === currentQuestion.correctAnswer
                                            ? 'bg-emerald-500/10 border border-emerald-500/30'
                                            : 'bg-red-500/10 border border-red-500/30'
                                            }`}>
                                            {selectedAnswer === currentQuestion.correctAnswer ? (
                                                <>
                                                    <CheckCircle2 size={20} className="text-emerald-400 shrink-0 mt-0.5" />
                                                    <div>
                                                        <p className="font-semibold text-emerald-400">Correct!</p>
                                                        <p className="text-sm text-gray-400">Great job! You understand this concept well.</p>
                                                    </div>
                                                </>
                                            ) : (
                                                <>
                                                    <AlertCircle size={20} className="text-red-400 shrink-0 mt-0.5" />
                                                    <div>
                                                        <p className="font-semibold text-red-400">Not quite right</p>
                                                        <p className="text-sm text-gray-400">
                                                            The correct answer is: <strong className="text-white">{currentQuestion.options[currentQuestion.correctAnswer]}</strong>
                                                        </p>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* Footer Actions */}
                                <div className="px-6 py-4 border-t border-gray-700 bg-gray-800/50 flex justify-between items-center gap-3">
                                    <div className="flex items-center gap-1.5">
                                        {activeQuiz.questions.map((_, i) => (
                                            <span
                                                key={i}
                                                className={`w-2 h-2 rounded-full transition-all ${i < currentQuizIndex ? 'bg-indigo-400' : i === currentQuizIndex ? 'bg-indigo-500 w-4' : 'bg-gray-600'}`}
                                            />
                                        ))}
                                    </div>
                                    <div className="flex gap-3">
                                        {!hasSubmitted ? (
                                            <button
                                                onClick={submitQuizAnswer}
                                                disabled={selectedAnswer === null}
                                                className={`px-6 py-2.5 rounded-lg font-medium transition-all flex items-center gap-2 ${selectedAnswer !== null
                                                    ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                                                    : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                                                    }`}
                                            >
                                                Submit Answer
                                            </button>
                                        ) : (
                                            <button
                                                onClick={nextQuestion}
                                                className="px-6 py-2.5 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 transition-all flex items-center gap-2"
                                            >
                                                {currentQuizIndex < activeQuiz.questions.length - 1
                                                    ? <>Next Question <ArrowRight size={16} /></>
                                                    : <><GraduationCap size={16} /> Finish &amp; Submit Quiz</>
                                                }
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : null}
                </>
            )}
        </>
    );
}
