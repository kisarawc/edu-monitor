"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
    ArrowLeft,
    Brain,
    BarChart3,
    Users,
    AlertTriangle,
    RefreshCw,
    BookOpen,
    Eye,
    Activity,
    Target,
    Lightbulb,
    ShieldAlert,
    Info,
    TrendingDown,
    Percent,
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

/** ─── Types ─────────────────────────────────────────────── */
type FactorImportance = {
    factor: string;
    name: string;
    importance_pct: number;
};

type Recommendation = {
    severity: string;
    factor: string;
    title: string;
    description?: string;
    importance_pct?: number;
    actions: string[];
};

type ModuleAttendanceItem = {
    module_code: string;
    module_name: string;
    average_attendance: number;
    student_count: number;
    at_risk_count: number;
};

type OverviewData = {
    status: string;
    message?: string;
    students_analyzed?: number;
    modules_analyzed?: number;
    overall_attendance?: number;
    at_risk_count?: number;
    top_barrier_factor?: string;
    factor_importance?: FactorImportance[];
    recommendations?: Recommendation[];
    module_attendance?: ModuleAttendanceItem[];
    last_trained_at?: string;
};

type AtRiskStudent = {
    student_id: string;
    attendance_pct: number;
    top_barrier: string;
    barrier_score: number;
};

type ModuleData = {
    status: string;
    message?: string;
    module_code?: string;
    module_name?: string;
    students_in_module?: number;
    average_attendance?: number;
    factor_importance?: FactorImportance[];
    recommendations?: Recommendation[];
    at_risk_students?: AtRiskStudent[];
};

type StudentFactorProfile = {
    [key: string]: { name: string; score: number | null; level: string };
};

type StudentModule = {
    module_code: string;
    module_name: string;
    actual_attendance: number;
    top_barrier: string;
};

type StudentData = {
    status: string;
    message?: string;
    student_id?: string;
    factor_profile?: StudentFactorProfile;
    modules?: StudentModule[];
    personalized_recommendations?: string[];
};

/** ─── Helpers ───────────────────────────────────────────── */
const getToken = () => {
    if (typeof window !== "undefined") {
        return localStorage.getItem("token");
    }
    return null;
};

const factorColors: Record<string, string> = {
    F: "#10b981",
    A: "#3b82f6",
    E: "#8b5cf6",
    B: "#f59e0b",
    C: "#ec4899",
    D: "#6b7280",
};

const severityConfig: Record<string, { bg: string; border: string; icon: typeof AlertTriangle; label: string }> = {
    critical: { bg: "rgba(239,68,68,0.1)", border: "#ef4444", icon: ShieldAlert, label: "CRITICAL" },
    warning: { bg: "rgba(245,158,11,0.1)", border: "#f59e0b", icon: AlertTriangle, label: "WARNING" },
    info: { bg: "rgba(59,130,246,0.1)", border: "#3b82f6", icon: Info, label: "INFO" },
};

/** ─── Main Component ────────────────────────────────────── */
export default function MLInsightsPage() {
    const [overview, setOverview] = useState<OverviewData | null>(null);
    const [moduleData, setModuleData] = useState<ModuleData | null>(null);
    const [studentData, setStudentData] = useState<StudentData | null>(null);
    const [loading, setLoading] = useState(true);
    const [moduleLoading, setModuleLoading] = useState(false);
    const [studentLoading, setStudentLoading] = useState(false);
    const [retraining, setRetraining] = useState(false);
    const [selectedModule, setSelectedModule] = useState<string>("all");
    const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [availableModules, setAvailableModules] = useState<string[]>([]);

    // ─── Fetch overview ──────────────────────────────────────
    const fetchOverview = useCallback(async (force = false) => {
        setLoading(true);
        setError(null);
        try {
            const token = getToken();
            const res = await fetch(`${API}/api/ml/overview${force ? "?force=true" : ""}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data: OverviewData = await res.json();
            setOverview(data);

            // Extract modules from the analyzed dataset for the filter
            if (data.module_attendance && data.module_attendance.length > 0) {
                const modules = data.module_attendance.map((m: any) => m.module_code);
                setAvailableModules(modules);
            } else {
                setAvailableModules([]);
            }
        } catch (err: any) {
            setError(err.message || "Failed to load ML insights");
        } finally {
            setLoading(false);
        }
    }, []);

    // ─── Fetch module insights ───────────────────────────────
    const fetchModuleInsights = useCallback(async (moduleCode: string) => {
        setModuleLoading(true);
        try {
            const token = getToken();
            const res = await fetch(`${API}/api/ml/module/${moduleCode}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data: ModuleData = await res.json();
            setModuleData(data);
        } catch {
            setModuleData(null);
        } finally {
            setModuleLoading(false);
        }
    }, []);

    // ─── Fetch student insights ──────────────────────────────
    const fetchStudentInsights = useCallback(async (studentUserId: string) => {
        setStudentLoading(true);
        try {
            const token = getToken();
            const res = await fetch(`${API}/api/ml/student/${studentUserId}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data: StudentData = await res.json();
            setStudentData(data);
        } catch {
            setStudentData(null);
        } finally {
            setStudentLoading(false);
        }
    }, []);

    // ─── Retrain model ───────────────────────────────────────
    const handleRetrain = async () => {
        setRetraining(true);
        try {
            const token = getToken();
            await fetch(`${API}/api/ml/retrain`, {
                method: "POST",
                headers: { Authorization: `Bearer ${token}` },
            });
            await fetchOverview(true);
        } catch {
            /* ignore */
        } finally {
            setRetraining(false);
        }
    };

    // ─── Module selection ────────────────────────────────────
    const handleModuleSelect = (mod: string) => {
        setSelectedModule(mod);
        setSelectedStudentId(null);
        setStudentData(null);
        if (mod === "all") {
            setModuleData(null);
        } else {
            fetchModuleInsights(mod);
        }
    };

    useEffect(() => {
        fetchOverview();
    }, [fetchOverview]);

    // Show module-specific data when a module is selected, global overview otherwise
    const displayImportance = (selectedModule !== "all" && moduleData?.factor_importance)
        ? moduleData.factor_importance
        : overview?.factor_importance;
    const displayRecommendations = (selectedModule !== "all" && moduleData?.recommendations)
        ? moduleData.recommendations
        : overview?.recommendations;
    const displayTitle = selectedModule === "all" ? "All Modules" : selectedModule;

    // ─── Render ──────────────────────────────────────────────
    return (
        <div style={{ minHeight: "100vh", background: "#111827", color: "#e5e7eb", fontFamily: "'Inter', sans-serif" }}>
            {/* Header */}
            <div style={{ background: "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)", borderBottom: "1px solid #1e293b", padding: "20px 32px" }}>
                <div style={{ maxWidth: 1400, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                        <Link href="/teacher/attendance" style={{ color: "#9ca3af", textDecoration: "none", display: "flex", alignItems: "center", gap: 6, fontSize: 14 }}>
                            <ArrowLeft size={16} /> Back to Attendance
                        </Link>
                        <div style={{ width: 1, height: 24, background: "#374151" }} />
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <Brain size={24} style={{ color: "#10b981" }} />
                            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#f9fafb" }}>Attendance Insights</h1>
                        </div>
                    </div>
                    <button
                        onClick={handleRetrain}
                        disabled={retraining}
                        style={{
                            display: "flex", alignItems: "center", gap: 8,
                            padding: "8px 16px", borderRadius: 8,
                            background: retraining ? "#374151" : "#10b981",
                            color: "#fff", border: "none", cursor: retraining ? "not-allowed" : "pointer",
                            fontSize: 14, fontWeight: 500,
                            transition: "all 0.2s",
                        }}
                    >
                        <RefreshCw size={16} style={retraining ? { animation: "spin 1s linear infinite" } : {}} />
                        {retraining ? "Analyzing..." : "Re-Analyze"}
                    </button>
                </div>
            </div>

            <div style={{ maxWidth: 1400, margin: "0 auto", padding: "24px 32px" }}>


                {/* Loading / Error states */}
                {loading && (
                    <div style={{ textAlign: "center", padding: 80 }}>
                        <Activity size={48} style={{ color: "#10b981", animation: "pulse 2s infinite" }} />
                        <p style={{ color: "#9ca3af", marginTop: 16, fontSize: 16 }}>Analyzing attendance + survey data...</p>
                    </div>
                )}

                {error && (
                    <div style={{ textAlign: "center", padding: 80, background: "rgba(239,68,68,0.1)", borderRadius: 12, border: "1px solid #ef4444" }}>
                        <AlertTriangle size={48} style={{ color: "#ef4444" }} />
                        <p style={{ color: "#ef4444", marginTop: 16 }}>{error}</p>
                        <button onClick={() => fetchOverview()} style={{ marginTop: 16, padding: "8px 24px", background: "#ef4444", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}>Retry</button>
                    </div>
                )}

                {/* No data state */}
                {!loading && !error && overview?.status === "no_data" && (
                    <div style={{ textAlign: "center", padding: 80, background: "rgba(59,130,246,0.1)", borderRadius: 12, border: "1px solid #3b82f6" }}>
                        <Info size={48} style={{ color: "#3b82f6" }} />
                        <h2 style={{ color: "#f9fafb", marginTop: 16 }}>Not Enough Data</h2>
                        <p style={{ color: "#9ca3af", maxWidth: 500, margin: "8px auto 0" }}>
                            {overview.message || "Students need to complete both surveys and attend sessions before insights can be generated."}
                        </p>
                    </div>
                )}

                {/* Insufficient data state */}
                {!loading && !error && overview?.status === "insufficient_data" && (
                    <div style={{ textAlign: "center", padding: 80, background: "rgba(245,158,11,0.1)", borderRadius: 12, border: "1px solid #f59e0b" }}>
                        <AlertTriangle size={48} style={{ color: "#f59e0b" }} />
                        <h2 style={{ color: "#f9fafb", marginTop: 16 }}>Insufficient Data</h2>
                        <p style={{ color: "#9ca3af", maxWidth: 500, margin: "8px auto 0" }}>
                            {overview.message || "Need at least 5 students with both survey and attendance data."}
                        </p>
                    </div>
                )}

                {/* SUCCESS — Main Dashboard */}
                {!loading && !error && overview?.status === "success" && (
                    <>
                        {/* ─── Stat Cards (teacher-friendly) ──────────────── */}
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
                            {[
                                {
                                    label: "Overall Attendance",
                                    value: selectedModule === "all"
                                        ? `${overview.overall_attendance ?? 0}%`
                                        : `${moduleData?.average_attendance ?? overview.overall_attendance ?? 0}%`,
                                    sub: selectedModule === "all" ? "Across your modules" : selectedModule,
                                    icon: Percent,
                                    color: (overview.overall_attendance ?? 0) >= 80 ? "#10b981" : "#f59e0b",
                                },
                                {
                                    label: "Students at Risk",
                                    value: overview.at_risk_count ?? 0,
                                    sub: "Below 80% attendance",
                                    icon: TrendingDown,
                                    color: (overview.at_risk_count ?? 0) > 0 ? "#ef4444" : "#10b981",
                                },
                                {
                                    label: "Students Analyzed",
                                    value: selectedModule === "all" ? overview.students_analyzed : (moduleData?.students_in_module ?? overview.students_analyzed ?? "—"),
                                    sub: "With survey + attendance",
                                    icon: Users,
                                    color: "#8b5cf6",
                                },
                                {
                                    label: "Top Barrier",
                                    value: (selectedModule !== "all" && displayImportance?.[0])
                                        ? displayImportance[0].factor
                                        : overview.top_barrier_factor ? overview.top_barrier_factor.split(" ")[0] : "—",
                                    sub: (selectedModule !== "all" && displayImportance?.[0])
                                        ? `${displayImportance[0].name} (${selectedModule})`
                                        : overview.top_barrier_factor ?? "No barrier found",
                                    icon: Target,
                                    color: "#f59e0b",
                                },
                            ].map((card, i) => (
                                <div key={i} style={{
                                    background: "#1e293b", borderRadius: 12, padding: "20px 24px",
                                    border: "1px solid #374151", transition: "border-color 0.2s",
                                }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                                        <div>
                                            <p style={{ fontSize: 13, color: "#9ca3af", margin: 0, fontWeight: 500 }}>{card.label}</p>
                                            <p style={{ fontSize: 32, fontWeight: 700, color: "#f9fafb", margin: "4px 0" }}>{card.value}</p>
                                            <p style={{ fontSize: 12, color: "#6b7280", margin: 0 }}>{card.sub}</p>
                                        </div>
                                        <card.icon size={24} style={{ color: card.color, opacity: 0.7 }} />
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* ─── Module-Wise Attendance ───────────────────────── */}
                        {overview.module_attendance && overview.module_attendance.length > 0 && (
                            <div style={{ background: "#1e293b", borderRadius: 12, padding: 24, border: "1px solid #374151", marginBottom: 24 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
                                    <BookOpen size={18} style={{ color: "#8b5cf6" }} />
                                    <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "#f9fafb" }}>Module-Wise Attendance</h3>
                                </div>
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
                                    {overview.module_attendance.map((mod) => {
                                        const attColor = mod.average_attendance >= 80 ? "#10b981" : mod.average_attendance >= 70 ? "#f59e0b" : "#ef4444";
                                        const isSelected = selectedModule === mod.module_code;
                                        return (
                                            <div
                                                key={mod.module_code}
                                                onClick={() => handleModuleSelect(isSelected ? "all" : mod.module_code)}
                                                style={{
                                                    background: isSelected ? "#1e293b" : "#111827",
                                                    borderRadius: 10, padding: "16px 20px",
                                                    border: isSelected ? `2px solid ${attColor}` : "1px solid #374151",
                                                    transition: "all 0.2s",
                                                    cursor: "pointer",
                                                    boxShadow: isSelected ? `0 0 20px ${attColor}22` : "none",
                                                }}
                                            >
                                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                                                    <span style={{ fontSize: 15, fontWeight: 600, color: "#f9fafb" }}>{mod.module_code}</span>
                                                    <span style={{ fontSize: 22, fontWeight: 700, color: attColor }}>{mod.average_attendance}%</span>
                                                </div>
                                                <p style={{ fontSize: 12, color: "#6b7280", margin: "0 0 10px", lineHeight: 1.3 }}>{mod.module_name}</p>
                                                <div style={{ background: "#374151", borderRadius: 6, height: 8, overflow: "hidden", marginBottom: 10 }}>
                                                    <div style={{
                                                        width: `${Math.min(mod.average_attendance, 100)}%`,
                                                        height: "100%",
                                                        background: attColor,
                                                        borderRadius: 6,
                                                        transition: "width 0.6s ease-out",
                                                    }} />
                                                </div>
                                                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#9ca3af" }}>
                                                    <span>{mod.student_count} students</span>
                                                    {mod.at_risk_count > 0 && (
                                                        <span style={{ color: "#ef4444", fontWeight: 600 }}>{mod.at_risk_count} at risk</span>
                                                    )}
                                                </div>
                                                {isSelected && (
                                                    <div style={{ marginTop: 8, fontSize: 11, color: attColor, fontWeight: 600, textAlign: "center" }}>
                                                        ▼ Showing insights for this module
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* ─── Module Filter Pills ───────────────────────── */}
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 13, color: "#6b7280", fontWeight: 500 }}>Analyze:</span>
                            <button
                                onClick={() => handleModuleSelect("all")}
                                style={{
                                    padding: "6px 16px", borderRadius: 20, fontSize: 13, fontWeight: 600,
                                    border: selectedModule === "all" ? "2px solid #10b981" : "1px solid #374151",
                                    background: selectedModule === "all" ? "rgba(16,185,129,0.15)" : "#1e293b",
                                    color: selectedModule === "all" ? "#10b981" : "#9ca3af",
                                    cursor: "pointer", transition: "all 0.2s",
                                }}
                            >
                                All Modules
                            </button>
                            {availableModules.map(mod => (
                                <button
                                    key={mod}
                                    onClick={() => handleModuleSelect(mod)}
                                    style={{
                                        padding: "6px 16px", borderRadius: 20, fontSize: 13, fontWeight: 600,
                                        border: selectedModule === mod ? "2px solid #8b5cf6" : "1px solid #374151",
                                        background: selectedModule === mod ? "rgba(139,92,246,0.15)" : "#1e293b",
                                        color: selectedModule === mod ? "#8b5cf6" : "#9ca3af",
                                        cursor: "pointer", transition: "all 0.2s",
                                    }}
                                >
                                    {mod}
                                </button>
                            ))}
                        </div>

                        {/* Loading state for module insights */}
                        {moduleLoading && (
                            <div style={{ textAlign: "center", padding: 40, marginBottom: 24 }}>
                                <Activity size={32} style={{ color: "#8b5cf6", animation: "pulse 2s infinite" }} />
                                <p style={{ color: "#9ca3af", marginTop: 12, fontSize: 14 }}>Loading module insights for {selectedModule}...</p>
                            </div>
                        )}

                        {/* ─── Why Students Miss Classes + What You Can Do ──── */}
                        {!moduleLoading && (
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 24 }}>
                                {/* ─── Why Students Miss Classes ─────────────── */}
                                <div style={{ background: "#1e293b", borderRadius: 12, padding: 24, border: "1px solid #374151" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                                        <BarChart3 size={18} style={{ color: "#10b981" }} />
                                        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "#f9fafb" }}>
                                            {selectedModule === "all" ? "Why Students Miss Classes" : `Why Students Miss ${selectedModule}`}
                                        </h3>
                                    </div>
                                    {selectedModule !== "all" && (
                                        <p style={{ fontSize: 12, color: "#8b5cf6", margin: "0 0 10px", fontWeight: 500 }}>
                                            Module-specific factor analysis for {selectedModule}
                                        </p>
                                    )}


                                    {(displayImportance || []).map((fi) => (
                                        <div key={fi.factor} style={{ marginBottom: 16 }}>
                                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                                                <span style={{ fontSize: 13, fontWeight: 500, color: "#d1d5db" }}>
                                                    <span style={{ color: factorColors[fi.factor] || "#10b981", fontWeight: 700 }}>{fi.factor}</span>
                                                    {"  "}{fi.name}
                                                </span>
                                                <span style={{ fontSize: 13, fontWeight: 700, color: factorColors[fi.factor] || "#10b981" }}>
                                                    {fi.importance_pct}%
                                                </span>
                                            </div>
                                            <div style={{ background: "#374151", borderRadius: 6, height: 12, overflow: "hidden" }}>
                                                <div
                                                    style={{
                                                        width: `${Math.min(fi.importance_pct, 100)}%`,
                                                        height: "100%",
                                                        background: `linear-gradient(90deg, ${factorColors[fi.factor] || "#10b981"}, ${factorColors[fi.factor] || "#10b981"}cc)`,
                                                        borderRadius: 6,
                                                        transition: "width 0.8s ease-out",
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {/* ─── What You Can Do ────────────────────────── */}
                                <div style={{ background: "#1e293b", borderRadius: 12, padding: 24, border: "1px solid #374151" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                                        <Lightbulb size={18} style={{ color: "#f59e0b" }} />
                                        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "#f9fafb" }}>What You Can Do</h3>
                                    </div>
                                    <p style={{ fontSize: 13, color: "#6b7280", margin: "0 0 16px" }}>
                                        Actionable steps based on the top attendance barriers.
                                    </p>

                                    {(displayRecommendations || []).map((rec, i) => {
                                        const config = severityConfig[rec.severity] || severityConfig.info;
                                        const Icon = config.icon;
                                        return (
                                            <div
                                                key={i}
                                                style={{ position: "relative" }}
                                                onMouseEnter={(e) => {
                                                    const popup = e.currentTarget.querySelector('.rec-popup') as HTMLElement;
                                                    if (popup) { popup.style.display = "block"; }
                                                }}
                                                onMouseLeave={(e) => {
                                                    const popup = e.currentTarget.querySelector('.rec-popup') as HTMLElement;
                                                    if (popup) { popup.style.display = "none"; }
                                                }}
                                            >
                                                {/* Compact card — always visible */}
                                                <div style={{
                                                    background: config.bg,
                                                    border: `1px solid ${config.border}33`,
                                                    borderLeft: `4px solid ${config.border}`,
                                                    borderRadius: 10,
                                                    padding: "14px 18px",
                                                    marginBottom: 10,
                                                    cursor: "pointer",
                                                    transition: "all 0.2s",
                                                }}>
                                                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                                        <Icon size={18} style={{ color: config.border, flexShrink: 0 }} />
                                                        <span style={{ fontSize: 11, fontWeight: 700, color: config.border, letterSpacing: 0.5 }}>
                                                            {config.label}
                                                        </span>
                                                        {rec.importance_pct && (
                                                            <span style={{ fontSize: 11, color: "#6b7280", marginLeft: 4 }}>({rec.importance_pct}% impact)</span>
                                                        )}
                                                    </div>
                                                    <p style={{ fontSize: 15, fontWeight: 600, color: "#f9fafb", margin: "6px 0 0" }}>
                                                        {rec.title}
                                                    </p>
                                                    <p style={{ fontSize: 12, color: "#6b7280", margin: "4px 0 0" }}>Hover to see suggestions →</p>
                                                </div>

                                                {/* Big popup overlay */}
                                                <div
                                                    className="rec-popup"
                                                    style={{
                                                        display: "none",
                                                        position: "fixed",
                                                        top: "50%",
                                                        left: "50%",
                                                        transform: "translate(-50%, -50%)",
                                                        zIndex: 1000,
                                                        background: "#1e293b",
                                                        border: `2px solid ${config.border}`,
                                                        borderRadius: 16,
                                                        padding: "32px 36px",
                                                        maxWidth: 600,
                                                        width: "90vw",
                                                        boxShadow: `0 20px 60px rgba(0,0,0,0.6), 0 0 40px ${config.border}22`,
                                                    }}
                                                >
                                                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                                                        <Icon size={24} style={{ color: config.border }} />
                                                        <span style={{ fontSize: 13, fontWeight: 700, color: config.border, letterSpacing: 0.5 }}>
                                                            {config.label}
                                                        </span>
                                                        {rec.importance_pct && (
                                                            <span style={{ fontSize: 13, color: "#9ca3af" }}>— {rec.importance_pct}% impact</span>
                                                        )}
                                                    </div>
                                                    <h3 style={{ fontSize: 20, fontWeight: 700, color: "#f9fafb", margin: "0 0 10px" }}>{rec.title}</h3>
                                                    {rec.description && (
                                                        <p style={{ fontSize: 15, color: "#9ca3af", margin: "0 0 16px", lineHeight: 1.6 }}>{rec.description}</p>
                                                    )}
                                                    <ul style={{ margin: 0, paddingLeft: 20 }}>
                                                        {rec.actions.map((action, j) => (
                                                            <li key={j} style={{
                                                                fontSize: 16,
                                                                color: "#e5e7eb",
                                                                marginBottom: 10,
                                                                lineHeight: 1.6,
                                                            }}>{action}</li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            </div>
                                        );
                                    })}

                                    {(!displayRecommendations || displayRecommendations.length === 0) && (
                                        <p style={{ color: "#6b7280", fontSize: 14, textAlign: "center", padding: 20 }}>
                                            No recommendations available yet.
                                        </p>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* ─── Last Analyzed ──────────────────────────────────── */}
                        {overview?.last_trained_at && (
                            <div style={{ textAlign: "center", padding: "16px 0", color: "#6b7280", fontSize: 13 }}>
                                Last analyzed: {new Date(overview.last_trained_at).toLocaleString()}
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* ─── Global Styles ──────────────────────────────────── */}
            <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
        </div>
    );
}
