"use client";

import { useAuth, UserRole } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
    Brain, ThumbsUp, ThumbsDown, MessageCircle, FileText, Target,
    RefreshCw, ArrowLeft, TrendingUp, BarChart3, Activity, Clock,
    CheckCircle2, XCircle, Edit3, Sparkles, Loader2, BookOpen
} from "lucide-react";
import RoleGuard from "@/components/RoleGuard";
import {
    BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell, Legend, RadarChart, Radar, PolarGrid,
    PolarAngleAxis, PolarRadiusAxis, AreaChart, Area, CartesianGrid
} from "recharts";

const API_BASE_URL = "http://localhost:8000";

interface Analytics {
    qa: { total: number; positive: number; negative: number; satisfaction_rate: number; with_comments: number };
    summary: { total: number; helpful: number; not_helpful: number; helpfulness_rate: number; by_type: Record<string, { helpful: number; total: number }> };
    quiz_edits: { total_quizzes: number; total_questions_generated: number; questions_edited: number; questions_regenerated: number; questions_deleted: number; total_modifications: number; edit_rate: number; acceptance_rate: number };
    total_feedback: number;
    daily_trend: Array<{ date: string; qa_positive: number; qa_negative: number; summary_positive: number; summary_negative: number }>;
    features_summary: Array<{ feature: string; satisfaction: number; total: number }>;
    date_range: { first?: string; last?: string };
}

interface FeedbackEntry {
    type: "feedback" | "quiz_edit";
    feature?: string;
    rating?: number;
    comment?: string;
    student_id?: string;
    question?: string;
    response?: string;
    summary_type?: string;
    action?: string;
    quiz_id?: string;
    question_id?: number;
    details?: string;
    created_at?: string;
}

const PIE_COLORS = ["#10b981", "#ef4444"];
const RADAR_COLOR = "#8b5cf6";

function timeAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
}

export default function AIEvaluationDashboard() {
    const { user, isLoading, token } = useAuth();
    const router = useRouter();
    const [analytics, setAnalytics] = useState<Analytics | null>(null);
    const [recentEntries, setRecentEntries] = useState<FeedbackEntry[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!isLoading) {
            if (!user || user.role !== UserRole.ADMIN) {
                router.push("/login");
            } else {
                fetchAll();
            }
        }
    }, [user, isLoading]);

    const fetchAll = async () => {
        setLoading(true);
        try {
            const [aRes, rRes] = await Promise.all([
                fetch(`${API_BASE_URL}/api/performance/feedback/analytics`),
                fetch(`${API_BASE_URL}/api/performance/feedback/recent?limit=30`),
            ]);
            if (aRes.ok) { const d = await aRes.json(); setAnalytics(d.analytics); }
            if (rRes.ok) { const d = await rRes.json(); setRecentEntries(d.entries || []); }
        } catch (e) { console.error("Failed to fetch evaluation data:", e); }
        finally { setLoading(false); }
    };

    if (isLoading || !user || user.role !== UserRole.ADMIN) {
        return <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">Loading...</div>;
    }

    const hasData = analytics && analytics.total_feedback > 0;
    const overallSatisfaction = analytics && analytics.total_feedback > 0
        ? Math.round(((analytics.qa.positive + analytics.summary.helpful) / analytics.total_feedback) * 100)
        : 0;

    // Pie data
    const qaPieData = analytics ? [
        { name: "Positive", value: analytics.qa.positive },
        { name: "Negative", value: analytics.qa.negative },
    ] : [];
    const summaryPieData = analytics ? [
        { name: "Helpful", value: analytics.summary.helpful },
        { name: "Not Helpful", value: analytics.summary.not_helpful },
    ] : [];

    // Quiz edit breakdown for bar chart
    const quizEditBar = analytics ? [
        { name: "Accepted", value: analytics.quiz_edits.total_questions_generated - analytics.quiz_edits.total_modifications, fill: "#10b981" },
        { name: "Edited", value: analytics.quiz_edits.questions_edited, fill: "#f59e0b" },
        { name: "Regenerated", value: analytics.quiz_edits.questions_regenerated, fill: "#8b5cf6" },
        { name: "Deleted", value: analytics.quiz_edits.questions_deleted, fill: "#ef4444" },
    ] : [];

    return (
        <RoleGuard allowedRoles={[UserRole.ADMIN]}>
            <div className="min-h-screen bg-slate-900 text-white">
                {/* Header */}
                <div className="bg-gradient-to-r from-purple-900/40 via-blue-900/30 to-cyan-900/20 border-b border-slate-700">
                    <div className="max-w-7xl mx-auto px-8 py-6">
                        <button onClick={() => router.push("/admin/dashboard")} className="flex items-center gap-2 text-sm text-slate-400 hover:text-white mb-4 transition-colors">
                            <ArrowLeft size={16} /> Back to Admin Dashboard
                        </button>
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4">
                                <div className="p-3 bg-gradient-to-r from-purple-500 to-blue-500 rounded-xl">
                                    <Brain size={28} className="text-white" />
                                </div>
                                <div>
                                    <h1 className="text-2xl font-bold">Human-in-the-Loop LLM Evaluation</h1>
                                    <p className="text-slate-400 text-sm">Real-time user feedback on AI-generated content quality</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                {analytics?.date_range?.first && (
                                    <span className="text-xs text-slate-500 bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-700">
                                        {analytics.date_range.first} — {analytics.date_range.last}
                                    </span>
                                )}
                                <button onClick={fetchAll} className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-sm transition-colors border border-slate-700">
                                    <RefreshCw size={14} /> Refresh
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {loading ? (
                    <div className="flex items-center justify-center py-32"><Loader2 size={32} className="animate-spin text-purple-400" /></div>
                ) : (
                    <div className="max-w-7xl mx-auto px-8 py-8 space-y-8">

                        {/* KPI Stat Cards */}
                        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                            {[
                                { label: "Overall Satisfaction", value: `${overallSatisfaction}%`, icon: TrendingUp, color: "emerald", sub: `${analytics?.total_feedback || 0} total ratings` },
                                { label: "Q&A Answer Quality", value: `${analytics?.qa.satisfaction_rate || 0}%`, icon: MessageCircle, color: "blue", sub: `${analytics?.qa.total || 0} responses rated` },
                                { label: "Summary Helpfulness", value: `${analytics?.summary.helpfulness_rate || 0}%`, icon: BookOpen, color: "purple", sub: `${analytics?.summary.total || 0} summaries rated` },
                                { label: "Quiz Acceptance Rate", value: `${analytics?.quiz_edits.acceptance_rate || 0}%`, icon: Target, color: "amber", sub: `${analytics?.quiz_edits.total_questions_generated || 0} questions generated` },
                                { label: "Feedback with Comments", value: `${analytics?.qa.with_comments || 0}`, icon: Edit3, color: "cyan", sub: "qualitative responses" },
                            ].map((card, i) => (
                                <div key={i} className="bg-slate-800 rounded-xl border border-slate-700 p-5 hover:border-slate-600 transition-colors">
                                    <div className="flex items-center gap-2 mb-3">
                                        <div className={`p-1.5 rounded-lg bg-${card.color}-500/20`}>
                                            <card.icon size={16} className={`text-${card.color}-400`} />
                                        </div>
                                        <span className="text-xs text-slate-400 font-medium">{card.label}</span>
                                    </div>
                                    <div className="text-2xl font-bold text-white">{hasData ? card.value : "—"}</div>
                                    <div className="text-xs text-slate-500 mt-1">{card.sub}</div>
                                </div>
                            ))}
                        </div>

                        {!hasData ? (
                            <div className="bg-slate-800 rounded-xl border border-slate-700 p-16 text-center">
                                <Sparkles size={48} className="mx-auto mb-4 text-slate-600" />
                                <h3 className="text-lg font-semibold text-slate-400 mb-2">No evaluation data yet</h3>
                                <p className="text-sm text-slate-500 max-w-md mx-auto">
                                    Feedback data will appear here as students interact with the AI features.
                                    Students can rate Q&A answers and summaries on their dashboard.
                                </p>
                            </div>
                        ) : (
                            <>
                                {/* Charts Row 1: Pie Charts + Feature Comparison */}
                                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                    {/* Q&A Satisfaction Pie */}
                                    <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
                                        <h3 className="font-semibold text-sm mb-4 flex items-center gap-2">
                                            <MessageCircle size={16} className="text-blue-400" /> Q&A Answer Satisfaction
                                        </h3>
                                        {analytics!.qa.total > 0 ? (
                                            <ResponsiveContainer width="100%" height={200}>
                                                <PieChart>
                                                    <Pie data={qaPieData} cx="50%" cy="50%" innerRadius={50} outerRadius={75} paddingAngle={4} dataKey="value" label={({ name, percent }: any) => `${name} ${((percent || 0) * 100).toFixed(0)}%`}>
                                                        {qaPieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i]} />)}
                                                    </Pie>
                                                    <Tooltip contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: "8px", color: "#fff" }} />
                                                </PieChart>
                                            </ResponsiveContainer>
                                        ) : <p className="text-slate-500 text-sm text-center py-10">No Q&A feedback yet</p>}
                                    </div>

                                    {/* Summary Helpfulness Pie */}
                                    <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
                                        <h3 className="font-semibold text-sm mb-4 flex items-center gap-2">
                                            <BookOpen size={16} className="text-purple-400" /> Summary Helpfulness
                                        </h3>
                                        {analytics!.summary.total > 0 ? (
                                            <ResponsiveContainer width="100%" height={200}>
                                                <PieChart>
                                                    <Pie data={summaryPieData} cx="50%" cy="50%" innerRadius={50} outerRadius={75} paddingAngle={4} dataKey="value" label={({ name, percent }: any) => `${name} ${((percent || 0) * 100).toFixed(0)}%`}>
                                                        {summaryPieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i]} />)}
                                                    </Pie>
                                                    <Tooltip contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: "8px", color: "#fff" }} />
                                                </PieChart>
                                            </ResponsiveContainer>
                                        ) : <p className="text-slate-500 text-sm text-center py-10">No summary feedback yet</p>}
                                    </div>

                                    {/* Quiz Edit Breakdown */}
                                    <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
                                        <h3 className="font-semibold text-sm mb-4 flex items-center gap-2">
                                            <Target size={16} className="text-amber-400" /> Quiz Question Quality
                                        </h3>
                                        {analytics!.quiz_edits.total_questions_generated > 0 ? (
                                            <ResponsiveContainer width="100%" height={200}>
                                                <BarChart data={quizEditBar}>
                                                    <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                                                    <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                                                    <Tooltip contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: "8px", color: "#fff" }} />
                                                    <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                                                        {quizEditBar.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                                                    </Bar>
                                                </BarChart>
                                            </ResponsiveContainer>
                                        ) : <p className="text-slate-500 text-sm text-center py-10">No quiz data yet</p>}
                                    </div>
                                </div>

                                {/* Charts Row 2: Daily Trend + Feature Radar */}
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                    {/* Daily Feedback Trend */}
                                    <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
                                        <h3 className="font-semibold text-sm mb-4 flex items-center gap-2">
                                            <Activity size={16} className="text-cyan-400" /> Feedback Volume Over Time
                                        </h3>
                                        {analytics!.daily_trend.length > 0 ? (
                                            <ResponsiveContainer width="100%" height={250}>
                                                <AreaChart data={analytics!.daily_trend}>
                                                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                                                    <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 10 }} />
                                                    <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                                                    <Tooltip contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: "8px", color: "#fff" }} />
                                                    <Area type="monotone" dataKey="qa_positive" stackId="1" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.3} name="Q&A 👍" />
                                                    <Area type="monotone" dataKey="qa_negative" stackId="2" stroke="#ef4444" fill="#ef4444" fillOpacity={0.2} name="Q&A 👎" />
                                                    <Area type="monotone" dataKey="summary_positive" stackId="3" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.3} name="Summary ✅" />
                                                    <Area type="monotone" dataKey="summary_negative" stackId="4" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.2} name="Summary ❌" />
                                                    <Legend />
                                                </AreaChart>
                                            </ResponsiveContainer>
                                        ) : <p className="text-slate-500 text-sm text-center py-10">Trend data will appear after multiple days of feedback</p>}
                                    </div>

                                    {/* Feature Satisfaction Radar */}
                                    <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
                                        <h3 className="font-semibold text-sm mb-4 flex items-center gap-2">
                                            <BarChart3 size={16} className="text-purple-400" /> AI Feature Satisfaction Comparison
                                        </h3>
                                        {analytics!.features_summary.length > 0 ? (
                                            <ResponsiveContainer width="100%" height={250}>
                                                <RadarChart data={analytics!.features_summary}>
                                                    <PolarGrid stroke="#334155" />
                                                    <PolarAngleAxis dataKey="feature" tick={{ fill: "#94a3b8", fontSize: 12 }} />
                                                    <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fill: "#64748b", fontSize: 10 }} />
                                                    <Radar name="Satisfaction %" dataKey="satisfaction" stroke={RADAR_COLOR} fill={RADAR_COLOR} fillOpacity={0.3} />
                                                    <Tooltip contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: "8px", color: "#fff" }} />
                                                </RadarChart>
                                            </ResponsiveContainer>
                                        ) : <p className="text-slate-500 text-sm text-center py-10">Need feedback on multiple features</p>}
                                    </div>
                                </div>

                                {/* Evaluation Activity Log */}
                                <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
                                    <div className="p-5 border-b border-slate-700 flex items-center justify-between">
                                        <h3 className="font-semibold text-sm flex items-center gap-2">
                                            <Clock size={16} className="text-slate-400" /> Evaluation Activity Log
                                        </h3>
                                        <span className="text-xs text-slate-500">{recentEntries.length} entries</span>
                                    </div>
                                    <div className="divide-y divide-slate-700/50 max-h-[400px] overflow-y-auto">
                                        {recentEntries.length === 0 ? (
                                            <div className="p-8 text-center text-slate-500 text-sm">No evaluation activity yet</div>
                                        ) : recentEntries.map((entry, i) => (
                                            <div key={i} className="px-5 py-3 hover:bg-slate-700/20 transition-colors flex items-start gap-3">
                                                {entry.type === "feedback" ? (
                                                    <>
                                                        <div className={`p-1.5 rounded-lg mt-0.5 ${entry.rating === 1 ? "bg-emerald-500/20" : "bg-red-500/20"}`}>
                                                            {entry.rating === 1 ? <ThumbsUp size={14} className="text-emerald-400" /> : <ThumbsDown size={14} className="text-red-400" />}
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center gap-2">
                                                                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${entry.feature === "qa" ? "bg-blue-500/20 text-blue-400" : "bg-purple-500/20 text-purple-400"}`}>
                                                                    {entry.feature === "qa" ? "Q&A" : entry.summary_type === "quick" ? "Quick Summary" : "Detailed Summary"}
                                                                </span>
                                                                <span className="text-xs text-slate-500">{entry.student_id}</span>
                                                            </div>
                                                            {entry.question && (
                                                                <p className="text-xs text-slate-400 mt-1 truncate">Q: {entry.question}</p>
                                                            )}
                                                            {entry.comment && (
                                                                <p className="text-xs text-amber-400/80 mt-1 italic">&ldquo;{entry.comment}&rdquo;</p>
                                                            )}
                                                        </div>
                                                    </>
                                                ) : (
                                                    <>
                                                        <div className={`p-1.5 rounded-lg mt-0.5 ${entry.action === "edit" ? "bg-amber-500/20" : entry.action === "regenerate" ? "bg-purple-500/20" : "bg-red-500/20"}`}>
                                                            {entry.action === "edit" ? <Edit3 size={14} className="text-amber-400" /> :
                                                                entry.action === "regenerate" ? <RefreshCw size={14} className="text-purple-400" /> :
                                                                    <XCircle size={14} className="text-red-400" />}
                                                        </div>
                                                        <div className="flex-1">
                                                            <span className="text-xs font-medium text-amber-400/80 bg-amber-500/10 px-2 py-0.5 rounded-full">Quiz Edit</span>
                                                            <p className="text-xs text-slate-400 mt-1">Teacher {entry.action}d question #{entry.question_id}</p>
                                                        </div>
                                                    </>
                                                )}
                                                <span className="text-[10px] text-slate-600 whitespace-nowrap">{entry.created_at ? timeAgo(entry.created_at) : ""}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Research Methodology Note */}
                                <div className="bg-gradient-to-r from-purple-900/20 to-blue-900/20 border border-purple-500/20 rounded-xl p-6">
                                    <h3 className="font-semibold text-sm flex items-center gap-2 mb-3">
                                        <Sparkles size={16} className="text-purple-400" /> Evaluation Methodology
                                    </h3>
                                    <p className="text-xs text-slate-400 leading-relaxed">
                                        This dashboard implements <strong className="text-slate-200">Human-in-the-Loop (HITL) evaluation</strong> — a continuous feedback mechanism
                                        embedded directly in the application. Unlike offline metrics (ROUGE, BLEU, BERTScore), HITL captures <strong className="text-slate-200">perceived usefulness</strong> from
                                        the end-user perspective. The three evaluation signals are: (1) <strong className="text-blue-300">Q&A answer satisfaction</strong> — binary thumbs up/down
                                        with optional qualitative comments, (2) <strong className="text-purple-300">Summary helpfulness</strong> — contextual feedback at the point of interaction,
                                        and (3) <strong className="text-amber-300">Quiz question acceptance rate</strong> — implicit quality measurement based on teacher editing behavior.
                                        Together with the offline LLM metrics, this provides both <strong className="text-slate-200">internal validity</strong> (model quality) and <strong className="text-slate-200">external validity</strong> (user satisfaction).
                                    </p>
                                </div>
                            </>
                        )}
                    </div>
                )}
            </div>
        </RoleGuard>
    );
}
