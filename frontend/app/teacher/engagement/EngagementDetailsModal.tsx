"use client";
import React, { useEffect, useState } from 'react';
import { X, Clock } from 'lucide-react';
import {
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    AreaChart,
    Area
} from 'recharts';

interface EngagementDetailsModalProps {
    isOpen: boolean;
    onClose: () => void;
    dataKeys?: { // Optional keys to plot specific group data
        engaged: string;
        total: string;
        context?: string;
        decisiveTotal?: string;
        label: string;
    };
}

interface DataPoint {
    timestamp: number;
    engaged: number;
    total: number;
    // Dynamic keys for groups
    [key: string]: number;
}

export default function EngagementDetailsModal({ isOpen, onClose, dataKeys }: EngagementDetailsModalProps) {
    const [history, setHistory] = useState<DataPoint[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!isOpen) return;

        // Fetch immediately then poll
        const fetchData = () => {
            fetch('http://localhost:8000/stats/history', { cache: 'no-store' })
                .then(res => res.json())
                .then(data => {
                    setHistory(data);
                    setLoading(false);
                })
                .catch(err => console.error("History fetch error:", err));
        };

        fetchData();
        const interval = setInterval(fetchData, 2000); // Poll every 2s

        return () => clearInterval(interval);
    }, [isOpen]);

    if (!isOpen) return null;

    const keyEngaged = dataKeys?.engaged || 'engaged';
    const keyTotal = dataKeys?.total || 'total';
    const keyContext = dataKeys?.context || 'context_dependent';
    const keyDecisiveTotal = dataKeys?.decisiveTotal || 'decisive_total';
    const chartLabel = dataKeys?.label || 'Total Behavior';

    // Process data for graph
    const chartData = history.map(point => ({
        time: new Date(point.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        listening: point.listening || 0,
        working: point.working || 0,
        raised: point.hand_raised || 0,
        sleeping: point.sleeping || 0,
        away: point.away || 0,
        context: point[keyContext] || 0,
        decisiveTotal: point[keyDecisiveTotal] ?? Math.max((point[keyTotal] || 0) - (point[keyContext] || 0), 0),
        percentage: (point[keyDecisiveTotal] ?? Math.max((point[keyTotal] || 0) - (point[keyContext] || 0), 0)) > 0
            ? Math.round((point[keyEngaged] / (point[keyDecisiveTotal] ?? Math.max((point[keyTotal] || 0) - (point[keyContext] || 0), 0))) * 100)
            : 0,
        total: point[keyTotal]
    }));
    const hasContextCases = chartData.some(point => point.context > 0);

    // ... (keep header/stats)

    // Replace the chart render section
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <div className="bg-gray-800 border border-gray-700 w-full max-w-4xl rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-gray-700 bg-gray-900/50">
                    <div>
                        <h2 className="text-xl font-bold text-white flex items-center gap-2">
                            <Clock className="text-blue-400" />
                            Detailed Behavior History
                        </h2>
                        <p className="text-sm text-gray-400 mt-1">Real-time analysis of {chartLabel}</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-700 rounded-lg text-gray-400 hover:text-white transition-colors"
                    >
                        <X size={24} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 space-y-6">
                    {/* Stats Summary */}
                    <div className={`grid gap-4 ${hasContextCases ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-3'}`}>
                        <div className="bg-gray-700/30 p-4 rounded-xl border border-gray-600/50">
                            <div className="text-gray-400 text-sm mb-1">Current On-Task</div>
                            <div className="text-2xl font-bold text-white">
                                {chartData.length > 0 ? chartData[chartData.length - 1].percentage : 0}%
                            </div>
                        </div>
                        <div className="bg-gray-700/30 p-4 rounded-xl border border-gray-600/50">
                            <div className="text-gray-400 text-sm mb-1">Peak On-Task</div>
                            <div className="text-2xl font-bold text-emerald-400">
                                {chartData.length > 0 ? Math.max(...chartData.map(d => d.percentage)) : 0}%
                            </div>
                        </div>
                        {hasContextCases && (
                            <div className="bg-amber-500/10 p-4 rounded-xl border border-amber-500/20">
                                <div className="text-amber-200 text-sm mb-1">Context-Dependent</div>
                                <div className="text-2xl font-bold text-amber-300">
                                    {chartData.length > 0 ? chartData[chartData.length - 1].context : 0}
                                </div>
                            </div>
                        )}
                        <div className="bg-gray-700/30 p-4 rounded-xl border border-gray-600/50">
                            <div className="text-gray-400 text-sm mb-1">Active Students</div>
                            <div className="text-2xl font-bold text-blue-400">{chartData.length > 0 ? chartData[chartData.length - 1].total : 0}</div>
                        </div>
                    </div>

                    {/* Chart */}
                    <div className="h-[400px] w-full bg-gray-900 rounded-2xl p-6 border border-gray-700 shadow-inner">
                        {loading ? (
                            <div className="h-full flex items-center justify-center text-gray-500 font-medium animate-pulse">
                                Analyzing history data...
                            </div>
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={chartData}>
                                    <defs>
                                        <linearGradient id="modalEngLine" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4} />
                                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} strokeOpacity={0.5} />
                                    <XAxis dataKey="time" stroke="#9CA3AF" fontSize={10} tickLine={false} axisLine={false} />
                                    <YAxis stroke="#9CA3AF" fontSize={10} tickLine={false} axisLine={false} domain={[0, 100]} />
                                    <Tooltip
                                        content={({ active, payload, label }) => {
                                            if (active && payload && payload.length) {
                                                return (
                                                    <div className="bg-gray-950 border border-white/10 p-4 rounded-2xl shadow-2xl backdrop-blur-xl">
                                                        <p className="text-xs font-black text-gray-500 mb-3 uppercase tracking-widest">{label}</p>
                                                        <div className="space-y-2">
                                                            <div className="flex items-center justify-between gap-12">
                                                                <div className="flex items-center gap-2">
                                                                    <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                                                                    <span className="text-[10px] font-bold text-white uppercase">Engagement</span>
                                                                </div>
                                                                <span className="text-sm font-mono font-bold text-white">{payload[0].value}%</span>
                                                            </div>
                                                        </div>
                                                        <div className="mt-3 pt-3 border-t border-white/5 flex justify-between items-center">
                                                            <span className="text-[10px] font-bold text-gray-500 uppercase">Decisive</span>
                                                            <span className="text-xs font-mono text-blue-400 font-bold">{payload[0].payload.decisiveTotal} students</span>
                                                        </div>
                                                        {payload[0].payload.context > 0 && (
                                                            <div className="mt-2 flex justify-between items-center">
                                                                <span className="text-[10px] font-bold text-amber-400 uppercase">Context</span>
                                                                <span className="text-xs font-mono text-amber-300 font-bold">{payload[0].payload.context} students</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            }
                                            return null;
                                        }}
                                    />
                                    <Area
                                        type="monotone"
                                        dataKey="percentage"
                                        stroke="#3b82f6"
                                        strokeWidth={4}
                                        fill="url(#modalEngLine)"
                                        name="Engagement"
                                        animationDuration={500}
                                    />
                                </AreaChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                    <div className="flex items-center gap-4 text-[10px] font-black uppercase text-gray-400 justify-center">
                        <div className="flex items-center gap-2">
                            <div className="w-2.5 h-2.5 rounded-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]"></div>
                            Decisive On-Task (%)
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );


}
