"use client";

import { useAuth, UserRole } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CheckCircle, XCircle, User, ShieldCheck, Brain } from "lucide-react";
import RoleGuard from "@/components/RoleGuard";
import Link from "next/link";

interface PendingUser {
    id: number;
    username: string;
    email: string;
    role: string;
    is_approved: boolean;
    student_profile?: {
        full_name: string;
        student_id: string;
    };
    teacher_profile?: {
        full_name: string;
        teacher_id: string;
        department: string;
    };
}

export default function AdminDashboard() {
    const { user, isLoading, token } = useAuth();
    const router = useRouter();
    const [pendingUsers, setPendingUsers] = useState<PendingUser[]>([]);
    const [loadingUsers, setLoadingUsers] = useState(false);

    useEffect(() => {
        if (!isLoading) {
            if (!user || user.role !== UserRole.ADMIN) {
                router.push("/login");
            } else {
                fetchPendingUsers();
            }
        }
    }, [user, isLoading, router]);

    const fetchPendingUsers = async () => {
        if (!token) return;
        setLoadingUsers(true);
        try {
            const res = await fetch("http://localhost:8000/api/auth/admin/pending-users", {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) {
                const data = await res.json();
                setPendingUsers(data);
            }
        } catch (error) {
            console.error("Failed to fetch pending users", error);
        } finally {
            setLoadingUsers(false);
        }
    };

    const approveUser = async (userId: number) => {
        if (!token) return;
        try {
            const res = await fetch(`http://localhost:8000/api/auth/admin/approve/${userId}`, {
                method: "POST",
                headers: { Authorization: `Bearer ${token}` },
            });

            if (res.ok) {
                // Remove from local list
                setPendingUsers(prev => prev.filter(u => u.id !== userId));
                alert("User approved successfully!");
            } else {
                alert("Failed to approve user.");
            }
        } catch (error) {
            console.error("Error approving user", error);
        }
    };

    if (isLoading || !user || user.role !== UserRole.ADMIN) {
        return <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">Loading...</div>;
    }

    return (
        <RoleGuard allowedRoles={[UserRole.ADMIN]}>
            <div className="min-h-screen bg-slate-900 text-white p-8">
                <div className="max-w-6xl mx-auto">
                    <div className="flex items-center gap-4 mb-8">
                        <div className="bg-blue-600 p-3 rounded-xl">
                            <ShieldCheck className="w-8 h-8" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-bold">Admin Dashboard</h1>
                            <p className="text-slate-400">Welcome back, {user.username}</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        {/* --- Pending Approvals Section --- */}
                        <div className="lg:col-span-2 bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden">
                            <div className="p-6 border-b border-slate-700 flex justify-between items-center">
                                <h2 className="text-xl font-semibold flex items-center gap-2">
                                    <User className="w-5 h-5 text-yellow-500" />
                                    Pending Approvals
                                </h2>
                                <span className="bg-slate-700 text-xs font-bold px-2 py-1 rounded-full text-slate-300">
                                    {pendingUsers.length}
                                </span>
                            </div>

                            <div className="p-6">
                                {loadingUsers ? (
                                    <p className="text-center text-slate-500 py-4">Loading requests...</p>
                                ) : pendingUsers.length === 0 ? (
                                    <p className="text-center text-slate-500 py-8">No pending registrations.</p>
                                ) : (
                                    <div className="space-y-4">
                                        {pendingUsers.map((pUser) => (
                                            <div key={pUser.id} className="bg-slate-900/50 p-4 rounded-xl border border-slate-700/50 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 transition hover:border-slate-600">
                                                <div className="flex items-start gap-4">
                                                    {/* Profile Picture Thumbnail */}
                                                    <div className="w-12 h-12 rounded-full overflow-hidden bg-slate-700 flex-shrink-0">
                                                        <img
                                                            src={`http://localhost:8000/api/auth/users/${pUser.id}/profile-picture`}
                                                            alt={pUser.username}
                                                            className="w-full h-full object-cover"
                                                            onError={(e) => { (e.target as HTMLImageElement).src = 'https://via.placeholder.com/150?text=No+Img'; }}
                                                        />
                                                    </div>
                                                    <div>
                                                        <div className="font-semibold text-lg flex items-center gap-2">
                                                            {pUser.username}
                                                            <span className="text-xs font-normal text-slate-500">
                                                                {(pUser.student_profile?.full_name || pUser.teacher_profile?.full_name) ? `(${pUser.student_profile?.full_name || pUser.teacher_profile?.full_name})` : ''}
                                                            </span>
                                                        </div>
                                                        <div className="text-sm text-slate-400">{pUser.email}</div>

                                                        {/* Role Badge */}
                                                        <div className="mt-1 flex items-center gap-2">
                                                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${pUser.role === 'student' ? 'bg-blue-900/30 text-blue-400 border-blue-800' : 'bg-emerald-900/30 text-emerald-400 border-emerald-800'
                                                                } capitalize`}>
                                                                {pUser.role}
                                                            </span>
                                                            {/* Extra Info based on role */}
                                                            {pUser.role === 'student' && pUser.student_profile && (
                                                                <span className="text-xs text-slate-500">ID: {pUser.student_profile.student_id}</span>
                                                            )}
                                                            {pUser.role === 'teacher' && pUser.teacher_profile && (
                                                                <span className="text-xs text-slate-500">Dept: {pUser.teacher_profile.department}</span>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="flex items-center gap-2 w-full sm:w-auto self-end sm:self-center">
                                                    <button
                                                        onClick={() => approveUser(pUser.id)}
                                                        className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition"
                                                    >
                                                        <CheckCircle className="w-4 h-4" />
                                                        Approve
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* --- Quick Stats or Links (Placeholder) --- */}
                        <div className="space-y-6">
                            <div className="bg-slate-800 rounded-2xl border border-slate-700 p-6">
                                <h3 className="text-lg font-semibold mb-4">Quick Stats</h3>
                                <div className="space-y-4">
                                    <div className="flex justify-between items-center bg-slate-900/50 p-3 rounded-lg">
                                        <span className="text-slate-400 text-sm">Total Users</span>
                                        <span className="font-mono font-bold">--</span>
                                    </div>
                                    <div className="flex justify-between items-center bg-slate-900/50 p-3 rounded-lg">
                                        <span className="text-slate-400 text-sm">Active Classes</span>
                                        <span className="font-mono font-bold">--</span>
                                    </div>
                                </div>
                            </div>
                            <Link href="/admin/dashboard/evaluation" className="block bg-gradient-to-r from-purple-600/20 to-blue-600/20 border border-purple-500/30 rounded-2xl p-6 hover:border-purple-500/50 transition-colors group">
                                <div className="flex items-center gap-3 mb-3">
                                    <div className="p-2.5 bg-gradient-to-r from-purple-500 to-blue-500 rounded-xl">
                                        <Brain className="w-5 h-5 text-white" />
                                    </div>
                                    <h3 className="text-lg font-semibold group-hover:text-purple-300 transition-colors">LLM Evaluation</h3>
                                </div>
                                <p className="text-sm text-slate-400">View Human-in-the-Loop evaluation metrics, user feedback analytics, and AI system performance data.</p>
                            </Link>
                        </div>
                    </div>
                </div>
            </div>
        </RoleGuard>
    );
}
