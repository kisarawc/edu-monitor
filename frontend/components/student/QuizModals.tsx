"use client";

import React from 'react';
import {
    Brain,
    X,
    CheckCircle2,
    AlertCircle,
    GraduationCap
} from 'lucide-react';
import { useQuiz } from '@/context/QuizContext';

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

    if (!showQuizPopup || !activeQuiz) return null;

    // Quiz Result Modal
    if (quizResult) {
        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
                <div className="bg-gray-900 rounded-2xl border border-indigo-500/50 shadow-2xl shadow-indigo-500/20 w-full max-w-md mx-4 overflow-hidden text-center p-8 animate-in zoom-in-95 duration-300">
                    <div className="w-20 h-20 mx-auto bg-gradient-to-br from-emerald-400 to-teal-500 rounded-full flex items-center justify-center mb-6 shadow-lg shadow-emerald-500/20">
                        <GraduationCap size={40} className="text-white" />
                    </div>
                    <h2 className="text-2xl font-bold text-white mb-2">Quiz Completed!</h2>
                    <p className="text-gray-400 mb-8">You have successfully finished the knowledge check.</p>

                    <div className="bg-gray-800/80 rounded-xl p-6 mb-8 border border-gray-700">
                        <p className="text-sm text-gray-400 mb-1">Your Score</p>
                        <div className="flex items-baseline justify-center gap-1">
                            <span className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-400">
                                {quizResult.score}
                            </span>
                            <span className="text-xl text-gray-500">/ {quizResult.total}</span>
                        </div>
                        <div className="mt-4 pt-4 border-t border-gray-700 flex justify-around">
                            <div>
                                <p className="text-xs text-gray-500">Accuracy</p>
                                <p className="font-bold text-white">{Math.round((quizResult.score / quizResult.total) * 100)}%</p>
                            </div>
                        </div>
                    </div>

                    <button
                        onClick={resetQuiz}
                        className="w-full py-3 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-all flex items-center justify-center gap-2"
                    >
                        Back to Dashboard
                    </button>
                </div>
            </div>
        );
    }

    // Question Modal
    if (!currentQuestion) return null;

    return (
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
                        onClick={closeQuiz}
                        className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
                        title="Close quiz"
                    >
                        <X size={20} className="text-gray-400" />
                    </button>
                </div>

                {/* Progress Bar */}
                <div className="w-full bg-gray-800 h-1">
                    <div
                        className="bg-gradient-to-r from-indigo-500 to-purple-500 h-full transition-all duration-500"
                        style={{ width: `${((currentQuizIndex + 1) / activeQuiz.questions.length) * 100}%` }}
                    />
                </div>

                {/* Question Content */}
                <div className="p-6">
                    {/* Topic/Outcome Badge */}
                    <div className="mb-4 flex items-center gap-2 flex-wrap">
                        <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${activeQuiz.difficulty === 'Beginner' ? 'bg-green-500/20 text-green-400 border border-green-500/30' :
                            activeQuiz.difficulty === 'Intermediate' ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30' :
                                'bg-red-500/20 text-red-400 border border-red-500/30'
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
                <div className="px-6 py-4 border-t border-gray-700 bg-gray-800/50 flex justify-end gap-3">
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
                            {currentQuizIndex < activeQuiz.questions.length - 1 ? 'Next Question' : 'Finish Quiz'}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
