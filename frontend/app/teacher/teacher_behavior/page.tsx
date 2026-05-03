'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Activity, Move, Compass } from 'lucide-react';

type Stats = { behavior: string; mobility: number; orientation: number; hand_speed?: number; camera_source?: string; boundary_y?: number | null; fine_label?: string };
type Sample = { ts: number; behavior: string; mobility: number; orientation: number; hand_speed?: number; camera_source?: string };
export default function TeacherBehaviorPage() {
    const [stats, setStats] = useState<Stats>({ behavior: 'Initializing...', mobility: 0, orientation: 0 });

    // Session recording state
    const [isRecording, setIsRecording] = useState(false);
    const [sessionStart, setSessionStart] = useState<number | null>(null);
    const [sessionEnd, setSessionEnd] = useState<number | null>(null);
    const [sessionBuffer, setSessionBuffer] = useState<Sample[]>([]);
    const [summary, setSummary] = useState<string | null>(null);


    const LIVE_WINDOW_SEC = 180; // 3 minutes

    useEffect(() => {
        const interval = setInterval(() => {
            fetch('http://localhost:8000/api/teacher_stats')
                .then(res => res.json())
                .then((data: Stats) => {
                    setStats(data);
                    if (isRecording && sessionStart) {
                        const sample: Sample = {
                            ts: Date.now(),
                            behavior: data.behavior,
                            mobility: data.mobility,
                            orientation: data.orientation,
                            hand_speed: (data as any).hand_speed ?? 0,
                        };
                        setSessionBuffer(prev => [...prev, sample]);
                    }
                })
                .catch(err => console.error(err));
        }, 500);
        return () => clearInterval(interval);
    }, [isRecording, sessionStart]);

    // Clear backend registration lock on page refresh or close
    useEffect(() => {
        const handleUnload = () => {
            // sendBeacon is reliable during page unload
            navigator.sendBeacon('http://localhost:8000/teacher_behavior/reset_registration');
        };
        window.addEventListener('beforeunload', handleUnload);
        return () => window.removeEventListener('beforeunload', handleUnload);
    }, []);


    const getBehaviorColor = (b: string) => {
        if (b === 'INTERACTIVE') return 'text-emerald-400';
        if (b === 'LECTURING') return 'text-blue-400';
        if (b === 'NOT DETECTED') return 'text-gray-500';
        return 'text-orange-400';
    };

    const behaviorBg = (b: string) => {
        if (b === 'INTERACTIVE') return 'bg-emerald-400';
        if (b === 'LECTURING') return 'bg-blue-400';
        if (b === 'NOT DETECTED') return 'bg-gray-600';
        return 'bg-orange-400';
    };

    // Derived live window
    const liveWindow = useMemo(() => {
        const cutoff = Date.now() - LIVE_WINDOW_SEC * 1000;
        return sessionBuffer.filter(s => s.ts >= cutoff);
    }, [sessionBuffer]);

    // Distribution over session (or live if no session data)
    const distribution = useMemo(() => {
        const source = sessionBuffer.length ? sessionBuffer : liveWindow;
        const counts: Record<string, number> = { PASSIVE: 0, LECTURING: 0, INTERACTIVE: 0, NOT_DETECTED: 0 };
        source.forEach(s => {
            if (s.behavior === 'INTERACTIVE') counts['INTERACTIVE'] += 1;
            else if (s.behavior === 'LECTURING') counts['LECTURING'] += 1;
            else if (s.behavior === 'PASSIVE') counts['PASSIVE'] += 1;
            else counts['NOT_DETECTED'] += 1;
        });
        const total_detected = (source.length - counts['NOT_DETECTED']) || 1;
        return {
            passive: Math.round((counts['PASSIVE'] / total_detected) * 100),
            lecturing: Math.round((counts['LECTURING'] / total_detected) * 100),
            interactive: Math.round((counts['INTERACTIVE'] / total_detected) * 100),
            counts,
        };
    }, [sessionBuffer, liveWindow]);

    const DistributionCard = ({ passive, lecturing, interactive }: { passive: number; lecturing: number; interactive: number }) => (
        <div className="bg-gray-800 p-4 rounded-xl border border-gray-700">
            <h3 className="text-gray-400 text-sm font-medium mb-3">Behavior Distribution</h3>
            <div className="mb-3">
                <div className="text-sm text-gray-300">Passive <span className="text-gray-500">{passive}%</span></div>
                <div className="w-full bg-gray-700 rounded h-3 mt-1 overflow-hidden"><div className={`h-3 ${passive > 0 ? 'bg-orange-400' : 'bg-transparent'}`} style={{ width: `${passive}%` }} /></div>
            </div>
            <div className="mb-3">
                <div className="text-sm text-gray-300">Lecturing <span className="text-gray-500">{lecturing}%</span></div>
                <div className="w-full bg-gray-700 rounded h-3 mt-1 overflow-hidden"><div className={`h-3 ${lecturing > 0 ? 'bg-blue-400' : 'bg-transparent'}`} style={{ width: `${lecturing}%` }} /></div>
            </div>
            <div>
                <div className="text-sm text-gray-300">Interactive <span className="text-gray-500">{interactive}%</span></div>
                <div className="w-full bg-gray-700 rounded h-3 mt-1 overflow-hidden"><div className={`h-3 ${interactive > 0 ? 'bg-emerald-400' : 'bg-transparent'}`} style={{ width: `${interactive}%` }} /></div>
            </div>
        </div>
    );

    const TimelineStrip = ({ samples }: { samples: Sample[] }) => {
        const counts: Record<string, number> = { PASSIVE: 0, LECTURING: 0, INTERACTIVE: 0, NOT_DETECTED: 0 };
        samples.forEach(s => {
            if (s.behavior === 'INTERACTIVE') counts['INTERACTIVE'] += 1;
            else if (s.behavior === 'LECTURING') counts['LECTURING'] += 1;
            else if (s.behavior === 'PASSIVE') counts['PASSIVE'] += 1;
            else counts['NOT_DETECTED'] += 1;
        });
        const total = samples.length || 1;
        return (
            <div className="bg-gray-800 p-4 rounded-xl border border-gray-700">
                <h3 className="text-gray-400 text-sm mb-2">Recent Behavior (last {LIVE_WINDOW_SEC}s)</h3>
                <div className="flex items-center gap-2 mb-3">
                    <div className="flex-1 h-4 bg-gray-700 rounded overflow-hidden flex items-center">
                        {samples.map((s, i) => (
                            <div key={s.ts + '-' + i} className={`inline-block h-4`} style={{ width: 6, background: undefined }}>
                                <div className={`${behaviorBg(s.behavior)} h-4 w-full`} />
                            </div>
                        ))}
                    </div>
                </div>
                <div className="text-xs text-gray-400">Counts: Passive {counts['PASSIVE']}, Lecturing {counts['LECTURING']}, Interactive {counts['INTERACTIVE']}</div>
            </div>
        );
    };

    const [sessionSnapshot, setSessionSnapshot] = useState<Sample[] | null>(null);
    const [summaryMetrics, setSummaryMetrics] = useState<any | null>(null);

    const downloadCSV = () => {
        if (!sessionSnapshot) return;
        const header = ['timestamp_iso', 'behavior', 'mobility', 'orientation', 'hand_speed'];
        const rows = sessionSnapshot.map(s => [new Date(s.ts).toISOString(), s.behavior, String(s.mobility), String(s.orientation), String(s.hand_speed ?? '')]);
        const csv = [header.join(','), ...rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `session_${new Date((sessionSnapshot[0]?.ts) || Date.now()).toISOString().replace(/[:.]/g, '-')}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const downloadSummaryTxt = () => {
        if (!summaryMetrics) return;
        const lines = [] as string[];
        lines.push(`Session start: ${summaryMetrics.startISO}`);
        lines.push(`Session end: ${summaryMetrics.endISO}`);
        lines.push(`Duration: ${summaryMetrics.durationSec}s`);
        lines.push(`Distribution: Passive ${summaryMetrics.distribution.passive}%, Lecturing ${summaryMetrics.distribution.lecturing}%, Interactive ${summaryMetrics.distribution.interactive}%`);
        lines.push(`Dominant behavior: ${summaryMetrics.dominant}`);
        lines.push(`Avg mobility: ${summaryMetrics.avgMobility.toFixed(2)}`);
        lines.push(`Avg orientation: ${summaryMetrics.avgOrientation.toFixed(2)}`);
        lines.push(`Avg hand speed: ${summaryMetrics.avgHandSpeed.toFixed(2)}`);
        lines.push(`Interactive segments: ${summaryMetrics.interactiveSegments}`);
        lines.push('\nNotes: Model inference every 0.5s; smoothing window = none');
        const txt = lines.join('\n');
        const blob = new Blob([txt], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `session_summary_${summaryMetrics.startISO.replace(/[:.]/g, '-')}.txt`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const downloadSummaryJSON = () => {
        if (!summaryMetrics) return;
        const blob = new Blob([JSON.stringify(summaryMetrics, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `session_summary_${summaryMetrics.startISO.replace(/[:.]/g, '-')}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const startSession = () => {
        setSessionBuffer([]);
        setSessionStart(Date.now());
        setSessionEnd(null);
        setSummary(null);
        setSessionSnapshot(null);
        setSummaryMetrics(null);
        setIsRecording(true);
    };

    const endSession = () => {
        setIsRecording(false);
        const endTs = Date.now();
        setSessionEnd(endTs);

        // Freeze snapshot
        const snapshot = [...sessionBuffer];
        setSessionSnapshot(snapshot);

        // Generate summary metrics
        const durationMs = (endTs - (sessionStart ?? endTs));
        const durationSec = Math.round(durationMs / 1000);

        const counts: Record<string, number> = { PASSIVE: 0, LECTURING: 0, INTERACTIVE: 0, NOT_DETECTED: 0 };
        snapshot.forEach(s => {
            if (s.behavior === 'INTERACTIVE') counts['INTERACTIVE'] += 1;
            else if (s.behavior === 'LECTURING') counts['LECTURING'] += 1;
            else if (s.behavior === 'PASSIVE') counts['PASSIVE'] += 1;
            else counts['NOT_DETECTED'] += 1;
        });
        const total_detected = (snapshot.length - counts['NOT_DETECTED']) || 1;
        const distributionPct = {
            passive: Math.round((counts['PASSIVE'] / total_detected) * 100),
            lecturing: Math.round((counts['LECTURING'] / total_detected) * 100),
            interactive: Math.round((counts['INTERACTIVE'] / total_detected) * 100),
        };
        const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Unknown';

        let interactiveSegments = 0;
        let prev = null as string | null;
        for (const s of snapshot) {
            if (s.behavior === 'INTERACTIVE' && prev !== 'INTERACTIVE') interactiveSegments += 1;
            prev = s.behavior;
        }

        const avgMobility = snapshot.reduce((a, b) => a + b.mobility, 0) / total_detected;
        const avgOrientation = snapshot.reduce((a, b) => a + b.orientation, 0) / total_detected;
        const avgHandSpeed = snapshot.reduce((a, b) => a + (b.hand_speed ?? 0), 0) / total_detected;

        const metrics = {
            startISO: new Date(sessionStart ?? endTs).toISOString(),
            endISO: new Date(endTs).toISOString(),
            durationSec,
            distribution: distributionPct,
            counts,
            dominant,
            avgMobility,
            avgOrientation,
            avgHandSpeed,
            interactiveSegments,
            note: 'Model inference every 0.5s; smoothing window = none',
        };
        setSummaryMetrics(metrics);

        const summaryText = `Session start: ${metrics.startISO}\nSession end: ${metrics.endISO}\nDuration: ${Math.floor(durationSec / 60)}m ${durationSec % 60}s\nDistribution: Passive ${distributionPct.passive}%, Lecturing ${distributionPct.lecturing}%, Interactive ${distributionPct.interactive}%\nDominant behavior: ${metrics.dominant}\nAvg mobility: ${metrics.avgMobility.toFixed(2)}\nAvg orientation: ${metrics.avgOrientation.toFixed(2)}\nAvg hand speed: ${metrics.avgHandSpeed.toFixed(2)}\nInteractive segments: ${metrics.interactiveSegments}\n\nNotes: ${metrics.note}`;
        setSummary(summaryText);
    };

    const resetSession = () => {
        setIsRecording(false);
        setSessionBuffer([]);
        setSessionStart(null);
        setSessionEnd(null);
        setSummary(null);
        setSessionSnapshot(null);
        setSummaryMetrics(null);

        // Also wipe backend lock so a new teacher can register
        fetch('http://localhost:8000/teacher_behavior/reset_registration', { method: 'POST' })
            .catch(err => console.error("Failed to reset backend registration", err));
    };


    const formatDuration = (start: number | null, end: number | null) => {
        if (!start) return '0s';
        const now = end ?? Date.now();
        const s = Math.round((now - start) / 1000);
        return `${Math.floor(s / 60)}m ${s % 60}s`;
    };

    return (
        <div className="h-screen bg-gray-900 text-white flex flex-col">
            <header className="flex items-center justify-between py-2 px-4 h-12 border-b border-gray-800">
                <h1 className="text-xl font-bold">Teacher Behavior Analysis</h1>
                <div className="flex items-center gap-2">
                    <button className={`px-2 py-1 text-sm rounded ${isRecording ? 'bg-gray-700 text-gray-300' : 'bg-emerald-500 hover:bg-emerald-600'}`} onClick={startSession} disabled={isRecording}>Start</button>
                    <button className={`px-2 py-1 text-sm rounded ${isRecording ? 'bg-red-500 hover:bg-red-600' : 'bg-gray-700 text-gray-300'}`} onClick={endSession} disabled={!sessionStart || !isRecording}>End</button>
                    <button className="px-2 py-1 text-sm rounded bg-yellow-500 hover:bg-yellow-600" onClick={resetSession}>Reset</button>
                </div>
            </header>

            <main className="flex-1 flex flex-col overflow-hidden min-h-0">
                <div className="p-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="bg-gray-800 p-4 rounded-xl border border-gray-700">
                            <div className="flex items-center gap-2 mb-1">
                                <Activity size={18} className="text-blue-500" />
                                <h3 className="text-gray-400 text-sm font-medium">Current State</h3>
                                <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse ml-auto"></span>
                            </div>
                            <div className={`text-2xl font-bold ${getBehaviorColor(stats.behavior)}`}>
                                {stats.behavior}
                            </div>
                            <div className="text-xs text-gray-400 mt-2 flex items-center gap-2">
                                Session: {sessionStart ? formatDuration(sessionStart, isRecording ? null : sessionEnd) : 'not recording'}
                                {isRecording && (
                                    <span className="inline-flex items-center gap-1">
                                        <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
                                        <span className="text-red-400 text-xs font-semibold">REC</span>
                                    </span>
                                )}
                            </div>
                            <div className="text-xs text-gray-400">Samples: {sessionBuffer.length}</div>
                        </div>
                        <div className="bg-gray-800 p-4 rounded-xl border border-gray-700">
                            <div className="flex items-center gap-2 mb-1 group relative">
                                <Activity size={18} className="text-purple-500" />
                                <h3 className="text-gray-400 text-sm font-medium">Specific Action</h3>
                                <span className="absolute left-0 top-7 hidden group-hover:block bg-gray-700 text-xs p-2 rounded shadow-lg w-52 z-10 text-gray-200">
                                    The fine-grained gesture detected by the model
                                </span>
                            </div>
                            <div className="text-2xl font-bold">{stats.fine_label || 'Unknown'}</div>
                        </div>
                    </div>
                </div>

                <div className="flex-1 flex gap-6 p-6 overflow-hidden min-h-0">
                    <div className="flex-1 bg-gray-800 rounded-2xl overflow-hidden border border-gray-700 shadow-xl flex flex-col p-4 relative">
                        <div className="w-full flex-1 bg-black flex items-center justify-center rounded-lg overflow-hidden relative">
                            <img src="http://localhost:8000/teacher_feed" alt="Feed" className="w-auto h-full object-contain" />
                            {/* Camera source badge */}
                            <div className={`absolute top-3 left-3 px-4 py-2 rounded-full text-sm font-bold shadow-2xl backdrop-blur-sm ${stats.camera_source === 'CAM2'
                                ? 'bg-emerald-500/90 text-white border border-emerald-400'
                                : 'bg-blue-500/90 text-white border border-blue-400'
                                }`}>
                                🎥 {stats.camera_source === 'CAM2' ? 'CAM 2 — BACK/AISLE' : 'CAM 1 — FRONT'}
                            </div>
                        </div>

                        {/* Interactive Boundary Calibrator */}
                        <div className="mt-4 p-4 bg-gray-900 rounded-lg border border-gray-700">
                            <div className="flex justify-between items-center mb-2">
                                <label className="text-sm font-medium text-gray-300">Teacher Boundary Line</label>
                                <span className="text-xs px-2 py-1 bg-indigo-500/20 text-indigo-300 rounded border border-indigo-500/30">
                                    y={stats.boundary_y != null ? stats.boundary_y : '—'}
                                </span>
                            </div>
                            <input
                                type="range"
                                min="0"
                                max="1080"
                                defaultValue="720"
                                className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-red-500"
                                onChange={(e) => {
                                    fetch('http://localhost:8000/teacher_behavior/calibrate', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ boundary_y: parseInt(e.target.value) })
                                    }).catch(err => console.error("Failed to calibrate boundary", err));
                                }}
                            />
                            <p className="text-xs text-gray-500 mt-2">
                                Slide to adjust the red boundary line. The model will only track the teacher if they are above this line.
                            </p>
                        </div>
                    </div>

                    <div className="w-96 flex-shrink-0">
                        {summaryMetrics ? (
                            <div className="bg-gray-800 p-6 rounded-xl border border-gray-700 h-full overflow-auto">
                                <div className="flex flex-col gap-4">
                                    <h3 className="text-lg font-semibold">Session Summary</h3>
                                    <div className="text-sm text-gray-300">Start: <span className="text-gray-200 font-medium">{summaryMetrics.startISO}</span></div>
                                    <div className="text-sm text-gray-300">End: <span className="text-gray-200 font-medium">{summaryMetrics.endISO}</span></div>
                                    <div className="text-sm text-gray-300">Duration: <span className="text-gray-200 font-medium">{Math.floor(summaryMetrics.durationSec / 60)}m {summaryMetrics.durationSec % 60}s</span></div>

                                    <div className="mt-2">
                                        <div className="text-sm text-gray-300">Distribution</div>
                                        <div className="grid grid-cols-1 gap-2 mt-2">
                                            <div className="text-sm text-gray-300 flex justify-between"><span>Passive</span><span>{summaryMetrics.distribution.passive}%</span></div>
                                            <div className="w-full bg-gray-700 rounded h-3 overflow-hidden"><div className={`h-3 bg-orange-400`} style={{ width: `${summaryMetrics.distribution.passive}%` }} /></div>
                                            <div className="text-sm text-gray-300 flex justify-between mt-2"><span>Lecturing</span><span>{summaryMetrics.distribution.lecturing}%</span></div>
                                            <div className="w-full bg-gray-700 rounded h-3 overflow-hidden"><div className={`h-3 bg-blue-400`} style={{ width: `${summaryMetrics.distribution.lecturing}%` }} /></div>
                                            <div className="text-sm text-gray-300 flex justify-between mt-2"><span>Interactive</span><span>{summaryMetrics.distribution.interactive}%</span></div>
                                            <div className="w-full bg-gray-700 rounded h-3 overflow-hidden"><div className={`h-3 bg-emerald-400`} style={{ width: `${summaryMetrics.distribution.interactive}%` }} /></div>
                                        </div>
                                    </div>

                                    {summary && (
                                        <div className="mt-3">
                                            <pre className="text-xs text-gray-300 mt-2 whitespace-pre-wrap">{summary}</pre>
                                        </div>
                                    )}

                                    <div className="mt-2 grid grid-cols-1 gap-2 text-sm text-gray-300">
                                        <div>Dominant: <span className="text-gray-200 font-medium">{summaryMetrics.dominant}</span></div>
                                        <div>Interactive segments: <span className="text-gray-200 font-medium">{summaryMetrics.interactiveSegments}</span></div>
                                        <div>Avg mobility: <span className="text-gray-200 font-medium">{summaryMetrics.avgMobility.toFixed(2)}</span></div>
                                        <div>Avg orientation: <span className="text-gray-200 font-medium">{summaryMetrics.avgOrientation.toFixed(2)}</span></div>
                                        <div>Avg hand speed: <span className="text-gray-200 font-medium">{summaryMetrics.avgHandSpeed.toFixed(2)}</span></div>
                                    </div>

                                    <div className="mt-3">
                                        <div className="text-sm text-gray-400 mb-2">Notes</div>
                                        <div className="text-sm text-gray-300 mb-4">{summaryMetrics.note}</div>

                                        <div className="flex flex-col gap-2">
                                            <button className={`px-3 py-2 rounded bg-sky-500 hover:bg-sky-600`} onClick={downloadCSV}>Download Session CSV</button>
                                            <button className={`px-3 py-2 rounded bg-indigo-500 hover:bg-indigo-600`} onClick={downloadSummaryTxt}>Download Summary TXT</button>
                                            <button className={`px-3 py-2 rounded bg-zinc-500 hover:bg-zinc-600`} onClick={downloadSummaryJSON}>Download Summary JSON</button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="flex flex-col gap-4">
                                <DistributionCard passive={distribution.passive} lecturing={distribution.lecturing} interactive={distribution.interactive} />
                                {liveWindow.length > 0 ? (
                                    <TimelineStrip samples={liveWindow} />
                                ) : (
                                    <div className="bg-gray-800 p-4 rounded-xl border border-gray-700 text-center">
                                        <p className="text-gray-500 text-sm">Start recording to see behavior timeline</p>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </main>
        </div>
    );
}
