"use client";

import React from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import {
    BarChart3,
    BrainCircuit,
    UserCheck,
    GraduationCap,
    LayoutDashboard,
    Users,
} from 'lucide-react';

export default function Sidebar() {
    const router = useRouter();
    const pathname = usePathname();
    const { user } = useAuth();

    const tabs = [
        { id: 'engagement', label: 'Student Engagement', icon: BrainCircuit, path: '/teacher/engagement' },
        { id: 'performance', label: 'Teacher Performance', icon: BarChart3, path: '/teacher/teacher_behavior' },
        { id: 'attendance', label: 'Student Attendance', icon: UserCheck, path: '/teacher/attendance' },
        { id: 'student-perf', label: 'Student Performance', icon: GraduationCap, path: '/teacher/performance' },
    ];

    const displayName = user?.teacher_profile?.full_name || user?.username || "Instructor";

    return (
        <div className="w-64 bg-gray-800 border-r border-gray-700 flex flex-col h-screen sticky top-0">
            <div className="p-6 border-b border-gray-700">
                <h1 className="text-xl font-bold flex items-center gap-2 text-white">
                    <LayoutDashboard className="text-blue-500" />
                    ClassMaster
                </h1>
                <p className="text-xs text-gray-500 mt-1">Teacher Dashboard</p>
            </div>

            <nav className="flex-1 p-4 space-y-2">
                {tabs.map((tab) => {
                    const Icon = tab.icon;
                    // Check if current path starts with the tab path (for potential sub-routes)
                    // or exact match
                    const isActive = pathname === tab.path || pathname.startsWith(`${tab.path}/`);

                    return (
                        <button
                            key={tab.id}
                            onClick={() => router.push(tab.path)}
                            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${isActive
                                ? "bg-blue-600 text-white"
                                : "text-gray-400 hover:bg-gray-700 hover:text-white"
                                }`}
                        >
                            <Icon size={20} />
                            <span className="text-sm font-medium">{tab.label}</span>
                        </button>
                    );
                })}
            </nav>

            <div className="p-4 border-t border-gray-700">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400 overflow-hidden">
                        {user?.id ? (
                            <img
                                src={`http://localhost:8000/api/auth/users/${user.id}/profile-picture`}
                                alt={displayName}
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                    e.currentTarget.style.display = 'none';
                                }}
                            />
                        ) : null}
                        <Users size={16} />
                    </div>
                    <div>
                        <p className="text-sm font-medium text-white truncate max-w-[150px]">{displayName}</p>
                        <p className="text-xs text-gray-500 capitalize">{user?.role || "Instructor"}</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
