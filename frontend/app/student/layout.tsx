"use client";

import React from "react";
import RoleGuard from "@/components/RoleGuard";
import { UserRole } from "@/context/AuthContext";
import StudentHeader from "@/components/student/StudentHeader";
import { QuizProvider } from "@/context/QuizContext";
import QuizModals from "@/components/student/QuizModals";

export default function StudentLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <RoleGuard allowedRoles={[UserRole.STUDENT, UserRole.ADMIN]}>
            <QuizProvider>
                <div className="min-h-screen bg-gray-900 text-white">
                    <StudentHeader />
                    <QuizModals />
                    {children}
                </div>
            </QuizProvider>
        </RoleGuard>
    );
}
