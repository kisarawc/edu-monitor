"use client";
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useLocalSTT } from './useLocalSTT';
import {
    Upload,
    Mic,
    MicOff,
    FileText,
    CheckCircle2,
    AlertCircle,
    Loader2,
    Trash2,
    Send,
    GraduationCap,
    ClipboardPaste,
    Clock,
    Zap,
    HelpCircle,
    PlayCircle,
    BarChart3,
    Users,
    Target,
    TrendingUp,
    CheckCheck,
    XCircle,
    Brain,
    Sparkles,
    Plus,
    X,
    Settings,
    Wand2,
    BarChart
} from 'lucide-react';
import {
    BarChart as RechartsBarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell, Legend
} from 'recharts';

// API Configuration
const API_BASE_URL = "http://localhost:8000";

// Auto-submit interval in milliseconds (5 seconds)
const AUTO_SUBMIT_INTERVAL = 5000;

interface UploadStatus {
    status: 'idle' | 'uploading' | 'success' | 'error';
    message: string;
    chunks?: number;
}

interface TranscriptStatus {
    status: 'idle' | 'processing' | 'success' | 'error';
    message: string;
}

export default function StudentPerformanceSection() {
    // File upload state
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [uploadStatus, setUploadStatus] = useState<UploadStatus>({ status: 'idle', message: '' });
    const [isDragging, setIsDragging] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Transcription state (powered by Whisper)
    const [transcriptStatus, setTranscriptStatus] = useState<TranscriptStatus>({ status: 'idle', message: '' });

    // Auto-submit state
    const [autoSubmitEnabled, setAutoSubmitEnabled] = useState(true);
    const [lastAutoSubmit, setLastAutoSubmit] = useState<Date | null>(null);
    const [autoSubmitCount, setAutoSubmitCount] = useState(0);
    const pendingTranscriptRef = useRef('');
    const autoSubmitTimerRef = useRef<NodeJS.Timeout | null>(null);

    // Demo paste state
    const [pasteText, setPasteText] = useState('');
    const [pasteStatus, setPasteStatus] = useState<TranscriptStatus>({ status: 'idle', message: '' });

    // Stats
    const [contentStats, setContentStats] = useState<{ document_count: number } | null>(null);

    // ===== LEARNING OUTCOMES STATE =====
    interface LearningOutcome {
        id: string;
        text: string;
        source_filename: string;
        uploaded_at: string;
    }
    const [learningOutcomes, setLearningOutcomes] = useState<LearningOutcome[]>([]);
    const [outcomeFile, setOutcomeFile] = useState<File | null>(null);
    const [outcomeUploadStatus, setOutcomeUploadStatus] = useState<UploadStatus>({ status: 'idle', message: '' });
    const outcomeFileRef = useRef<HTMLInputElement>(null);

    // Pending outcomes state (for interactive selection)
    const [pendingOutcomes, setPendingOutcomes] = useState<string[]>([]);
    const [pendingOutcomeFileName, setPendingOutcomeFileName] = useState<string>('');
    const [showPendingModal, setShowPendingModal] = useState(false);
    const [newOutcomeText, setNewOutcomeText] = useState('');
    const [isSavingOutcomes, setIsSavingOutcomes] = useState(false);

    // ===== QUIZ FEATURE STATE =====
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
        released_at: string | null;
    }

    const [quizzes, setQuizzes] = useState<Quiz[]>([]);
    const [showAnalytics, setShowAnalytics] = useState(false);

    // Quiz generation modal state
    const [showGenerateModal, setShowGenerateModal] = useState(false);
    const [selectedDifficulty, setSelectedDifficulty] = useState<'Beginner' | 'Intermediate' | 'Advanced'>('Intermediate');
    const [questionCount, setQuestionCount] = useState(5);
    const [isGenerating, setIsGenerating] = useState(false);
    const [generateError, setGenerateError] = useState('');

    // Analytics modal state
    const [analyticsData, setAnalyticsData] = useState<any>(null);
    const [isAnalyticsLoading, setIsAnalyticsLoading] = useState(false);

    // Edit Quiz modal state
    const [editingQuiz, setEditingQuiz] = useState<Quiz | null>(null);
    const [isSavingQuiz, setIsSavingQuiz] = useState(false);
    const [isRegeneratingQuestion, setIsRegeneratingQuestion] = useState<number | null>(null);

    // Tab state
    const [activeTab, setActiveTab] = useState<'content' | 'quiz'>('content');

    // ===== LEARNING OUTCOMES API =====
    const fetchOutcomes = async () => {
        try {
            const res = await fetch(`${API_BASE_URL}/api/performance/learning-outcomes`);
            if (res.ok) {
                const data = await res.json();
                setLearningOutcomes(data.outcomes || []);
            }
        } catch (e) { console.error('Failed to fetch outcomes:', e); }
    };

    const uploadOutcomeFile = async () => {
        if (!outcomeFile) return;
        setOutcomeUploadStatus({ status: 'uploading', message: 'Processing outcomes...' });
        try {
            const formData = new FormData();
            formData.append('file', outcomeFile);
            const res = await fetch(`${API_BASE_URL}/api/performance/learning-outcomes/upload`, { method: 'POST', body: formData });
            const data = await res.json();
            if (res.ok && data.success) {
                setOutcomeUploadStatus({ status: 'success', message: data.message });
                setPendingOutcomes(data.data.extracted_outcomes);
                setPendingOutcomeFileName(data.data.source_filename);
                setShowPendingModal(true);
                setOutcomeFile(null);
            } else {
                setOutcomeUploadStatus({ status: 'error', message: data.detail || data.message || 'Upload failed' });
            }
        } catch { setOutcomeUploadStatus({ status: 'error', message: 'Failed to connect to server' }); }
    };

    const saveApprovedOutcomes = async () => {
        if (pendingOutcomes.length === 0) {
            setOutcomeUploadStatus({ status: 'error', message: 'No outcomes to save.' });
            return;
        }
        setIsSavingOutcomes(true);
        try {
            const res = await fetch(`${API_BASE_URL}/api/performance/learning-outcomes/save`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ outcomes: pendingOutcomes, source_filename: pendingOutcomeFileName })
            });
            const data = await res.json();
            if (res.ok && data.success) {
                setShowPendingModal(false);
                setPendingOutcomes([]);
                setPendingOutcomeFileName('');
                fetchOutcomes();
            } else {
                setOutcomeUploadStatus({ status: 'error', message: data.detail || 'Failed to save outcomes' });
            }
        } catch {
            setOutcomeUploadStatus({ status: 'error', message: 'Failed to connect to server' });
        } finally {
            setIsSavingOutcomes(false);
        }
    };

    const addPendingOutcome = () => {
        if (newOutcomeText.trim()) {
            setPendingOutcomes([...pendingOutcomes, newOutcomeText.trim()]);
            setNewOutcomeText('');
        }
    };

    const updatePendingOutcome = (index: number, val: string) => {
        const updated = [...pendingOutcomes];
        updated[index] = val;
        setPendingOutcomes(updated);
    };

    const removePendingOutcome = (index: number) => {
        const updated = pendingOutcomes.filter((_, i) => i !== index);
        setPendingOutcomes(updated);
    };

    const deleteOutcome = async (id: string) => {
        try {
            await fetch(`${API_BASE_URL}/api/performance/learning-outcomes/${id}`, { method: 'DELETE' });
            fetchOutcomes();
        } catch (e) { console.error('Failed to delete outcome:', e); }
    };

    // ===== QUIZ API =====
    const fetchQuizzes = async () => {
        try {
            const res = await fetch(`${API_BASE_URL}/api/performance/quizzes`);
            if (res.ok) {
                const data = await res.json();
                setQuizzes(data.quizzes || []);
            }
        } catch (e) { console.error('Failed to fetch quizzes:', e); }
    };

    const generateQuiz = async () => {
        setIsGenerating(true);
        setGenerateError('');
        try {
            const res = await fetch(`${API_BASE_URL}/api/performance/quiz/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ num_questions: questionCount, difficulty: selectedDifficulty }),
            });
            const data = await res.json();
            if (res.ok && data.success) {
                setShowGenerateModal(false);
                fetchQuizzes();
            } else {
                setGenerateError(data.detail || 'Quiz generation failed');
            }
        } catch {
            setGenerateError('Failed to connect to server. Is the backend running?');
        } finally { setIsGenerating(false); }
    };

    const removeQuiz = async (quizId: string) => {
        try {
            await fetch(`${API_BASE_URL}/api/performance/quiz/${quizId}`, { method: 'DELETE' });
            fetchQuizzes();
        } catch (e) { console.error('Failed to delete quiz:', e); }
    };

    const releaseQuiz = async (quizId: string) => {
        try {
            await fetch(`${API_BASE_URL}/api/performance/quiz/${quizId}/release`, { method: 'PUT' });
            fetchQuizzes();
        } catch (e) { console.error('Failed to release quiz:', e); }
    };

    // ===== EDIT QUIZ FUNCTIONS =====
    const openEditQuiz = (quiz: Quiz) => {
        // Create a deep copy to allow editing without mutating the original until saved
        setEditingQuiz(JSON.parse(JSON.stringify(quiz)));
    };

    const closeEditQuiz = () => {
        setEditingQuiz(null);
    };

    const handleEditQuestionText = (qIndex: number, text: string) => {
        if (!editingQuiz) return;
        const newQuiz = { ...editingQuiz };
        newQuiz.questions[qIndex].question = text;
        setEditingQuiz(newQuiz);
    };

    const handleEditOptionText = (qIndex: number, optIndex: number, text: string) => {
        if (!editingQuiz) return;
        const newQuiz = { ...editingQuiz };
        newQuiz.questions[qIndex].options[optIndex] = text;
        setEditingQuiz(newQuiz);
    };

    const handleSetCorrectAnswer = (qIndex: number, optIndex: number) => {
        if (!editingQuiz) return;
        const newQuiz = { ...editingQuiz };
        newQuiz.questions[qIndex].correctAnswer = optIndex;
        setEditingQuiz(newQuiz);
    };

    const saveEditedQuiz = async () => {
        if (!editingQuiz) return;
        setIsSavingQuiz(true);
        try {
            const res = await fetch(`${API_BASE_URL}/api/performance/quiz/${editingQuiz.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ questions: editingQuiz.questions })
            });
            const data = await res.json();
            if (res.ok && data.success) {
                // Update local list
                setQuizzes(quizzes.map(q => q.id === editingQuiz.id ? data.quiz : q));
                setEditingQuiz(null);
            } else {
                alert(`Failed to save quiz: ${data.detail || 'Unknown error'}`);
            }
        } catch (e) {
            console.error(e);
            alert('Failed to connect to server to save quiz.');
        } finally {
            setIsSavingQuiz(false);
        }
    };

    const regenerateQuestion = async (qIndex: number, questionId: number) => {
        if (!editingQuiz) return;
        setIsRegeneratingQuestion(questionId);
        try {
            const res = await fetch(`${API_BASE_URL}/api/performance/quiz/regenerate-question`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question_id: questionId })
            });
            const data = await res.json();
            if (res.ok && data.success) {
                const newQuiz = { ...editingQuiz };
                newQuiz.questions[qIndex] = data.question;
                setEditingQuiz(newQuiz);
            } else {
                alert(`Failed to regenerate question: ${data.detail || 'Unknown error'}`);
            }
        } catch (e) {
            console.error(e);
            alert('Failed to connect to server to regenerate question.');
        } finally {
            setIsRegeneratingQuestion(null);
        }
    };

    const fetchAnalytics = async (quizId: string) => {
        setIsAnalyticsLoading(true);
        setShowAnalytics(true);
        try {
            const res = await fetch(`${API_BASE_URL}/api/performance/quiz/${quizId}/analytics`);
            if (res.ok) {
                const data = await res.json();
                setAnalyticsData(data.analytics);
            } else {
                setAnalyticsData(null);
            }
        } catch (e) {
            console.error('Failed to fetch analytics:', e);
            setAnalyticsData(null);
        } finally {
            setIsAnalyticsLoading(false);
        }
    };

    // Auto-submit function
    const autoSubmitTranscript = useCallback(async (text: string) => {
        if (!text.trim() || text.trim().length < 20) return;

        try {
            const response = await fetch(`${API_BASE_URL}/api/performance/transcript`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ transcript: text, use_llm_filter: false, skip_filter: true }),
            });

            const data = await response.json();

            if (response.ok && data.success) {
                setAutoSubmitCount(prev => prev + 1);
                setLastAutoSubmit(new Date());
                fetchStats();
                console.log(`Auto-submitted chunk: ${text.length} chars`);
            }
        } catch (error) {
            console.error('Auto-submit failed:', error);
        }
    }, []);

    // Local Whisper STT hook 
    const {
        isRecording,
        transcript,
        displayedTranscript,
        interimText: interimTranscript,
        error: sttError,
        isTranscribing,
        start: startRecording,
        stop: stopRecording,
        clear: clearSTT,
    } = useLocalSTT((finalText: string) => {
        // Append newly transcribed text from Whisper
        pendingTranscriptRef.current += finalText + " ";
    });

    // Fetch stats on mount
    useEffect(() => {
        fetchStats();
        fetchOutcomes();
        fetchQuizzes();
    }, []);

    // Auto-submit timer effect
    useEffect(() => {
        if (isRecording && autoSubmitEnabled) {
            // Start auto-submit timer
            autoSubmitTimerRef.current = setInterval(() => {
                const pending = pendingTranscriptRef.current;
                if (pending.trim().length >= 20) {
                    autoSubmitTranscript(pending);
                    pendingTranscriptRef.current = ''; // Clear pending after submit
                }
            }, AUTO_SUBMIT_INTERVAL);
        } else {
            // Clear timer when not recording
            if (autoSubmitTimerRef.current) {
                clearInterval(autoSubmitTimerRef.current);
                autoSubmitTimerRef.current = null;
            }
        }

        return () => {
            if (autoSubmitTimerRef.current) {
                clearInterval(autoSubmitTimerRef.current);
            }
        };
    }, [isRecording, autoSubmitEnabled, autoSubmitTranscript]);

    const fetchStats = async () => {
        try {
            const response = await fetch(`${API_BASE_URL}/api/performance/stats`);
            if (response.ok) {
                const data = await response.json();
                setContentStats(data.data);
            }
        } catch (error) {
            console.error('Failed to fetch stats:', error);
        }
    };

    // File upload handlers
    const handleFileSelect = (file: File) => {
        if (file.type === 'application/pdf' || file.name.endsWith('.pdf') || file.name.endsWith('.txt')) {
            setSelectedFile(file);
            setUploadStatus({ status: 'idle', message: '' });
        } else {
            setUploadStatus({ status: 'error', message: 'Please select a PDF or TXT file' });
        }
    };

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) handleFileSelect(file);
    }, []);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    }, []);

    const handleDragLeave = useCallback(() => {
        setIsDragging(false);
    }, []);

    const uploadFile = async () => {
        if (!selectedFile) return;
        setUploadStatus({ status: 'uploading', message: 'Processing document...' });

        try {
            const formData = new FormData();
            formData.append('file', selectedFile);

            const response = await fetch(`${API_BASE_URL}/api/performance/upload`, {
                method: 'POST',
                body: formData,
            });

            const data = await response.json();

            if (response.ok && data.success) {
                setUploadStatus({ status: 'success', message: data.message, chunks: data.data?.chunks_stored });
                setSelectedFile(null);
                fetchStats();
            } else {
                setUploadStatus({ status: 'error', message: data.detail || data.message || 'Upload failed' });
            }
        } catch (error) {
            setUploadStatus({ status: 'error', message: 'Failed to connect to server. Is the backend running?' });
        }
    };

    // Transcription handlers
    const toggleRecording = async () => {
        if (isRecording) {
            stopRecording();

            // Submit any remaining pending transcript
            if (autoSubmitEnabled && pendingTranscriptRef.current.trim().length >= 20) {
                autoSubmitTranscript(pendingTranscriptRef.current);
                pendingTranscriptRef.current = '';
            }
        } else {
            clearSTT();
            setAutoSubmitCount(0);
            pendingTranscriptRef.current = '';
            await startRecording();
        }
    };

    const clearTranscript = () => {
        clearSTT();
        setTranscriptStatus({ status: 'idle', message: '' });
        setAutoSubmitCount(0);
        pendingTranscriptRef.current = '';
    };

    const submitTranscript = async () => {
        if (!transcript.trim()) return;
        setTranscriptStatus({ status: 'processing', message: 'Processing transcript...' });

        try {
            const response = await fetch(`${API_BASE_URL}/api/performance/transcript`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ transcript: transcript, use_llm_filter: false, skip_filter: true }),
            });

            const data = await response.json();

            if (response.ok && data.success) {
                setTranscriptStatus({ status: 'success', message: `Stored ${data.data?.chunks_stored || 1} content chunks` });
                clearSTT();
                pendingTranscriptRef.current = '';
                fetchStats();
            } else {
                setTranscriptStatus({ status: 'error', message: data.detail || data.message || 'Processing failed' });
            }
        } catch (error) {
            setTranscriptStatus({ status: 'error', message: 'Failed to connect to server' });
        }
    };

    // Demo paste handlers
    const submitPasteText = async () => {
        if (!pasteText.trim()) return;
        setPasteStatus({ status: 'processing', message: 'Processing pasted transcript...' });

        try {
            const response = await fetch(`${API_BASE_URL}/api/performance/transcript`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ transcript: pasteText, use_llm_filter: true }),
            });

            const data = await response.json();

            if (response.ok && data.success) {
                setPasteStatus({ status: 'success', message: `Stored ${data.data?.chunks_stored || 1} content chunks` });
                setPasteText('');
                fetchStats();
            } else {
                setPasteStatus({ status: 'error', message: data.detail || data.message || 'Processing failed' });
            }
        } catch (error) {
            setPasteStatus({ status: 'error', message: 'Failed to connect to server' });
        }
    };

    const clearContent = async () => {
        if (!confirm('Are you sure you want to clear all stored content?')) return;
        try {
            await fetch(`${API_BASE_URL}/api/performance/clear`, { method: 'DELETE' });
            fetchStats();
            setAutoSubmitCount(0);
        } catch (error) {
            console.error('Failed to clear:', error);
        }
    };

    return (
        <div className="flex flex-col h-full bg-gray-900 text-white overflow-hidden">
            <header className="bg-gray-800/50 backdrop-blur border-b border-gray-700 sticky top-0 z-10 shrink-0">
                <div className="h-16 flex items-center justify-between px-8">
                    <h2 className="text-lg font-semibold text-gray-200">
                        Student Performance
                    </h2>
                    <div className="flex items-center gap-4">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                        <span className="text-sm text-emerald-400">System Online</span>
                    </div>
                </div>

                {/* Tab Navigation */}
                <div className="flex px-8 gap-6 border-t border-gray-700/50">
                    <button
                        onClick={() => setActiveTab('content')}
                        className={`py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'content'
                            ? 'border-blue-500 text-blue-400'
                            : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-600'
                            }`}
                    >
                        <FileText size={16} />
                        Lecture Content
                    </button>
                    <button
                        onClick={() => setActiveTab('quiz')}
                        className={`py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'quiz'
                            ? 'border-blue-500 text-blue-400'
                            : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-600'
                            }`}
                    >
                        <Target size={16} />
                        Quiz & Outcomes
                    </button>
                </div>
            </header>

            <main className="p-8 flex-1 overflow-auto">
                <div className="space-y-6">
                    {/* TAB 1: LECTURE CONTENT */}
                    {activeTab === 'content' && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                            {/* Info Banner */}
                            <div className="bg-gradient-to-r from-blue-600/20 to-purple-600/20 border border-blue-500/30 rounded-xl p-4 flex items-center gap-4">
                                <div className="p-3 bg-blue-500/20 rounded-lg">
                                    <GraduationCap size={24} className="text-blue-400" />
                                </div>
                                <div className="flex-1">
                                    <h3 className="font-semibold text-white">Lecture Content Manager</h3>
                                    <p className="text-sm text-gray-400">Upload slides and record lectures for AI-powered student summaries and Q&A</p>
                                </div>
                                {contentStats && (
                                    <div className="flex items-center gap-2 bg-gray-800 px-3 py-1.5 rounded-lg border border-gray-700">
                                        <FileText size={14} className="text-blue-400" />
                                        <span className="text-sm text-white">{contentStats.document_count} chunks</span>
                                    </div>
                                )}
                            </div>

                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                {/* File Upload Section */}
                                <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
                                    <div className="p-4 border-b border-gray-700 bg-gray-900/50">
                                        <h3 className="font-semibold flex items-center gap-2">
                                            <Upload size={18} className="text-blue-400" />
                                            Upload Lecture Slides
                                        </h3>
                                        <p className="text-xs text-gray-500 mt-1">PDF or TXT files accepted</p>
                                    </div>
                                    <div className="p-6">
                                        <div
                                            className={`border-2 border-dashed rounded-xl p-6 text-center transition-all cursor-pointer ${isDragging ? 'border-blue-500 bg-blue-500/10' : 'border-gray-600 hover:border-blue-500/50 hover:bg-gray-700/30'}`}
                                            onDrop={handleDrop}
                                            onDragOver={handleDragOver}
                                            onDragLeave={handleDragLeave}
                                            onClick={() => fileInputRef.current?.click()}
                                        >
                                            <input ref={fileInputRef} type="file" accept=".pdf,.txt" className="hidden" onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])} />
                                            <Upload size={32} className="mx-auto text-gray-500 mb-3" />
                                            <p className="text-white font-medium">{selectedFile ? selectedFile.name : 'Drop your file here'}</p>
                                            <p className="text-sm text-gray-500 mt-1">{selectedFile ? `${(selectedFile.size / 1024).toFixed(1)} KB` : 'or click to browse'}</p>
                                        </div>

                                        <div className="mt-4 space-y-3">
                                            <button
                                                onClick={uploadFile}
                                                disabled={!selectedFile || uploadStatus.status === 'uploading'}
                                                className={`w-full py-2.5 px-4 rounded-lg font-medium transition-all flex items-center justify-center gap-2 ${selectedFile && uploadStatus.status !== 'uploading' ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-gray-700 text-gray-500 cursor-not-allowed'}`}
                                            >
                                                {uploadStatus.status === 'uploading' ? <><Loader2 size={16} className="animate-spin" />Processing...</> : <><Upload size={16} />Upload & Process</>}
                                            </button>

                                            {uploadStatus.message && (
                                                <div className={`flex items-start gap-2 p-3 rounded-lg text-sm ${uploadStatus.status === 'success' ? 'bg-emerald-500/10 text-emerald-400' : uploadStatus.status === 'error' ? 'bg-red-500/10 text-red-400' : 'bg-blue-500/10 text-blue-400'}`}>
                                                    {uploadStatus.status === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                                                    {uploadStatus.message}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Live Transcription Section with Auto-Submit */}
                                <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
                                    <div className="p-4 border-b border-gray-700 bg-gray-900/50">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <h3 className="font-semibold flex items-center gap-2">
                                                    <Mic size={18} className="text-purple-400" />
                                                    Live Transcription
                                                </h3>
                                                <p className="text-xs text-gray-500 mt-1">Auto-saves every 5 seconds while recording</p>
                                            </div>
                                            {/* Auto-submit toggle */}
                                            <button
                                                onClick={() => setAutoSubmitEnabled(!autoSubmitEnabled)}
                                                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${autoSubmitEnabled ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-gray-700 text-gray-400'}`}
                                            >
                                                <Zap size={14} />
                                                Auto-Save {autoSubmitEnabled ? 'ON' : 'OFF'}
                                            </button>
                                        </div>
                                    </div>
                                    <div className="p-6">
                                        <div className="flex justify-center mb-4">
                                            <button
                                                onClick={toggleRecording}
                                                className={`w-16 h-16 rounded-full flex items-center justify-center transition-all ${isRecording ? 'bg-red-500 animate-pulse shadow-lg shadow-red-500/30' : 'bg-blue-600 hover:bg-blue-700'}`}
                                            >
                                                {isRecording ? <MicOff size={28} className="text-white" /> : <Mic size={28} className="text-white" />}
                                            </button>
                                        </div>

                                        {/* Recording status */}
                                        <div className="text-center mb-4">
                                            <p className="text-sm text-gray-400">
                                                {isRecording ? 'Recording... Click to stop' : 'Click to start recording'}
                                            </p>
                                            {isRecording && autoSubmitEnabled && (
                                                <div className="flex items-center justify-center gap-2 mt-2 text-xs text-emerald-400">
                                                    <Clock size={12} />
                                                    {autoSubmitCount > 0 ? `${autoSubmitCount} chunks auto-saved` : 'Will auto-save every 5s'}
                                                </div>
                                            )}
                                        </div>

                                        <div className="bg-gray-900 rounded-lg p-4 min-h-[120px] max-h-[160px] overflow-y-auto border border-gray-700">
                                            {displayedTranscript || interimTranscript ? (
                                                <p className="text-gray-200 leading-relaxed text-sm">
                                                    {displayedTranscript}
                                                    <span className="text-blue-400 opacity-70">{interimTranscript}</span>
                                                    {isTranscribing && <span className="inline-block w-2 h-4 bg-blue-400 ml-1 animate-pulse" />}
                                                </p>
                                            ) : (
                                                <p className="text-gray-600 text-center text-sm">Transcript will appear here...</p>
                                            )}
                                        </div>

                                        <div className="mt-4 space-y-3">
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={submitTranscript}
                                                    disabled={!transcript.trim() || transcriptStatus.status === 'processing'}
                                                    className={`flex-1 py-2.5 px-4 rounded-lg font-medium transition-all flex items-center justify-center gap-2 ${transcript.trim() && transcriptStatus.status !== 'processing' ? 'bg-purple-600 text-white hover:bg-purple-700' : 'bg-gray-700 text-gray-500 cursor-not-allowed'}`}
                                                >
                                                    {transcriptStatus.status === 'processing' ? <><Loader2 size={16} className="animate-spin" />Processing...</> : <><Send size={16} />Submit All</>}
                                                </button>
                                                <button
                                                    onClick={clearTranscript}
                                                    disabled={!transcript.trim() && !interimTranscript}
                                                    className={`py-2.5 px-4 rounded-lg font-medium transition-all flex items-center justify-center gap-2 ${transcript.trim() || interimTranscript ? 'bg-gray-600 text-white hover:bg-gray-500' : 'bg-gray-700 text-gray-500 cursor-not-allowed'}`}
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>

                                            {transcriptStatus.message && (
                                                <div className={`flex items-start gap-2 p-3 rounded-lg text-sm ${transcriptStatus.status === 'success' ? 'bg-emerald-500/10 text-emerald-400' : transcriptStatus.status === 'error' ? 'bg-red-500/10 text-red-400' : 'bg-blue-500/10 text-blue-400'}`}>
                                                    {transcriptStatus.status === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                                                    {transcriptStatus.message}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Demo Paste Section */}
                            <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
                                <div className="p-4 border-b border-gray-700 bg-gray-900/50">
                                    <h3 className="font-semibold flex items-center gap-2">
                                        <ClipboardPaste size={18} className="text-orange-400" />
                                        Paste Transcript 
                                    </h3>
                                    <p className="text-xs text-gray-500 mt-1">Paste lecture transcript text directly for testing without recording</p>
                                </div>
                                <div className="p-6">
                                    <textarea
                                        value={pasteText}
                                        onChange={(e) => setPasteText(e.target.value)}
                                        placeholder="Paste your lecture transcript here for demo purposes...&#10;&#10;Example: Today we'll be discussing machine learning fundamentals. Machine learning is a subset of artificial intelligence that enables computers to learn from data without being explicitly programmed..."
                                        className="w-full h-32 bg-gray-900 border border-gray-700 rounded-lg p-4 text-gray-200 text-sm resize-none focus:outline-none focus:border-orange-500/50 placeholder-gray-600"
                                    />

                                    <div className="mt-4 flex gap-3">
                                        <button
                                            onClick={submitPasteText}
                                            disabled={!pasteText.trim() || pasteStatus.status === 'processing'}
                                            className={`flex-1 py-2.5 px-4 rounded-lg font-medium transition-all flex items-center justify-center gap-2 ${pasteText.trim() && pasteStatus.status !== 'processing' ? 'bg-orange-600 text-white hover:bg-orange-700' : 'bg-gray-700 text-gray-500 cursor-not-allowed'}`}
                                        >
                                            {pasteStatus.status === 'processing' ? <><Loader2 size={16} className="animate-spin" />Processing...</> : <><Send size={16} />Submit Pasted Text</>}
                                        </button>
                                        <button
                                            onClick={() => { setPasteText(''); setPasteStatus({ status: 'idle', message: '' }); }}
                                            disabled={!pasteText.trim()}
                                            className={`py-2.5 px-4 rounded-lg font-medium transition-all flex items-center justify-center gap-2 ${pasteText.trim() ? 'bg-gray-600 text-white hover:bg-gray-500' : 'bg-gray-700 text-gray-500 cursor-not-allowed'}`}
                                        >
                                            <Trash2 size={16} />
                                            Clear
                                        </button>
                                    </div>

                                    {pasteStatus.message && (
                                        <div className={`mt-3 flex items-start gap-2 p-3 rounded-lg text-sm ${pasteStatus.status === 'success' ? 'bg-emerald-500/10 text-emerald-400' : pasteStatus.status === 'error' ? 'bg-red-500/10 text-red-400' : 'bg-blue-500/10 text-blue-400'}`}>
                                            {pasteStatus.status === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                                            {pasteStatus.message}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* How it works */}
                            <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
                                <h3 className="font-semibold text-white mb-4">How it works</h3>
                                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                    <div className="flex gap-3">
                                        <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400 font-bold shrink-0">1</div>
                                        <div>
                                            <h4 className="font-medium text-white text-sm">Upload Slides</h4>
                                            <p className="text-xs text-gray-500">Text is extracted and stored</p>
                                        </div>
                                    </div>
                                    <div className="flex gap-3">
                                        <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center text-purple-400 font-bold shrink-0">2</div>
                                        <div>
                                            <h4 className="font-medium text-white text-sm">Record Lecture</h4>
                                            <p className="text-xs text-gray-500">Speech auto-saves every 5s</p>
                                        </div>
                                    </div>
                                    <div className="flex gap-3">
                                        <div className="w-8 h-8 rounded-full bg-orange-500/20 flex items-center justify-center text-orange-400 font-bold shrink-0">3</div>
                                        <div>
                                            <h4 className="font-medium text-white text-sm">Or Paste Text</h4>
                                            <p className="text-xs text-gray-500">For demos without mic</p>
                                        </div>
                                    </div>
                                    <div className="flex gap-3">
                                        <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400 font-bold shrink-0">4</div>
                                        <div>
                                            <h4 className="font-medium text-white text-sm">Student Access</h4>
                                            <p className="text-xs text-gray-500">AI summaries & Q&A ready</p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Clear Content Section */}
                            {contentStats && contentStats.document_count > 0 && (
                                <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-4">
                                            <div className="p-3 bg-red-500/20 rounded-lg">
                                                <Trash2 size={24} className="text-red-400" />
                                            </div>
                                            <div>
                                                <h3 className="font-semibold text-white">Lecture Finished?</h3>
                                                <p className="text-sm text-gray-400">Clear all {contentStats.document_count} stored chunks to prepare for the next lecture</p>
                                            </div>
                                        </div>
                                        <button
                                            onClick={clearContent}
                                            className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors flex items-center gap-2"
                                        >
                                            <Trash2 size={18} />
                                            Clear All Content
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* TAB 2: QUIZ & OUTCOMES */}
                    {activeTab === 'quiz' && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                            {/* ===== LEARNING OUTCOMES SECTION ===== */}
                            <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
                                <div className="p-4 border-b border-gray-700 bg-gray-900/50">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className="p-2.5 bg-emerald-500/20 rounded-xl">
                                                <Target size={22} className="text-emerald-400" />
                                            </div>
                                            <div>
                                                <h3 className="font-bold text-white text-lg">Learning Outcomes</h3>
                                                <p className="text-sm text-gray-400">Upload your module&apos;s learning outcomes PDF to align quiz generation</p>
                                            </div>
                                        </div>
                                        <span className="bg-gray-700 text-gray-300 text-xs font-medium px-3 py-1 rounded-full border border-gray-600">
                                            {learningOutcomes.length} outcomes loaded
                                        </span>
                                    </div>
                                </div>
                                <div className="p-6 space-y-4">
                                    {/* Upload area */}
                                    <div className="flex gap-4">
                                        <div
                                            className="flex-1 border-2 border-dashed rounded-xl p-4 text-center transition-all cursor-pointer border-gray-600 hover:border-emerald-500/50 hover:bg-gray-700/30"
                                            onClick={() => outcomeFileRef.current?.click()}
                                        >
                                            <input ref={outcomeFileRef} type="file" accept=".pdf,.txt" className="hidden" onChange={(e) => e.target.files?.[0] && setOutcomeFile(e.target.files[0])} />
                                            <Upload size={24} className="mx-auto text-gray-500 mb-2" />
                                            <p className="text-white font-medium text-sm">{outcomeFile ? outcomeFile.name : 'Upload Learning Outcomes'}</p>
                                            <p className="text-xs text-gray-500 mt-1">{outcomeFile ? `${(outcomeFile.size / 1024).toFixed(1)} KB` : 'PDF or TXT'}</p>
                                        </div>
                                        <button
                                            onClick={uploadOutcomeFile}
                                            disabled={!outcomeFile || outcomeUploadStatus.status === 'uploading'}
                                            className={`px-6 rounded-lg font-medium transition-all flex items-center gap-2 ${outcomeFile && outcomeUploadStatus.status !== 'uploading' ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-gray-700 text-gray-500 cursor-not-allowed'}`}
                                        >
                                            {outcomeUploadStatus.status === 'uploading' ? <><Loader2 size={16} className="animate-spin" />Processing...</> : <><Upload size={16} />Upload</>}
                                        </button>
                                    </div>
                                    {outcomeUploadStatus.message && (
                                        <div className={`flex items-start gap-2 p-3 rounded-lg text-sm ${outcomeUploadStatus.status === 'success' ? 'bg-emerald-500/10 text-emerald-400' : outcomeUploadStatus.status === 'error' ? 'bg-red-500/10 text-red-400' : 'bg-blue-500/10 text-blue-400'}`}>
                                            {outcomeUploadStatus.status === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                                            {outcomeUploadStatus.message}
                                        </div>
                                    )}
                                    {/* Outcomes list */}
                                    {learningOutcomes.length > 0 && (
                                        <div className="space-y-2 max-h-[200px] overflow-y-auto">
                                            {learningOutcomes.map((outcome) => (
                                                <div key={outcome.id} className="flex items-start gap-3 bg-gray-900/50 rounded-lg p-3 border border-gray-700">
                                                    <CheckCircle2 size={16} className="text-emerald-400 mt-0.5 shrink-0" />
                                                    <p className="text-sm text-gray-300 flex-1 leading-relaxed">{outcome.text}</p>
                                                    <button onClick={() => deleteOutcome(outcome.id)} className="p-1 hover:bg-red-500/20 rounded transition-colors group shrink-0">
                                                        <X size={14} className="text-gray-500 group-hover:text-red-400" />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* ===== CLASS QUIZ SECTION ===== */}
                            <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
                                <div className="p-4 border-b border-gray-700 bg-gray-900/50">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className="p-2.5 bg-blue-500/20 rounded-xl">
                                                <Brain size={22} className="text-blue-400" />
                                            </div>
                                            <div>
                                                <h3 className="font-bold text-white text-lg flex items-center gap-2">
                                                    AI-Generated Quiz
                                                    <span className="px-2 py-0.5 bg-gray-700 text-gray-300 text-xs font-medium rounded-full border border-gray-600">
                                                        <Sparkles size={10} className="inline mr-1" />
                                                        From Lecture Content + Outcomes
                                                    </span>
                                                </h3>
                                                <p className="text-sm text-gray-400">Questions generated from your lecture content aligned with learning outcomes</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <button
                                                onClick={() => setShowGenerateModal(true)}
                                                disabled={learningOutcomes.length === 0}
                                                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${learningOutcomes.length > 0 ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-gray-700 text-gray-500 cursor-not-allowed'}`}
                                                title={learningOutcomes.length === 0 ? 'Upload learning outcomes first' : ''}
                                            >
                                                <Wand2 size={18} />
                                                Generate Quiz
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                <div className="p-6 space-y-6">
                                    {quizzes.length === 0 ? (
                                        <div className="text-center py-12">
                                            <div className="w-16 h-16 bg-blue-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                                                <HelpCircle size={32} className="text-blue-400" />
                                            </div>
                                            <h4 className="text-lg font-semibold text-white mb-2">No Quizzes Yet</h4>
                                            <p className="text-gray-400 mb-6">Upload learning outcomes, then generate AI-powered quizzes</p>
                                            <button
                                                onClick={() => setShowGenerateModal(true)}
                                                disabled={learningOutcomes.length === 0}
                                                className={`inline-flex items-center gap-2 px-6 py-3 rounded-lg font-medium transition-all ${learningOutcomes.length > 0 ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-gray-700 text-gray-500 cursor-not-allowed'}`}
                                            >
                                                <Wand2 size={18} />
                                                Generate Your First Quiz
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="space-y-4">
                                            {quizzes.map((quiz: Quiz) => (
                                                <div key={quiz.id} className={`bg-gray-800/80 rounded-xl border transition-all ${quiz.status === 'released' ? 'border-emerald-500/50 shadow-lg shadow-emerald-500/10' : 'border-gray-700 hover:border-indigo-500/50'}`}>
                                                    <div className="p-4">
                                                        {/* Quiz header */}
                                                        <div className="flex items-center justify-between mb-3">
                                                            <div className="flex items-center gap-2 flex-wrap">
                                                                <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${quiz.difficulty === 'Beginner' ? 'bg-green-500/20 text-green-400' : quiz.difficulty === 'Intermediate' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-red-500/20 text-red-400'}`}>
                                                                    {quiz.difficulty}
                                                                </span>
                                                                <span className="text-xs text-gray-500">{quiz.num_questions} questions</span>
                                                                <span className="text-xs text-gray-600">Created {new Date(quiz.created_at).toLocaleDateString()}</span>
                                                            </div>
                                                            <div className="flex items-center gap-2">
                                                                {quiz.status === 'released' && (
                                                                    <span className="flex items-center gap-1 text-xs text-emerald-400"><CheckCheck size={14} />Released</span>
                                                                )}
                                                                <button onClick={() => removeQuiz(quiz.id)} className="p-1 hover:bg-red-500/20 rounded transition-colors group" title="Remove quiz">
                                                                    <X size={14} className="text-gray-500 group-hover:text-red-400" />
                                                                </button>
                                                            </div>
                                                        </div>

                                                        {/* Questions preview */}
                                                        <div className="space-y-2 mb-4">
                                                            {quiz.questions.slice(0, 3).map((q: QuizQuestion, qi: number) => (
                                                                <div key={qi} className="bg-gray-900/50 rounded-lg p-3 border border-gray-700">
                                                                    <p className="text-sm text-white font-medium mb-1">Q{q.id}. {q.question}</p>
                                                                    {q.learningOutcome && (
                                                                        <p className="text-[10px] text-emerald-400/70 mt-1 truncate">LO: {q.learningOutcome}</p>
                                                                    )}
                                                                </div>
                                                            ))}
                                                            {quiz.questions.length > 3 && (
                                                                <p className="text-xs text-gray-500 text-center">+ {quiz.questions.length - 3} more questions</p>
                                                            )}
                                                        </div>

                                                        {quiz.status === 'released' ? (
                                                            <div className="flex gap-2">
                                                                <button
                                                                    disabled
                                                                    className="w-1/3 py-2 px-4 rounded-lg font-medium bg-gray-700 text-gray-500 cursor-not-allowed flex items-center justify-center gap-2"
                                                                >
                                                                    <CheckCircle2 size={16} />Released
                                                                </button>
                                                                <button
                                                                    onClick={() => fetchAnalytics(quiz.id)}
                                                                    className="w-2/3 py-2 px-4 rounded-lg font-medium transition-all flex items-center justify-center gap-2 bg-purple-600 text-white hover:bg-purple-700"
                                                                >
                                                                    <BarChart size={16} />View Analytics
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <div className="flex gap-2 w-full">
                                                                <button
                                                                    onClick={() => openEditQuiz(quiz)}
                                                                    className="flex-1 py-2 px-4 rounded-lg font-medium transition-all flex items-center justify-center gap-2 bg-gray-700 text-gray-200 hover:bg-gray-600"
                                                                >
                                                                    <Settings size={16} />Edit
                                                                </button>
                                                                <button
                                                                    onClick={() => releaseQuiz(quiz.id)}
                                                                    className="flex-[2] py-2 px-4 rounded-lg font-medium transition-all flex items-center justify-center gap-2 bg-indigo-600 text-white hover:bg-indigo-700"
                                                                >
                                                                    <PlayCircle size={16} />Release to Class
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </main>

            {/* ===== QUIZ GENERATION MODAL ===== */}
            {showGenerateModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
                    <div className="bg-gray-900 rounded-2xl border border-indigo-500/50 shadow-2xl shadow-indigo-500/20 w-full max-w-lg mx-4 overflow-hidden">
                        {/* Modal Header */}
                        <div className="bg-gradient-to-r from-indigo-600/30 to-purple-600/30 px-6 py-4 border-b border-gray-700 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-indigo-500/20 rounded-lg">
                                    <Wand2 size={22} className="text-indigo-400" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-white text-lg">Generate Quiz</h3>
                                    <p className="text-sm text-gray-400">AI will create questions from your content</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setShowGenerateModal(false)}
                                className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
                            >
                                <X size={20} className="text-gray-400" />
                            </button>
                        </div>

                        {/* Modal Content */}
                        <div className="p-6 space-y-6">
                            {/* Learning Outcomes Info */}
                            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4">
                                <div className="flex items-center gap-2 mb-1">
                                    <Target size={16} className="text-emerald-400" />
                                    <span className="text-sm font-medium text-emerald-400">{learningOutcomes.length} Learning Outcomes Loaded</span>
                                </div>
                                <p className="text-xs text-gray-400">Questions will be aligned to your uploaded learning outcomes</p>
                            </div>

                            {/* Difficulty Selection */}
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">Difficulty Level</label>
                                <div className="grid grid-cols-3 gap-3">
                                    {(['Beginner', 'Intermediate', 'Advanced'] as const).map((level) => (
                                        <button
                                            key={level}
                                            onClick={() => setSelectedDifficulty(level)}
                                            className={`py-3 px-4 rounded-lg font-medium transition-all flex flex-col items-center gap-1 ${selectedDifficulty === level
                                                ? level === 'Beginner' ? 'bg-green-500/20 border-2 border-green-500 text-green-400'
                                                    : level === 'Intermediate' ? 'bg-yellow-500/20 border-2 border-yellow-500 text-yellow-400'
                                                        : 'bg-red-500/20 border-2 border-red-500 text-red-400'
                                                : 'bg-gray-800 border border-gray-700 text-gray-400 hover:border-gray-600'
                                                }`}
                                        >
                                            <span className="text-sm">{level}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Question Count */}
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">
                                    Number of Questions: <span className="text-indigo-400 font-bold">{questionCount}</span>
                                </label>
                                <input
                                    type="range"
                                    min="1"
                                    max="15"
                                    value={questionCount}
                                    onChange={(e) => setQuestionCount(parseInt(e.target.value))}
                                    className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                                />
                                <div className="flex justify-between text-xs text-gray-500 mt-1">
                                    <span>1</span>
                                    <span>8</span>
                                    <span>15</span>
                                </div>
                            </div>

                            {/* Error message */}
                            {generateError && (
                                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex items-start gap-2">
                                    <AlertCircle size={16} className="text-red-400 shrink-0 mt-0.5" />
                                    <p className="text-sm text-red-400">{generateError}</p>
                                </div>
                            )}

                            {/* Preview */}
                            <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
                                <p className="text-sm text-gray-400">
                                    <Sparkles size={14} className="inline mr-2 text-purple-400" />
                                    Will generate <strong className="text-white">{questionCount}</strong> {selectedDifficulty.toLowerCase()} questions from lecture content aligned with <strong className="text-white">{learningOutcomes.length}</strong> learning outcomes
                                </p>
                            </div>
                        </div>

                        {/* Modal Footer */}
                        <div className="px-6 py-4 border-t border-gray-700 bg-gray-800/50 flex justify-end gap-3">
                            <button
                                onClick={() => setShowGenerateModal(false)}
                                className="px-4 py-2 bg-gray-700 text-gray-300 rounded-lg font-medium hover:bg-gray-600 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={generateQuiz}
                                disabled={isGenerating}
                                className="px-6 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg font-medium hover:from-indigo-700 hover:to-purple-700 transition-all flex items-center gap-2 disabled:opacity-50"
                            >
                                {isGenerating ? (
                                    <><Loader2 size={18} className="animate-spin" />Generating...</>
                                ) : (
                                    <><Wand2 size={18} />Generate Quiz</>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ===== PENDING OUTCOMES MODAL ===== */}
            {showPendingModal && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm">
                    <div className="bg-gray-900 rounded-2xl border border-blue-500/50 shadow-2xl shadow-blue-500/20 w-full max-w-4xl max-h-[90vh] mx-4 flex flex-col">
                        <div className="bg-gradient-to-r from-blue-600/30 to-indigo-600/30 px-6 py-4 border-b border-gray-700 flex items-center justify-between shrink-0">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-blue-500/20 rounded-lg">
                                    <Target size={22} className="text-blue-400" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-white text-lg">Review Extracted Outcomes</h3>
                                    <p className="text-sm text-gray-400">Edit, remove or add outcomes before saving.</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setShowPendingModal(false)}
                                className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
                            >
                                <X size={20} className="text-gray-400" />
                            </button>
                        </div>
                        <div className="p-6 overflow-y-auto flex-1 space-y-4">
                            {pendingOutcomes.map((outcome, idx) => (
                                <div key={idx} className="flex items-start gap-3 bg-gray-800/50 p-3 rounded-lg border border-gray-700 group">
                                    <div className="mt-2 text-gray-500 font-medium text-sm w-6 shrink-0">{idx + 1}.</div>
                                    <textarea
                                        value={outcome}
                                        onChange={(e) => updatePendingOutcome(idx, e.target.value)}
                                        className="flex-1 bg-gray-900/50 border border-gray-700 rounded-lg p-2 text-sm text-gray-300 min-h-[60px] focus:outline-none focus:border-blue-500/50"
                                    />
                                    <button
                                        onClick={() => removePendingOutcome(idx)}
                                        className="mt-2 p-1.5 hover:bg-red-500/20 rounded text-gray-500 hover:text-red-400 transition-colors"
                                        title="Remove outcome"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            ))}
                            {pendingOutcomes.length === 0 && (
                                <div className="text-center py-6 text-gray-400">
                                    No outcomes extracted. You can add them manually below.
                                </div>
                            )}

                            {/* Add manual outcome */}
                            <div className="flex gap-2 pt-4 border-t border-gray-800">
                                <input
                                    type="text"
                                    value={newOutcomeText}
                                    onChange={(e) => setNewOutcomeText(e.target.value)}
                                    placeholder="Add a missing outcome..."
                                    className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50"
                                    onKeyDown={(e) => e.key === 'Enter' && addPendingOutcome()}
                                />
                                <button
                                    onClick={addPendingOutcome}
                                    disabled={!newOutcomeText.trim()}
                                    className="px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 disabled:opacity-50 transition-colors flex items-center gap-2"
                                >
                                    <Plus size={16} /> Add
                                </button>
                            </div>
                        </div>
                        <div className="px-6 py-4 border-t border-gray-700 bg-gray-800/50 flex justify-end gap-3">
                            <button
                                onClick={() => setShowPendingModal(false)}
                                className="px-4 py-2 bg-gray-700 text-gray-300 rounded-lg font-medium hover:bg-gray-600 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={saveApprovedOutcomes}
                                disabled={isSavingOutcomes || pendingOutcomes.length === 0}
                                className="px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors flex items-center gap-2 disabled:opacity-50"
                            >
                                {isSavingOutcomes ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                                Save {pendingOutcomes.length} Outcomes
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ===== ANALYTICS MODAL ===== */}
            {showAnalytics && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm">
                    <div className="bg-gray-900 rounded-2xl border border-purple-500/50 shadow-2xl shadow-purple-500/20 w-full max-w-5xl max-h-[90vh] mx-4 flex flex-col">
                        {/* Header */}
                        <div className="bg-gradient-to-r from-indigo-600/30 to-purple-600/30 px-6 py-4 border-b border-gray-700 flex items-center justify-between shrink-0">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-purple-500/20 rounded-lg">
                                    <BarChart size={22} className="text-purple-400" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-white text-lg">Quiz Performance Analytics</h3>
                                    <p className="text-sm text-gray-400">Class results and learning outcome achievement</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setShowAnalytics(false)}
                                className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
                            >
                                <X size={20} className="text-gray-400" />
                            </button>
                        </div>

                        {/* Content */}
                        <div className="p-6 overflow-y-auto flex-1">
                            {isAnalyticsLoading ? (
                                <div className="flex flex-col items-center justify-center py-20">
                                    <Loader2 size={40} className="animate-spin text-purple-500 mb-4" />
                                    <p className="text-gray-400">Loading analytics data...</p>
                                </div>
                            ) : !analyticsData ? (
                                <div className="flex flex-col items-center justify-center py-20 text-center">
                                    <AlertCircle size={40} className="text-red-400 mb-4" />
                                    <p className="text-white font-medium">Failed to load analytics</p>
                                    <p className="text-gray-400 text-sm">Please try again later.</p>
                                </div>
                            ) : analyticsData.total_submissions === 0 ? (
                                <div className="flex flex-col items-center justify-center py-20 text-center">
                                    <div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center mb-4">
                                        <Users size={32} className="text-gray-500" />
                                    </div>
                                    <h4 className="text-lg font-semibold text-white mb-2">No Submissions Yet</h4>
                                    <p className="text-gray-400 max-w-sm">Students haven't taken this quiz yet. Analytics will appear here once responses are submitted.</p>
                                </div>
                            ) : (
                                <div className="space-y-6">
                                    {/* Stats grid */}
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                        <div className="bg-gray-800/80 rounded-xl p-4 border border-gray-700">
                                            <p className="text-sm text-gray-400 mb-1">Total Submissions</p>
                                            <p className="text-2xl font-bold text-white flex items-center gap-2">
                                                <Users size={20} className="text-blue-400" />
                                                {analyticsData.total_submissions}
                                            </p>
                                        </div>
                                        <div className="bg-gray-800/80 rounded-xl p-4 border border-gray-700">
                                            <p className="text-sm text-gray-400 mb-1">Class Average</p>
                                            <p className="text-2xl font-bold text-white flex items-center gap-2">
                                                <Target size={20} className="text-emerald-400" />
                                                {analyticsData.stats.average_percentage}%
                                            </p>
                                        </div>
                                        <div className="bg-gray-800/80 rounded-xl p-4 border border-gray-700">
                                            <p className="text-sm text-gray-400 mb-1">Highest Score</p>
                                            <p className="text-2xl font-bold text-white flex items-center gap-2">
                                                <TrendingUp size={20} className="text-indigo-400" />
                                                {analyticsData.stats.max_score} / {analyticsData.stats.max_total}
                                            </p>
                                        </div>
                                        <div className="bg-gray-800/80 rounded-xl p-4 border border-gray-700">
                                            <p className="text-sm text-gray-400 mb-1">Pass Rate (&ge;60%)</p>
                                            <p className="text-2xl font-bold text-white flex items-center gap-2">
                                                <CheckCheck size={20} className="text-green-400" />
                                                {Math.round((analyticsData.pass_fail.passed / analyticsData.total_submissions) * 100)}%
                                            </p>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                        {/* Score Distribution (Histogram) */}
                                        <div className="bg-gray-800/50 rounded-xl p-5 border border-gray-700">
                                            <h4 className="font-semibold text-white mb-4 flex items-center gap-2">
                                                <BarChart size={18} className="text-blue-400" />
                                                Score Distribution
                                            </h4>
                                            <div className="h-64">
                                                <ResponsiveContainer width="100%" height="100%">
                                                    <RechartsBarChart data={analyticsData.score_distribution} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                                        <XAxis dataKey="range" stroke="#9ca3af" fontSize={12} tickLine={false} axisLine={false} />
                                                        <YAxis stroke="#9ca3af" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                                                        <Tooltip cursor={{ fill: 'rgba(255,255,255,0.05)' }} contentStyle={{ backgroundColor: '#1f2937', borderColor: '#374151', borderRadius: '0.5rem', color: '#fff' }} />
                                                        <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]}>
                                                            {analyticsData.score_distribution.map((entry: any, index: number) => (
                                                                <Cell key={`cell-${index}`} fill={index > 2 ? '#34d399' : index === 2 ? '#fbbf24' : '#f87171'} />
                                                            ))}
                                                        </Bar>
                                                    </RechartsBarChart>
                                                </ResponsiveContainer>
                                            </div>
                                        </div>

                                        {/* Pass / Fail Pie Chart */}
                                        <div className="bg-gray-800/50 rounded-xl p-5 border border-gray-700">
                                            <h4 className="font-semibold text-white mb-4 flex items-center gap-2">
                                                <Target size={18} className="text-emerald-400" />
                                                Pass vs Fail Ratio
                                            </h4>
                                            <div className="h-64 flex items-center justify-center">
                                                <ResponsiveContainer width="100%" height="100%">
                                                    <PieChart>
                                                        <Pie
                                                            data={[
                                                                { name: 'Passed', value: analyticsData.pass_fail.passed },
                                                                { name: 'Failed', value: analyticsData.pass_fail.failed }
                                                            ]}
                                                            cx="50%"
                                                            cy="50%"
                                                            labelLine={false}
                                                            outerRadius={80}
                                                            fill="#8884d8"
                                                            dataKey="value"
                                                            label={({ name, percent }) => percent > 0 ? `${name} ${(percent * 100).toFixed(0)}%` : ''}
                                                        >
                                                            <Cell fill="#34d399" />
                                                            <Cell fill="#f87171" />
                                                        </Pie>
                                                        <Tooltip contentStyle={{ backgroundColor: '#1f2937', borderColor: '#374151', borderRadius: '0.5rem', color: '#fff' }} />
                                                    </PieChart>
                                                </ResponsiveContainer>
                                            </div>
                                        </div>

                                        {/* Learning Outcome Achievement (Horizontal Bar) */}
                                        <div className="bg-gray-800/50 rounded-xl p-5 border border-gray-700 lg:col-span-2">
                                            <h4 className="font-semibold text-white mb-4 flex items-center gap-2">
                                                <Brain size={18} className="text-purple-400" />
                                                Learning Outcome Achievement
                                            </h4>
                                            <div className="h-72">
                                                <ResponsiveContainer width="100%" height="100%">
                                                    <RechartsBarChart
                                                        data={analyticsData.learning_outcome_achievement}
                                                        layout="vertical"
                                                        margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                                                    >
                                                        <XAxis type="number" domain={[0, 100]} stroke="#9ca3af" fontSize={12} tickLine={false} axisLine={false} />
                                                        <YAxis dataKey="outcome" type="category" stroke="#9ca3af" fontSize={11} width={150} tickLine={false} axisLine={false} />
                                                        <Tooltip
                                                            cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                                                            contentStyle={{ backgroundColor: '#1f2937', borderColor: '#374151', borderRadius: '0.5rem', color: '#fff' }}
                                                            formatter={(val) => [`${val}%`, 'Accuracy']}
                                                        />
                                                        <Bar dataKey="percentage" name="Accuracy" radius={[0, 4, 4, 0]}>
                                                            {analyticsData.learning_outcome_achievement.map((entry: any, index: number) => (
                                                                <Cell key={`cell-${index}`} fill={entry.percentage >= 70 ? '#10b981' : entry.percentage >= 40 ? '#f59e0b' : '#ef4444'} />
                                                            ))}
                                                        </Bar>
                                                    </RechartsBarChart>
                                                </ResponsiveContainer>
                                            </div>
                                        </div>

                                        {/* Difficulty Breakdown (Doughnut) */}
                                        <div className="bg-gray-800/50 rounded-xl p-5 border border-gray-700 lg:col-span-2">
                                            <h4 className="font-semibold text-white mb-4 flex items-center gap-2">
                                                <Wand2 size={18} className="text-pink-400" />
                                                Performance by Question Difficulty
                                            </h4>
                                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                                {analyticsData.difficulty_breakdown.map((diff: any, idx: number) => (
                                                    <div key={idx} className="bg-gray-900/50 rounded-lg p-4 border border-gray-700/50 flex flex-col items-center">
                                                        <span className={`text-sm font-medium mb-2 ${diff.difficulty === 'Beginner' ? 'text-green-400' : diff.difficulty === 'Intermediate' ? 'text-yellow-400' : 'text-red-400'}`}>
                                                            {diff.difficulty} Breakdown
                                                        </span>
                                                        <div className="h-32 w-full">
                                                            <ResponsiveContainer width="100%" height="100%">
                                                                <PieChart>
                                                                    <Pie
                                                                        data={[
                                                                            { name: 'Correct', value: diff.correct },
                                                                            { name: 'Incorrect', value: diff.incorrect }
                                                                        ]}
                                                                        cx="50%"
                                                                        cy="50%"
                                                                        innerRadius={30}
                                                                        outerRadius={50}
                                                                        fill="#8884d8"
                                                                        dataKey="value"
                                                                    >
                                                                        <Cell fill="#34d399" />
                                                                        <Cell fill="#f87171" />
                                                                    </Pie>
                                                                    <Tooltip contentStyle={{ backgroundColor: '#1f2937', borderColor: '#374151', borderRadius: '0.5rem', color: '#fff' }} />
                                                                </PieChart>
                                                            </ResponsiveContainer>
                                                        </div>
                                                        <div className="mt-2 text-center w-full">
                                                            <div className="flex justify-between text-xs text-gray-400 mb-1">
                                                                <span>Accuracy:</span>
                                                                <span className="font-bold text-white">{diff.percentage}%</span>
                                                            </div>
                                                            <div className="w-full bg-gray-700 rounded-full h-1.5">
                                                                <div className={`h-1.5 rounded-full ${diff.percentage >= 70 ? 'bg-emerald-500' : diff.percentage >= 40 ? 'bg-yellow-500' : 'bg-red-500'}`} style={{ width: `${diff.percentage}%` }}></div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                                {analyticsData.difficulty_breakdown.length === 0 && (
                                                    <div className="col-span-3 text-center py-8 text-gray-500 text-sm">
                                                        No difficulty data available
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ===== EDIT QUIZ MODAL ===== */}
            {editingQuiz && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-sm">
                    <div className="bg-gray-900 rounded-2xl border border-indigo-500/50 shadow-2xl shadow-indigo-500/20 w-full max-w-4xl max-h-[90vh] mx-4 flex flex-col">
                        <div className="bg-gradient-to-r from-gray-800 to-gray-700 px-6 py-4 border-b border-gray-700 flex items-center justify-between shrink-0">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-gray-600 rounded-lg">
                                    <Settings size={22} className="text-gray-200" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-white text-lg">Edit Quiz</h3>
                                    <p className="text-sm text-gray-400">Modify questions, answers, and regenerate questions.</p>
                                </div>
                            </div>
                            <button
                                onClick={closeEditQuiz}
                                className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
                            >
                                <X size={20} className="text-gray-400" />
                            </button>
                        </div>

                        <div className="p-6 overflow-y-auto flex-1 space-y-6">
                            {editingQuiz.questions.map((question, qIndex) => (
                                <div key={question.id || qIndex} className="bg-gray-800/80 p-5 rounded-xl border border-gray-700 space-y-4">
                                    <div className="flex justify-between items-start gap-4">
                                        <div className="flex-1 space-y-2">
                                            <div className="flex items-center gap-2 mb-2">
                                                <span className="bg-indigo-500/20 text-indigo-400 text-xs px-2.5 py-1 rounded-full font-medium">Question {qIndex + 1}</span>
                                                {question.learningOutcome && (
                                                    <span className="text-xs text-emerald-400/80 line-clamp-1 border border-emerald-500/20 rounded px-2 py-0.5">LO: {question.learningOutcome}</span>
                                                )}
                                            </div>
                                            <textarea
                                                className="w-full bg-gray-900/50 border border-gray-600 rounded-lg p-3 text-white focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 min-h-[80px]"
                                                value={question.question}
                                                onChange={(e) => handleEditQuestionText(qIndex, e.target.value)}
                                            />
                                        </div>
                                        <button
                                            onClick={() => regenerateQuestion(qIndex, question.id)}
                                            disabled={isRegeneratingQuestion === question.id}
                                            className="px-4 py-2 bg-purple-600/20 text-purple-400 border border-purple-500/30 rounded-lg hover:bg-purple-600/30 transition-colors flex items-center gap-2 whitespace-nowrap disabled:opacity-50"
                                        >
                                            {isRegeneratingQuestion === question.id ? (
                                                <><Loader2 size={16} className="animate-spin" />Regenerating...</>
                                            ) : (
                                                <><Wand2 size={16} />Regenerate</>
                                            )}
                                        </button>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
                                        {question.options.map((opt, optIndex) => (
                                            <div key={optIndex} className={`flex items-center gap-3 p-2 rounded-lg border transition-colors ${question.correctAnswer === optIndex ? 'border-emerald-500 bg-emerald-500/10' : 'border-gray-700 bg-gray-900/30'}`}>
                                                <button
                                                    onClick={() => handleSetCorrectAnswer(qIndex, optIndex)}
                                                    className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 ${question.correctAnswer === optIndex ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-gray-500 hover:border-emerald-400/50'}`}
                                                >
                                                    {question.correctAnswer === optIndex && <CheckCircle2 size={14} />}
                                                </button>
                                                <input
                                                    className={`w-full bg-transparent border-none text-sm focus:outline-none focus:ring-0 ${question.correctAnswer === optIndex ? 'text-emerald-300' : 'text-gray-300'}`}
                                                    value={opt}
                                                    onChange={(e) => handleEditOptionText(qIndex, optIndex, e.target.value)}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="px-6 py-4 border-t border-gray-700 bg-gray-800/50 flex justify-end gap-3 shrink-0">
                            <button
                                onClick={closeEditQuiz}
                                className="px-4 py-2 bg-gray-700 text-gray-300 rounded-lg font-medium hover:bg-gray-600 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={saveEditedQuiz}
                                disabled={isSavingQuiz}
                                className="px-6 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors flex items-center gap-2 disabled:opacity-50"
                            >
                                {isSavingQuiz ? <Loader2 size={16} className="animate-spin" /> : <CheckCheck size={16} />}
                                Save Changes
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
