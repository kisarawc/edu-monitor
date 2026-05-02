"use client";

import React, { useState } from "react";
// Removed unnecessary imports for sidebar/navigation
import {
  BarChart3,
  TrendingUp,
  Activity,
  AlertTriangle,
  X,
  Bell
} from 'lucide-react';


import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';

import EngagementDetailsModal from './EngagementDetailsModal';
import UserProfileMenu from "@/components/UserProfileMenu";

type EngagementStats = {
  total: number;
  engaged: number;
  off_task: number;
  context_dependent: number;
  decisive_total: number;
  active: number;
};

type ZoneStats = {
  engaged: number;
  off_task: number;
  context_dependent: number;
  decisive_total: number;
  total: number;
};

type HistoryApiPoint = {
  timestamp: number;
  engaged?: number;
  total?: number;
  context_dependent?: number;
  decisive_total?: number;
  front_engaged?: number;
  front_total?: number;
  front_context?: number;
  front_decisive_total?: number;
  mid_engaged?: number;
  mid_total?: number;
  mid_context?: number;
  mid_decisive_total?: number;
  back_engaged?: number;
  back_total?: number;
  back_context?: number;
  back_decisive_total?: number;
};

type HistoryChartPoint = {
  time: string;
  eng: number;
  front_eng: number;
  mid_eng: number;
  back_eng: number;
  context: number;
  decisive_total: number;
  front_context: number;
  front_decisive_total: number;
  mid_context: number;
  mid_decisive_total: number;
  back_context: number;
  back_decisive_total: number;
  front_total: number;
  mid_total: number;
  back_total: number;
  total: number;
};

const DEFAULT_STATS: EngagementStats = {
  total: 0,
  engaged: 0,
  off_task: 0,
  context_dependent: 0,
  decisive_total: 0,
  active: 0,
};

const DEFAULT_GROUP_STATS: Record<string, ZoneStats> = {
  "Front Row": { engaged: 0, off_task: 0, context_dependent: 0, decisive_total: 0, total: 0 },
  "Middle Row": { engaged: 0, off_task: 0, context_dependent: 0, decisive_total: 0, total: 0 },
  "Back Row": { engaged: 0, off_task: 0, context_dependent: 0, decisive_total: 0, total: 0 }
};

const getDecisiveTotal = (total: number, contextDependent: number, decisiveTotal?: number) => {
  if (typeof decisiveTotal === 'number' && decisiveTotal >= 0) return decisiveTotal;
  return Math.max(total - contextDependent, 0);
};

const getOnTaskPercent = (engaged: number, total: number, contextDependent: number, decisiveTotal?: number) => {
  const effectiveTotal = getDecisiveTotal(total, contextDependent, decisiveTotal);
  return effectiveTotal > 0 ? Math.round((engaged / effectiveTotal) * 100) : 0;
};



export default function StudentBehaviorPage() {
  // Removed activeTab and manual router logic

  const [stats, setStats] = useState<EngagementStats>(DEFAULT_STATS);
  const [groupStats, setGroupStats] = useState<Record<string, ZoneStats>>(DEFAULT_GROUP_STATS);
  const [showDetails, setShowDetails] = useState(false);
  const [visualizeGroups, setVisualizeGroups] = useState(false);

  // New Advanced State
  const [visualStyle, setVisualStyle] = useState("dots"); // "dots", "boxes", "detailed"
  const [modalDataKeys, setModalDataKeys] = useState<{
    engaged: string;
    total: string;
    context?: string;
    decisiveTotal?: string;
    label: string;
  } | undefined>(undefined);
  const [zoneSettings, setZoneSettings] = useState({ back: 33, front: 66 });
  const [historyData, setHistoryData] = useState<HistoryChartPoint[]>([]);
  const [alerts, setAlerts] = useState<{
    id: string;
    zone: string;
    message: string;
    type: 'drop' | 'low';
    timestamp: number;
    isFresh: boolean;
  }[]>([]);
  const [isAlertsCollapsed, setIsAlertsCollapsed] = useState(true);



  const [draggingZone, setDraggingZone] = useState<null | 'back' | 'front'>(null);
  const lastAlertTimes = React.useRef<Record<string, number>>({});

  // ROI Selection State

  const [isSelectingROI, setIsSelectingROI] = useState(false);
  const [roiStart, setRoiStart] = useState<{ x: number, y: number } | null>(null);
  const [roiCurrent, setRoiCurrent] = useState<{ x: number, y: number } | null>(null);
  const [, setActiveROI] = useState({ x1: 0, y1: 0, x2: 1, y2: 1 });


  // ... (keep existing functions)
  const updateZoneSettings = async (back: number, front: number) => {
    setZoneSettings({ back, front });
    try {
      await fetch('http://localhost:8000/settings/zones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ back_split: back / 100, front_split: front / 100 })
      });
    } catch (err) {
      console.error("Failed to update zones:", err);
    }
  };

  const toggleVisualization = async () => {
    try {
      const newState = !visualizeGroups;
      setVisualizeGroups(newState);
      await fetch('http://localhost:8000/settings/visualize-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: newState })
      });
    } catch (err) {
      console.error("Failed to toggle visualization:", err);
      // Revert on error
      setVisualizeGroups(!visualizeGroups);
    }
  };

  const changeVisualStyle = async (style: string) => {
    setVisualStyle(style);
    try {
      await fetch('http://localhost:8000/settings/visual-style', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ style: style })
      });
    } catch (err) {
      console.error("Failed to set visual style:", err);
    }
  };

  const handleROIMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isSelectingROI) {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      setRoiStart({ x, y });
      setRoiCurrent({ x, y });
    }
  };

  const handleROIMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    if (isSelectingROI && roiStart) {
      setRoiCurrent({ x, y });
    } else if (draggingZone) {
      const newVal = Math.max(0, Math.min(100, Math.round(y * 100)));
      if (draggingZone === 'back') {
        if (newVal < zoneSettings.front) {
          updateZoneSettings(newVal, zoneSettings.front);
        }
      } else {
        if (newVal > zoneSettings.back) {
          updateZoneSettings(zoneSettings.back, newVal);
        }
      }
    }
  };

  const handleROIMouseUp = async () => {
    if (draggingZone) {
      setDraggingZone(null);
      return;
    }

    if (!isSelectingROI || !roiStart || !roiCurrent) {
      setRoiStart(null);
      setRoiCurrent(null);
      return;
    }

    const x1 = Math.min(roiStart.x, roiCurrent.x);
    const y1 = Math.min(roiStart.y, roiCurrent.y);
    const x2 = Math.max(roiStart.x, roiCurrent.x);
    const y2 = Math.max(roiStart.y, roiCurrent.y);

    setActiveROI({ x1, y1, x2, y2 });

    try {
      await fetch('http://localhost:8000/settings/class-boundary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x1, y1, x2, y2 })
      });
    } catch (err) {
      console.error("Failed to update class boundary:", err);
    }

    setRoiStart(null);
    setRoiCurrent(null);
    setIsSelectingROI(false);
  };



  const handleCardClick = (keys?: {
    engaged: string;
    total: string;
    context?: string;
    decisiveTotal?: string;
    label: string;
  }) => {
    setModalDataKeys(keys); // If undefined, it uses default global stats
    setShowDetails(true);
  };

  React.useEffect(() => {
    const refreshStats = () => {
      // Fetch Global Stats
      fetch('http://localhost:8000/stats', { cache: 'no-store' })
        .then(res => res.json())
        .then(data => setStats({ ...DEFAULT_STATS, ...data }))
        .catch(err => console.error("Stats fetch error:", err));

      // Fetch Group Stats
      fetch('http://localhost:8000/stats/groups', { cache: 'no-store' })
        .then(res => res.json())
        .then(data => setGroupStats({
          ...DEFAULT_GROUP_STATS,
          ...data
        }))
        .catch(err => console.error("Group Stats fetch error:", err));

      // Fetch History
      fetch('http://localhost:8000/stats/history', { cache: 'no-store' })
        .then(res => res.json())
        .then((data: HistoryApiPoint[]) => {
          const formatted: HistoryChartPoint[] = data.slice(-40).map((d) => ({
            time: new Date(d.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            eng: getOnTaskPercent(d.engaged ?? 0, d.total ?? 0, d.context_dependent ?? 0, d.decisive_total),
            front_eng: getOnTaskPercent(d.front_engaged ?? 0, d.front_total ?? 0, d.front_context ?? 0, d.front_decisive_total),
            mid_eng: getOnTaskPercent(d.mid_engaged ?? 0, d.mid_total ?? 0, d.mid_context ?? 0, d.mid_decisive_total),
            back_eng: getOnTaskPercent(d.back_engaged ?? 0, d.back_total ?? 0, d.back_context ?? 0, d.back_decisive_total),
            context: d.context_dependent ?? 0,
            decisive_total: getDecisiveTotal(d.total ?? 0, d.context_dependent ?? 0, d.decisive_total),
            front_context: d.front_context ?? 0,
            front_decisive_total: getDecisiveTotal(d.front_total ?? 0, d.front_context ?? 0, d.front_decisive_total),
            mid_context: d.mid_context ?? 0,
            mid_decisive_total: getDecisiveTotal(d.mid_total ?? 0, d.mid_context ?? 0, d.mid_decisive_total),
            back_context: d.back_context ?? 0,
            back_decisive_total: getDecisiveTotal(d.back_total ?? 0, d.back_context ?? 0, d.back_decisive_total),
            front_total: d.front_total ?? 0,
            mid_total: d.mid_total ?? 0,
            back_total: d.back_total ?? 0,
            total: d.total ?? 0
          }));
          setHistoryData(formatted);
        })
        .catch(err => console.error("History fetch error:", err));
    };

    refreshStats();
    const refreshInterval = setInterval(refreshStats, 1000);

    return () => clearInterval(refreshInterval);
  }, []);

  // Trend detection and alerting logic
  React.useEffect(() => {
    if (historyData.length < 15) return;

    setAlerts((prevAlerts) => {
      const zones = [
        { name: 'Front Row', key: 'front_eng', totalKey: 'front_decisive_total' },
        { name: 'Middle Row', key: 'mid_eng', totalKey: 'mid_decisive_total' },
        { name: 'Back Row', key: 'back_eng', totalKey: 'back_decisive_total' }
      ] as const;

      const newAlertsCandidates: typeof prevAlerts = [];
      const alertsToRemove = new Set<string>();
      const now = Date.now();
      const recentSamples = historyData.slice(-15);
      const currentSample = recentSamples[recentSamples.length - 1];

      zones.forEach((zone) => {
        const currentEng = currentSample[zone.key];
        const currentTotal = currentSample[zone.totalKey];

        // No manual recovery: alerts will persist for 10 seconds regardless of recovery

        if (currentTotal <= 0) return;

        const tenSamplesAgo = recentSamples[recentSamples.length - 10]?.[zone.key];
        if (tenSamplesAgo !== undefined && (tenSamplesAgo - currentEng) >= 15) {
          const lastDrop = lastAlertTimes.current[`${zone.name}-drop`] || 0;
          if (now - lastDrop > 30000) { // Reduced to 30s
            lastAlertTimes.current[`${zone.name}-drop`] = now;
            newAlertsCandidates.push({
              id: `${zone.name}-drop-${now}`,
              zone: zone.name,
              message: `Engagement is dropping rapidly in ${zone.name}`,
              type: 'drop',
              timestamp: now,
              isFresh: true
            });
          }
        }

        const isContinuouslyLow = recentSamples.every(
          (sample) => sample[zone.key] < 60 && sample[zone.key] !== undefined
        );
        if (isContinuouslyLow) {
          const lastLow = lastAlertTimes.current[`${zone.name}-low`] || 0;
          if (now - lastLow > 30000) { // Reduced to 30s
            lastAlertTimes.current[`${zone.name}-low`] = now;
            newAlertsCandidates.push({
              id: `${zone.name}-low-${now}`,
              zone: zone.name,
              message: `Sustained low engagement in ${zone.name}`,
              type: 'low',
              timestamp: now,
              isFresh: true
            });
          }
        }
      });

      const nextAlerts = prevAlerts.filter((alert) => !alertsToRemove.has(alert.id));
      if (newAlertsCandidates.length === 0) {
        return nextAlerts;
      }
      return [...newAlertsCandidates, ...nextAlerts].slice(0, 5);
    });
  }, [historyData]);

  const removeAlert = (id: string) => {
    setAlerts(prev => prev.filter(a => a.id !== id));
  };

  const clearAllAlerts = () => {
    setAlerts([]);
  };

  // Auto-clear alerts after 10 seconds
  React.useEffect(() => {
    const cleanupTimer = setInterval(() => {
      const now = Date.now();
      setAlerts(prev => prev.filter(alert => (now - alert.timestamp) < 10000));
    }, 1000);
    return () => clearInterval(cleanupTimer);
  }, []);



  // Helper to get keys for zone
  const getZoneKeys = (zoneName: string) => {
    if (zoneName === "Front Row") return { engaged: "front_engaged", total: "front_total", context: "front_context", decisiveTotal: "front_decisive_total", label: "Front Row Behavior" };
    if (zoneName === "Middle Row") return { engaged: "mid_engaged", total: "mid_total", context: "mid_context", decisiveTotal: "mid_decisive_total", label: "Middle Row Behavior" };
    if (zoneName === "Back Row") return { engaged: "back_engaged", total: "back_total", context: "back_context", decisiveTotal: "back_decisive_total", label: "Back Row Behavior" };
    return undefined;
  };

  const overallOnTaskPercent = getOnTaskPercent(
    stats.engaged,
    stats.total,
    stats.context_dependent,
    stats.decisive_total
  );
  const overallDecisiveTotal = getDecisiveTotal(
    stats.total,
    stats.context_dependent,
    stats.decisive_total
  );
  const hasContextCases =
    stats.context_dependent > 0 ||
    Object.values(groupStats).some((zone) => zone.context_dependent > 0) ||
    historyData.some((point) => point.context > 0);

  return (
    <div className="flex flex-col h-full bg-gray-900 text-white overflow-hidden">
      <EngagementDetailsModal
        isOpen={showDetails}
        onClose={() => setShowDetails(false)}
        dataKeys={modalDataKeys}
      />

      <header className="h-16 bg-gray-800/50 backdrop-blur border-b border-gray-700 flex items-center justify-between px-8 sticky top-0 z-10 shrink-0">
        <h2 className="text-lg font-semibold text-gray-200">
          Student Behavior
        </h2>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="text-sm text-emerald-400 font-medium whitespace-nowrap hidden sm:block">System Online</span>
          </div>

          <div className="h-8 w-px bg-gray-700/50 mx-2 hidden sm:block"></div>

          {/* Header Alert Indicator */}
          <div className="relative flex items-center gap-4">
            <button
              onClick={() => setIsAlertsCollapsed(!isAlertsCollapsed)}
              className={`relative p-2 rounded-xl transition-all ${
                alerts.length > 0 
                  ? (alerts.some(a => a.type === 'low') ? 'bg-red-500/10 text-red-500 hover:bg-red-500/20' : 'bg-amber-500/10 text-amber-500 hover:bg-amber-500/20')
                  : 'bg-gray-700/50 text-gray-400 hover:bg-gray-700'
              }`}
            >
              <Bell size={20} className={!isAlertsCollapsed && alerts.length > 0 ? 'animate-pulse' : ''} />
              {alerts.length > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-600 text-[10px] font-black w-5 h-5 flex items-center justify-center rounded-full border-2 border-gray-900 shadow-lg text-white">
                  {alerts.length}
                </span>
              )}
            </button>

            {!isAlertsCollapsed && (
              <div className="absolute top-12 right-0 w-80 z-50 pointer-events-none">
                <div className="pointer-events-auto flex flex-col gap-2 p-4 bg-gray-900/95 backdrop-blur-2xl border border-gray-700 rounded-2xl shadow-2xl animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Notifications</span>
                    {alerts.length > 0 && (
                      <button onClick={clearAllAlerts} className="text-[10px] font-bold text-gray-500 hover:text-red-400">Clear All</button>
                    )}
                  </div>
                  <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
                    {alerts.length > 0 ? (
                      alerts.map((alert) => (
                        <div
                          key={alert.id}
                          className={`flex items-start gap-3 p-3 rounded-xl border ${alert.type === 'drop'
                            ? 'bg-amber-500/10 border-amber-500/30 text-amber-200'
                            : 'bg-red-500/10 border-red-500/30 text-red-200'
                            }`}
                        >
                          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                          <div className="flex-1">
                            <p className="text-[11px] font-bold leading-tight">{alert.message}</p>
                            <span className="text-[9px] opacity-40 mt-1 block font-mono">
                              {new Date(alert.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </span>
                          </div>
                          <button onClick={() => removeAlert(alert.id)} className="p-1 hover:bg-white/10 rounded-lg">
                            <X size={12} />
                          </button>
                        </div>
                      ))
                    ) : (
                      <div className="py-8 text-center">
                        <Bell size={24} className="mx-auto text-gray-600 mb-2 opacity-20" />
                        <p className="text-xs text-gray-500">No active notifications</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          <UserProfileMenu />
        </div>



      </header>





      <main className="p-8 flex-1 overflow-auto">
        <div className="max-w-7xl mx-auto space-y-8">

          {/* Top Section: Overview & Insights */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

            {/* Main Stats Column */}
            <div className="lg:col-span-1 space-y-6">
              <div className="bg-gray-800 p-6 rounded-2xl border border-gray-700 shadow-xl overflow-hidden relative group">
                <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                  <Activity size={80} />
                </div>
                <h3 className="text-gray-400 text-xs font-bold uppercase tracking-widest mb-4">Overall Engagement</h3>
                <div className="text-5xl font-black text-white mb-2 leading-none">
                  {overallOnTaskPercent}<span className="text-2xl text-blue-500">%</span>
                </div>
                <div className="flex items-center gap-2 text-emerald-400 font-medium">
                  <TrendingUp size={16} />
                  <span>{stats.engaged} / {overallDecisiveTotal} On-Task (decisive)</span>
                </div>
                {hasContextCases && (
                  <div className="mt-2 text-xs text-amber-400 font-medium">
                    {stats.context_dependent} context-dependent students excluded from this percentage
                  </div>
                )}
                <div className="mt-6 pt-6 border-t border-gray-700/50">
                  <button
                    onClick={() => handleCardClick(undefined)}
                    className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold transition-all shadow-lg shadow-blue-900/20 active:scale-95"
                  >
                    View Class Details
                  </button>
                </div>
              </div>

              <div className="bg-gray-800/50 p-6 rounded-2xl border border-gray-700 backdrop-blur-sm">
                <h4 className="text-gray-400 text-xs font-bold uppercase tracking-widest mb-4">Live Monitoring</h4>
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 bg-gray-900/50 rounded-xl border border-gray-700/50">
                    <span className="text-sm font-medium text-gray-300">Active Students</span>
                    <span className="text-xl font-mono font-bold text-white">{stats.active}</span>
                  </div>
                  {hasContextCases && (
                    <div className="flex items-center justify-between p-3 bg-amber-500/10 rounded-xl border border-amber-500/20">
                      <span className="text-sm font-medium text-amber-200">Context-Dependent</span>
                      <span className="text-xl font-mono font-bold text-amber-300">{stats.context_dependent}</span>
                    </div>
                  )}
                </div>

              </div>
            </div>

            {/* Engagement Trends Column */}
            <div className="lg:col-span-2 bg-gray-800 p-6 rounded-2xl border border-gray-700 shadow-xl flex flex-col">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-gray-200 text-sm font-bold uppercase tracking-widest">Engagement Trends</h3>
                  <p className="text-xs text-gray-400 mt-1">
                    {hasContextCases
                      ? 'Real-time on-task percentage, excluding context-dependent cases'
                      : 'Real-time on-task percentage for decisive on-task vs off-task states'}
                  </p>
                </div>
                <div className="flex items-center gap-2 px-3 py-1 bg-emerald-500/10 text-emerald-400 rounded-full text-[10px] font-bold uppercase border border-emerald-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  Live Feed
                </div>
              </div>

              <div className="flex-1 min-h-[300px] w-full mt-4">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={historyData}>
                    <defs>
                      <linearGradient id="colorEngLine" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} strokeOpacity={0.5} />
                    <XAxis
                      dataKey="time"
                      stroke="#9ca3af"
                      fontSize={10}
                      tickLine={false}
                      axisLine={false}
                      hide={historyData.length < 5}
                    />
                    <YAxis
                      stroke="#9ca3af"
                      fontSize={10}
                      tickLine={false}
                      axisLine={false}
                      domain={[0, 100]}
                      tickFormatter={(v) => `${v}%`}
                    />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (active && payload && payload.length) {
                          return (
                            <div className="bg-gray-900 border border-gray-700 p-4 rounded-xl shadow-2xl backdrop-blur-md">
                              <p className="text-xs font-bold text-gray-400 mb-2">{label}</p>
                              <div className="space-y-1">
                                <div className="flex items-center justify-between gap-8">
                                  <span className="text-[10px] font-bold text-blue-400 uppercase tracking-wider">Engagement</span>
                                  <span className="text-sm font-mono font-black text-white">{payload[0].value}%</span>
                                </div>
                                <div className="flex items-center justify-between gap-8 pt-1 border-t border-gray-800">
                                  <span className="text-[10px] font-bold text-gray-500 uppercase">Decisive</span>
                                  <span className="text-[10px] font-mono text-gray-400">{payload[0].payload.decisive_total} Students</span>
                                </div>
                                {payload[0].payload.context > 0 && (
                                  <div className="flex items-center justify-between gap-8">
                                    <span className="text-[10px] font-bold text-amber-400 uppercase">Context</span>
                                    <span className="text-[10px] font-mono text-amber-300">{payload[0].payload.context} Students</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="eng"
                      stroke="#3b82f6"
                      strokeWidth={4}
                      fill="url(#colorEngLine)"
                      name="Engagement"
                      animationDuration={500}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* Simplified Legend */}
              <div className="flex items-center gap-4 mt-4 pt-4 border-t border-gray-700/50">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]"></div>
                  <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Decisive On-Task (%)</span>
                </div>
              </div>



            </div>
          </div>

          {/* Middle Section: Zone Distribution (Horizontal) */}
          {visualizeGroups && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-in fade-in slide-in-from-top-4 duration-500">
              {Object.entries(groupStats).map(([zoneName, zoneData]) => {
                const hasAlert = alerts.some(a => a.zone === zoneName);
                const isLow = alerts.some(a => a.zone === zoneName && a.type === 'low');
                const decisiveTotal = getDecisiveTotal(
                  zoneData.total,
                  zoneData.context_dependent,
                  zoneData.decisive_total
                );
                const zonePercent = getOnTaskPercent(
                  zoneData.engaged,
                  zoneData.total,
                  zoneData.context_dependent,
                  zoneData.decisive_total
                );

                return (
                  <div
                    key={zoneName}
                    className={`relative bg-gray-800/80 p-5 rounded-2xl border transition-all group cursor-pointer hover:bg-gray-800 ${hasAlert
                      ? 'border-red-500 shadow-[0_0_20px_rgba(239,68,68,0.2)] animate-pulse'
                      : 'border-gray-700 hover:border-blue-500/50 shadow-lg'
                      }`}
                    onClick={() => handleCardClick(getZoneKeys(zoneName))}
                  >
                    {hasAlert && (
                      <div className="absolute -top-2 -right-2 bg-red-600 text-white text-[8px] font-black px-2 py-1 rounded-full border border-red-400 shadow-lg uppercase tracking-tighter z-10">
                        {isLow ? 'LOW ENGAGEMENT' : 'DROPPING FAST'}
                      </div>
                    )}

                    <div className="flex items-center justify-between mb-3 text-gray-400 text-[10px] font-bold uppercase tracking-widest">
                      {zoneName}
                      <BarChart3 size={14} className={`${hasAlert ? 'text-red-400 opacity-100' : 'opacity-50 group-hover:text-blue-400'} transition-colors`} />
                    </div>
                    <div className="flex items-end justify-between">
                      <div className={`text-2xl font-black leading-none ${hasAlert ? 'text-red-400' : 'text-white'}`}>
                        {zonePercent}%
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-gray-500 font-mono">
                          {zoneData.engaged}/{decisiveTotal} Decisive
                        </div>
                        {zoneData.context_dependent > 0 && (
                          <div className="text-[10px] text-amber-400 font-medium">
                            {zoneData.context_dependent} Context
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="w-full h-2 bg-gray-900 rounded-full mt-4 overflow-hidden border border-gray-700/50">
                      <div
                        className={`h-full rounded-full transition-all duration-1000 ${hasAlert ? 'bg-red-500' :
                          (decisiveTotal === 0 && zoneData.context_dependent > 0) ? 'bg-amber-400' :
                            (decisiveTotal > 0 && (zoneData.engaged / decisiveTotal) > 0.7) ? 'bg-emerald-500' :
                              (decisiveTotal > 0 && (zoneData.engaged / decisiveTotal) > 0.4) ? 'bg-yellow-500' : 'bg-red-500'
                          }`}
                        style={{ width: `${decisiveTotal === 0 && zoneData.context_dependent > 0 ? 100 : (decisiveTotal > 0 ? (zoneData.engaged / decisiveTotal) * 100 : 0)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}


          {/* Bottom Section: Video Feed & Controls */}
          <div className="bg-gray-800 rounded-3xl overflow-hidden border border-gray-700 shadow-2xl relative">
            <div className="p-6 bg-gray-900/50 flex justify-between items-center sm:flex-row flex-col gap-4">
              <div>
                <h3 className="font-bold text-lg flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></div>
                  Live Analysis Feed
                </h3>
                <p className="text-xs text-gray-500 font-medium">View YOLO detection boxes and pose skeleton overlays</p>
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                {/* Visual Style Selector */}
                <div className="flex bg-gray-950/50 rounded-xl p-1 gap-1 border border-gray-700/50">
                  {['dots', 'boxes', 'detailed'].map((style) => (
                    <button
                      key={style}
                      onClick={() => changeVisualStyle(style)}
                      className={`px-3 py-1.5 text-[10px] font-bold rounded-lg uppercase tracking-wider transition-all ${visualStyle === style
                        ? 'bg-blue-600 text-white shadow-lg'
                        : 'text-gray-500 hover:text-gray-300'
                        }`}
                    >
                      {style}
                    </button>
                  ))}
                </div>

                <div className="h-6 w-px bg-gray-700 mx-1"></div>

                {/* Boundary Selection Toggle */}
                <button
                  onClick={() => setIsSelectingROI(!isSelectingROI)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-tight transition-all border ${isSelectingROI
                    ? 'bg-amber-600/20 text-amber-400 border-amber-500/50'
                    : 'bg-gray-700/50 hover:bg-gray-700 text-gray-400 border-transparent hover:border-gray-600'
                    }`}
                >
                  <Activity size={14} className={isSelectingROI ? 'animate-pulse' : ''} />
                  {isSelectingROI ? 'Defining Boundary...' : 'Set Class ROI'}
                </button>

                {/* Visualization Toggle */}
                <button
                  onClick={toggleVisualization}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-tight transition-all border ${visualizeGroups
                    ? 'bg-blue-600/20 text-blue-400 border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.1)]'
                    : 'bg-gray-700/50 hover:bg-gray-700 text-gray-400 border-transparent hover:border-gray-600'
                    }`}
                >
                  <BarChart3 size={14} />
                  {visualizeGroups ? 'Zones Active' : 'Show Zones'}
                </button>
              </div>
            </div>

            {/* THE STREAM IMAGE */}
            <div
              className={`relative aspect-video bg-black flex items-center justify-center ${isSelectingROI ? 'cursor-crosshair' : ''}`}
              onMouseDown={handleROIMouseDown}
              onMouseMove={handleROIMouseMove}
              onMouseUp={handleROIMouseUp}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="http://localhost:8000/video_feed"
                alt="Live Classroom Feed"
                className="w-full h-full object-contain pointer-events-none select-none"
              />

              {/* Drawing Overlay */}
              {isSelectingROI && roiStart && roiCurrent && (
                <div
                  className="absolute border-2 border-dashed border-amber-400 bg-amber-400/10 pointer-events-none"
                  style={{
                    left: `${Math.min(roiStart.x, roiCurrent.x) * 100}%`,
                    top: `${Math.min(roiStart.y, roiCurrent.y) * 100}%`,
                    width: `${Math.abs(roiCurrent.x - roiStart.x) * 100}%`,
                    height: `${Math.abs(roiCurrent.y - roiStart.y) * 100}%`,
                  }}
                />
              )}

              {/* Zone Dividers */}
              {visualizeGroups && (
                <>
                  {/* Back/Mid Divider */}
                  <div
                    className="absolute w-full h-1 group/back cursor-row-resize z-20"
                    style={{ top: `${zoneSettings.back}%` }}
                    onMouseDown={(e) => { e.stopPropagation(); setDraggingZone('back'); }}
                  >
                    <div className="absolute inset-0 bg-pink-500/40 group-hover/back:bg-pink-400 shadow-[0_0_10px_rgba(236,72,153,0.3)] transition-colors"></div>
                    <div className="absolute right-4 -top-3 bg-pink-600 text-[8px] font-black px-2 py-0.5 rounded-full text-white uppercase tracking-tighter shadow-lg">
                      Back Divider ({zoneSettings.back}%)
                    </div>
                  </div>

                  {/* Mid/Front Divider */}
                  <div
                    className="absolute w-full h-1 group/front cursor-row-resize z-20"
                    style={{ top: `${zoneSettings.front}%` }}
                    onMouseDown={(e) => { e.stopPropagation(); setDraggingZone('front'); }}
                  >
                    <div className="absolute inset-0 bg-cyan-500/40 group-hover/front:bg-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.3)] transition-colors"></div>
                    <div className="absolute right-4 -top-3 bg-cyan-600 text-[8px] font-black px-2 py-0.5 rounded-full text-white uppercase tracking-tighter shadow-lg">
                      Front Divider ({zoneSettings.front}%)
                    </div>
                  </div>
                </>
              )}

              <div className="absolute bottom-6 left-6 flex items-center gap-3">

                <div className="bg-black/60 backdrop-blur-md px-4 py-2 rounded-2xl border border-white/10 flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                    <span className="text-[10px] font-bold text-white uppercase tracking-widest">Live</span>
                  </div>
                  <div className="h-4 w-px bg-white/10"></div>
                  <span className="text-[10px] font-mono text-white/60">SOURCE: CAM-01 • 1080p</span>
                </div>
              </div>

              {isSelectingROI && !roiStart && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-[2px] pointer-events-none transition-all duration-500">
                  <div className="bg-amber-600/90 text-white px-8 py-4 rounded-3xl shadow-2xl font-bold text-lg border border-white/20 animate-in zoom-in duration-300">
                    DRAG RECTANGLE OVER STUDENTS
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

    </div>
  );
}
