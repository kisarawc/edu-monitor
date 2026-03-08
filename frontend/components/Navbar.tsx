"use client";

import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { LogOut, Home, User } from "lucide-react";
import { usePathname } from "next/navigation";

export default function Navbar() {
    const { user, logout, isAuthenticated } = useAuth();
    const pathname = usePathname();

    if (pathname === "/login" || pathname.startsWith("/register") || pathname.startsWith("/student") || pathname.startsWith("/teacher")) {
        return null;
    }

    return (
        <nav className="bg-slate-900 border-b border-slate-800 p-4 sticky top-0 z-50">
            <div className="max-w-7xl mx-auto flex justify-between items-center">
                <Link href="/" className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-emerald-400">
                    EduMonitor
                </Link>

                <div className="flex items-center gap-6">
                    {isAuthenticated && user ? (
                        <>
                            <div className="flex items-center gap-2 text-slate-300">
                                <div className="bg-slate-800 p-1.5 rounded-full">
                                    <User className="w-4 h-4" />
                                </div>
                                <span className="text-sm font-medium hidden sm:block">{user.username}</span>
                                <span className="text-xs px-2 py-0.5 rounded bg-slate-800 border border-slate-700 capitalize">
                                    {user.role}
                                </span>
                            </div>

                            <button
                                onClick={logout}
                                className="flex items-center gap-2 text-red-400 hover:text-red-300 hover:bg-red-400/10 px-3 py-1.5 rounded-lg transition-all text-sm font-medium"
                            >
                                <LogOut className="w-4 h-4" />
                                Logout
                            </button>
                        </>
                    ) : (
                        <Link href="/login" className="text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg transition">
                            Sign In
                        </Link>
                    )}
                </div>
            </div>
        </nav>
    );
}
