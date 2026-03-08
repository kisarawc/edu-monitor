"use client";
import React, { useState, useRef, useEffect } from 'react';
import { useAuth, UserRole } from "@/context/AuthContext";
import Link from 'next/link';
import {
  BookOpen,
  Sparkles,
  MessageCircle,
  Send,
  Loader2,
  RefreshCw,
  Bot,
  User,
  GraduationCap,
  FileText,
  UserCheck,
  HelpCircle,
  X,
  CheckCircle2,
  AlertCircle,
  Brain,
  Bell
} from 'lucide-react';
import { useQuiz } from "@/context/QuizContext";

// API Configuration
const API_BASE_URL = "http://localhost:8000";

// Simple markdown renderer for bold text
const renderMarkdown = (text: string) => {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index} className="font-semibold text-white">{part.slice(2, -2)}</strong>;
    }
    return part;
  });
};

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export default function StudentDashboard() {
  const { user } = useAuth();
  const studentId = user?.student_profile?.student_id || "anonymous";
  const studentName = user?.student_profile?.full_name || user?.username || "Student";

  // AI Assistant State
  const [summary, setSummary] = useState('');
  const [isSummaryLoading, setIsSummaryLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isAskLoading, setIsAskLoading] = useState(false);
  const [contentCount, setContentCount] = useState<number | null>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  // ===== QUIZ STATE =====
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

  const [releasedQuizzes, setReleasedQuizzes] = useState<Quiz[]>([]);
  const [completedQuizzes, setCompletedQuizzes] = useState<Set<string>>(new Set());
  const [activeQuiz, setActiveQuiz] = useState<Quiz | null>(null);

  // Quiz popup state
  const [showQuizPopup, setShowQuizPopup] = useState(false);
  const [currentQuizIndex, setCurrentQuizIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [quizNotification, setQuizNotification] = useState(false);
  const [quizResult, setQuizResult] = useState<{ score: number; total: number } | null>(null);
  const [quizAnswers, setQuizAnswers] = useState<{ questionId: number; selectedAnswer: number }[]>([]);

  const currentQuestion = activeQuiz ? activeQuiz.questions[currentQuizIndex] : null;

  const fetchReleasedQuizzes = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/performance/quiz/released`);
      if (res.ok) {
        const data = await res.json();
        const quizzes: Quiz[] = data.quizzes || [];
        setReleasedQuizzes(quizzes);

        // Also fetch all responses to see which ones this student has done
        const rRes = await fetch(`${API_BASE_URL}/api/performance/quiz/responses/all`);
        if (rRes.ok) {
          const rData = await rRes.json();
          const studentResponses = (rData.responses || []).filter(
            (r: any) => r.student_id === studentId
          );
          const completedSet = new Set<string>();
          studentResponses.forEach((r: any) => completedSet.add(r.quiz_id));
          setCompletedQuizzes(completedSet);

          // Show notification if there are uncompleted quizzes
          const uncompleted = quizzes.filter(q => !completedSet.has(q.id));
          if (uncompleted.length > 0) setQuizNotification(true);
        }
      }
    } catch (e) { console.error('Failed to fetch quizzes:', e); }
  };

  const triggerQuiz = (quiz: Quiz) => {
    if (!quiz || completedQuizzes.has(quiz.id)) return;
    setActiveQuiz(quiz);
    setCurrentQuizIndex(0);
    setShowQuizPopup(true);
    setSelectedAnswer(null);
    setHasSubmitted(false);
    setQuizNotification(false);
    setQuizResult(null);
    setQuizAnswers([]);
  };

  const submitQuizAnswer = () => {
    if (selectedAnswer !== null && currentQuestion) {
      setHasSubmitted(true);
      setQuizAnswers(prev => [...prev, { questionId: currentQuestion.id, selectedAnswer }]);
    }
  };

  const nextQuestion = async () => {
    if (!activeQuiz) return;
    if (currentQuizIndex < activeQuiz.questions.length - 1) {
      setCurrentQuizIndex(currentQuizIndex + 1);
      setSelectedAnswer(null);
      setHasSubmitted(false);
    } else {
      // All questions done — submit to backend
      const allAnswers = [...quizAnswers];
      try {
        const res = await fetch(`${API_BASE_URL}/api/performance/quiz/${activeQuiz.id}/submit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ student_id: studentId, student_name: studentName, answers: allAnswers }),
        });
        const data = await res.json();
        if (res.ok && data.success) {
          setQuizResult({ score: data.result.score, total: data.result.total });
          setCompletedQuizzes(prev => {
            const newSet = new Set(prev);
            newSet.add(activeQuiz.id);
            return newSet;
          });
        }
      } catch (e) { console.error('Failed to submit quiz:', e); }
      setShowQuizPopup(false);
      setCurrentQuizIndex(0);
      setSelectedAnswer(null);
      setHasSubmitted(false);
    }
  };

  const closeQuiz = () => {
    setShowQuizPopup(false);
    setSelectedAnswer(null);
    setHasSubmitted(false);
    setActiveQuiz(null);
  };

  useEffect(() => {
    fetchStats();
  }, []);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  const fetchStats = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/performance/stats`);
      if (response.ok) {
        const data = await response.json();
        setContentCount(data.data?.document_count ?? 0);
      }
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    }
  };

  const generateSummary = async () => {
    setIsSummaryLoading(true);
    setSummary('');

    try {
      const response = await fetch(`${API_BASE_URL}/api/performance/summary`);

      if (!response.ok) {
        const error = await response.json();
        setSummary(`Error: ${error.detail || 'Failed to generate summary'}`);
        setIsSummaryLoading(false);
        return;
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        setSummary('Error: Unable to read response');
        setIsSummaryLoading(false);
        return;
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') break;
            try {
              const parsed = JSON.parse(data);
              if (parsed.text) {
                setSummary(prev => prev + parsed.text);
              }
            } catch { }
          }
        }
      }
    } catch {
      setSummary('Error: Failed to connect to server. Is the backend running?');
    } finally {
      setIsSummaryLoading(false);
    }
  };

  const askQuestion = async () => {
    if (!inputMessage.trim() || isAskLoading) return;

    const userMessage = inputMessage.trim();
    setInputMessage('');
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setIsAskLoading(true);
    setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

    try {
      const response = await fetch(`${API_BASE_URL}/api/performance/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: userMessage }),
      });

      if (!response.ok) {
        const error = await response.json();
        setMessages(prev => {
          const newMessages = [...prev];
          newMessages[newMessages.length - 1] = { role: 'assistant', content: `Error: ${error.detail || 'Failed to get answer'}` };
          return newMessages;
        });
        setIsAskLoading(false);
        return;
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        setMessages(prev => {
          const newMessages = [...prev];
          newMessages[newMessages.length - 1] = { role: 'assistant', content: 'Error: Unable to read response' };
          return newMessages;
        });
        setIsAskLoading(false);
        return;
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') break;
            try {
              const parsed = JSON.parse(data);
              if (parsed.text) {
                setMessages(prev => {
                  const newMessages = [...prev];
                  newMessages[newMessages.length - 1] = {
                    role: 'assistant',
                    content: newMessages[newMessages.length - 1].content + parsed.text
                  };
                  return newMessages;
                });
              }
            } catch { }
          }
        }
      }
    } catch {
      setMessages(prev => {
        const newMessages = [...prev];
        newMessages[newMessages.length - 1] = { role: 'assistant', content: 'Error: Failed to connect to server' };
        return newMessages;
      });
    } finally {
      setIsAskLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      askQuestion();
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <nav className="bg-gray-800 border-b border-gray-700 px-8 py-4 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="bg-gradient-to-r from-emerald-500 to-teal-500 p-2.5 rounded-xl">
            <GraduationCap size={22} className="text-white" />
          </div>
          <div>
            <h1 className="font-bold text-lg">Student Portal</h1>
            <p className="text-xs text-gray-400">AI-Powered Learning</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href="/student/dashboard/attendance"
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors text-sm font-medium"
          >
            <UserCheck size={16} />
            Attendance
          </Link>
          {/* Demo Quiz Button */}
          <button
            onClick={() => releasedQuizzes.length > 0 && triggerQuiz(releasedQuizzes[0])}
            disabled={releasedQuizzes.length === 0}
            className={`relative flex items-center gap-2 px-4 py-2 text-white rounded-lg transition-colors text-sm font-medium ${releasedQuizzes.length > 0 ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-gray-600 cursor-not-allowed opacity-50'}`}
          >
            <Brain size={16} />
            Quiz
            {quizNotification && (
              <span className="absolute -top-1 -right-1 flex h-4 w-4">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-4 w-4 bg-red-500 text-[10px] items-center justify-center">!</span>
              </span>
            )}
          </button>
          <div className="flex items-center gap-2 bg-gray-700/50 px-3 py-1.5 rounded-lg">
            <FileText size={14} className="text-emerald-400" />
            <span className="text-sm">{contentCount ?? 0} content chunks</span>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto p-8">
        {/* AI Learning Assistant - PRIORITY SECTION */}
        <section className="mb-8">
          <div className="bg-gradient-to-r from-purple-600 via-blue-600 to-cyan-500 rounded-2xl p-[2px]">
            <div className="bg-gray-900 rounded-2xl overflow-hidden">
              {/* Header */}
              <div className="bg-gradient-to-r from-purple-600/20 via-blue-600/20 to-cyan-500/20 px-6 py-5 border-b border-gray-700">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-gradient-to-r from-purple-500 to-blue-500 rounded-xl">
                      <Sparkles size={24} className="text-white" />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold">AI Learning Assistant</h2>
                      <p className="text-sm text-gray-400">Get summaries and ask questions about your lectures</p>
                    </div>
                  </div>
                  <span className="flex items-center gap-2 bg-emerald-500/20 text-emerald-400 px-3 py-1.5 rounded-full text-sm">
                    <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
                    AI Ready
                  </span>
                </div>
              </div>

              <div className="p-6">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Summary Section */}
                  <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
                    <div className="p-4 border-b border-gray-700 bg-gray-800/50 flex items-center justify-between">
                      <h3 className="font-semibold flex items-center gap-2">
                        <BookOpen size={18} className="text-purple-400" />
                        Lecture Summary
                      </h3>
                      <button
                        onClick={generateSummary}
                        disabled={isSummaryLoading}
                        className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
                      >
                        {isSummaryLoading ? (
                          <><Loader2 size={16} className="animate-spin" />Generating...</>
                        ) : (
                          <><RefreshCw size={16} />Get Summary</>
                        )}
                      </button>
                    </div>
                    <div className="p-4 h-[400px] overflow-y-auto">
                      {summary ? (
                        <div className="text-gray-300 leading-relaxed whitespace-pre-wrap">{renderMarkdown(summary)}</div>
                      ) : (
                        <div className="h-full flex flex-col items-center justify-center text-gray-500">
                          <BookOpen size={48} className="mb-4 opacity-30" />
                          <p className="text-center">Click &quot;Get Summary&quot; to generate an AI-powered summary of your lecture content</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Chat Section */}
                  <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
                    <div className="p-4 border-b border-gray-700 bg-gray-800/50">
                      <h3 className="font-semibold flex items-center gap-2">
                        <MessageCircle size={18} className="text-blue-400" />
                        Ask Questions
                      </h3>
                    </div>

                    {/* Messages */}
                    <div ref={chatContainerRef} className="p-4 h-[320px] overflow-y-auto space-y-4">
                      {messages.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-gray-500">
                          <MessageCircle size={40} className="mb-3 opacity-30" />
                          <p className="text-center text-sm">Ask any question about the lecture content</p>
                        </div>
                      ) : (
                        messages.map((msg, idx) => (
                          <div key={idx} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            {msg.role === 'assistant' && (
                              <div className="w-8 h-8 rounded-full bg-gradient-to-r from-purple-500 to-blue-500 flex items-center justify-center flex-shrink-0">
                                <Bot size={16} className="text-white" />
                              </div>
                            )}
                            <div className={`max-w-[80%] rounded-2xl px-4 py-2 ${msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-200'}`}>
                              <div className="text-sm leading-relaxed whitespace-pre-wrap">
                                {msg.content ? renderMarkdown(msg.content) : <Loader2 size={16} className="animate-spin" />}
                              </div>
                            </div>
                            {msg.role === 'user' && (
                              <div className="w-8 h-8 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 flex items-center justify-center flex-shrink-0">
                                <User size={16} className="text-white" />
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>

                    {/* Input */}
                    <div className="p-4 border-t border-gray-700 bg-gray-800/50">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={inputMessage}
                          onChange={(e) => setInputMessage(e.target.value)}
                          onKeyDown={handleKeyPress}
                          placeholder="Ask a question about the lecture..."
                          className="flex-1 px-4 py-3 rounded-xl bg-gray-700 border border-gray-600 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          disabled={isAskLoading}
                        />
                        <button
                          onClick={askQuestion}
                          disabled={!inputMessage.trim() || isAskLoading}
                          className="px-4 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isAskLoading ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Released Quizzes Section */}
        <section className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Brain size={24} className="text-indigo-400" />
              Released Quizzes
              {releasedQuizzes.filter(q => !completedQuizzes.has(q.id)).length > 0 && (
                <span className="bg-indigo-500/20 text-indigo-400 text-xs px-2.5 py-0.5 rounded-full font-medium border border-indigo-500/30">
                  {releasedQuizzes.filter(q => !completedQuizzes.has(q.id)).length} New
                </span>
              )}
            </h2>
          </div>

          {releasedQuizzes.length === 0 ? (
            <div className="bg-gray-800 rounded-xl border border-gray-700 p-8 text-center text-gray-500">
              <Brain size={40} className="mx-auto mb-3 opacity-30" />
              <p>No quizzes available right now. Check back later!</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {releasedQuizzes.map((quiz) => {
                const isCompleted = completedQuizzes.has(quiz.id);
                return (
                  <div key={quiz.id} className={`bg-gray-800 rounded-xl border p-5 transition-all ${isCompleted ? 'border-emerald-500/30 opacity-80' : 'border-gray-700 hover:border-indigo-500/50 hover:-translate-y-1'}`}>
                    <div className="flex items-center justify-between mb-3">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${quiz.difficulty === 'Beginner' ? 'bg-green-500/20 text-green-400' : quiz.difficulty === 'Intermediate' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-red-500/20 text-red-400'}`}>
                        {quiz.difficulty}
                      </span>
                      {isCompleted ? (
                        <span className="flex items-center gap-1 text-xs text-emerald-400 font-medium bg-emerald-500/10 px-2 py-1 rounded-md">
                          <CheckCircle2 size={14} /> Completed
                        </span>
                      ) : (
                        <span className="text-xs text-gray-500">{new Date(quiz.created_at).toLocaleDateString()}</span>
                      )}
                    </div>

                    <h3 className="font-semibold text-lg mb-2 text-white">Knowledge Check</h3>
                    <p className="text-sm text-gray-400 mb-5 flex items-center gap-2">
                      <HelpCircle size={14} />
                      {quiz.num_questions} Questions
                    </p>

                    <button
                      onClick={() => triggerQuiz(quiz)}
                      disabled={isCompleted}
                      className={`w-full py-2.5 rounded-lg font-medium transition-all flex items-center justify-center gap-2 ${isCompleted
                        ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                        : 'bg-indigo-600 text-white hover:bg-indigo-700'
                        }`}
                    >
                      {isCompleted ? 'Already Submitted' : 'Start Quiz'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* How to Use AI Assistant */}
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
          <h2 className="font-semibold mb-4 flex items-center gap-2">
            <Sparkles size={18} className="text-purple-400" />
            How to Use AI Assistant
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-sm text-gray-400">
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center text-purple-400 font-bold shrink-0">1</div>
              <p>Click <strong className="text-white">"Get Summary"</strong> to generate an AI-powered summary of your lecture content</p>
            </div>
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400 font-bold shrink-0">2</div>
              <p>Use the <strong className="text-white">chat</strong> to ask specific questions about the lecture material</p>
            </div>
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400 font-bold shrink-0">3</div>
              <p>Content is provided by your <strong className="text-white">teacher</strong> through uploaded slides and live transcriptions</p>
            </div>
          </div>
        </div>
      </main>

    </div>
  );
}
