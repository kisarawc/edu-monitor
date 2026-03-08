"use client";

import { useAuth } from "@/context/AuthContext";
import { GraduationCap, UserCheck, Brain, FileText } from "lucide-react";
import Link from "next/link";
import UserProfileMenu from "../UserProfileMenu";
import { useEffect, useState } from "react";
import { useQuiz } from "@/context/QuizContext";

export default function StudentHeader() {
    const { user } = useAuth();
    const { triggerQuiz, quizNotification } = useQuiz();
    const [contentCount, setContentCount] = useState<number | null>(null);

    useEffect(() => {
        fetchStats();
    }, []);

    const fetchStats = async () => {
        try {
            const response = await fetch("http://localhost:8000/api/performance/stats");
            if (response.ok) {
                const data = await response.json();
                setContentCount(data.data?.document_count ?? 0);
            }
        } catch (error) {
            console.error('Failed to fetch stats:', error);
        }
    };

    return (
        <nav className="bg-gray-800 border-b border-gray-700 px-8 py-4 flex justify-between items-center sticky top-0 z-40 shadow-sm">
            <div className="flex items-center gap-3">
                <Link href="/student/dashboard" className="flex items-center gap-3 hover:opacity-90 transition-opacity">
                    <div className="bg-gradient-to-r from-emerald-500 to-teal-500 p-2.5 rounded-xl text-white">
                        <GraduationCap size={22} />
                    </div>
                    <div>
                        <h1 className="font-bold text-lg text-white">Student Portal</h1>
                        <p className="text-xs text-gray-400">AI-Powered Learning</p>
                    </div>
                </Link>
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
                    onClick={() => triggerQuiz()}
                    className="relative flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium"
                >
                    <Brain size={16} />
                    <span className="hidden sm:inline">Demo Quiz</span>
                    {quizNotification && (
                        <span className="absolute -top-1 -right-1 flex h-4 w-4">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-4 w-4 bg-red-500 text-[10px] items-center justify-center font-bold">!</span>
                        </span>
                    )}
                </button>

                <div className="hidden md:flex items-center gap-2 bg-gray-700/50 px-3 py-1.5 rounded-lg border border-gray-600/50">
                    <FileText size={14} className="text-emerald-400" />
                    <span className="text-sm text-gray-300">{contentCount ?? 0} content chunks</span>
                </div>

                <UserProfileMenu />
            </div>
        </nav>
    );
}
