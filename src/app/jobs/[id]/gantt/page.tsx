"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import Layout from "@/components/Layout";
import Link from "next/link";
import {
  format,
  parseISO,
  differenceInDays,
  addDays,
  addWeeks,
  subWeeks,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isWeekend,
  isSameDay,
} from "date-fns";

// ─── Business-day helpers (client-side, local time) ──────────────────────────

function isWeekendLocal(d: Date): boolean {
  const dow = d.getDay();
  return dow === 0 || dow === 6;
}

function snapToWeekdayLocal(date: Date): Date {
  let d = new Date(date);
  while (isWeekendLocal(d)) d = addDays(d, 1);
  return d;
}

function durationBizDays(start: Date, end: Date): number {
  let d = new Date(start);
  let count = 0;
  while (d <= end) {
    if (!isWeekendLocal(d)) count++;
    d = addDays(d, 1);
  }
  return Math.max(count, 1);
}

function endFromBizDays(start: Date, bizDays: number): Date {
  let d = snapToWeekdayLocal(new Date(start));
  let remaining = bizDays - 1;
  while (remaining > 0) {
    d = addDays(d, 1);
    if (!isWeekendLocal(d)) remaining--;
  }
  return d;
}

// ─────────────────────────────────────────────────────────────────────────────

interface Phase {
  id: string;
  name: string;
  description: string | null;
  orderIndex: number;
  startDate: string | null;
  endDate: string | null;
  dependsOnId: string | null;
}

interface Job {
  id: string;
  name: string;
  address: string;
  color: string;
  phases: Phase[];
}

interface GanttCascadeModal {
  phaseId: string;
  phaseName: string;
  newStartDate: string;
  newEndDate: string;
  updatedPhases: Array<{ id: string; name: string; startDate: string | null; endDate: string | null }>;
  conflicts: Array<{ userName: string; date: string; jobName: string; phaseName: string }>;
}

interface DragState {
  phaseId: string;
  startClientX: number;
  originalStart: Date;
  originalEnd: Date;
  bizDayDuration: number;
  didDrag: boolean;
}

type ViewMode = "week" | "month" | "wholejob";

const ROW_HEIGHT = 48;
const BAR_HEIGHT = 28;
const DEFAULT_SIDEBAR_WIDTH = 200;
const MIN_SIDEBAR_WIDTH = 120;
const DRAG_THRESHOLD = 5;

function getPhaseColor(phase: Phase): string {
  if (!phase.startDate || !phase.endDate) return "#94a3b8";
  const now = new Date();
  const start = parseISO(phase.startDate);
  const end = parseISO(phase.endDate);
  if (end < now) return "#22c55e";
  if (start <= now && end >= now) return "#3b82f6";
  return "#94a3b8";
}

function skipWeekendDisplay(d: Date): boolean {
  return isWeekend(d);
}

export default function JobGanttPage() {
  const params = useParams();
  const jobId = (params?.id ?? "") as string;

  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [popover, setPopover] = useState<{ phase: Phase; x: number; y: number } | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("gantt-sidebar-width");
      if (stored) return Math.max(MIN_SIDEBAR_WIDTH, Number(stored));
    }
    return DEFAULT_SIDEBAR_WIDTH;
  });

  // Drag-to-reschedule state
  const [draggingPhaseId, setDraggingPhaseId] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<{
    phaseId: string;
    newStart: Date;
    newEnd: Date;
    deltaDays: number;
  } | null>(null);
  const [ganttCascadeModal, setGanttCascadeModal] = useState<GanttCascadeModal | null>(null);
  const [ganttToast, setGanttToast] = useState<{
    count: number;
    phases: Array<{ name: string; startDate: string | null; endDate: string | null }>;
  } | null>(null);
  const [savingDrag, setSavingDrag] = useState(false);

  // Refs for drag handlers (avoid stale closures in global listeners)
  const dragStateRef = useRef<DragState | null>(null);
  const dragPreviewRef = useRef<typeof dragPreview>(null);
  const dayWidthRef = useRef<number>(32);
  const viewStartRef = useRef<Date>(new Date());
  const wasRealDragRef = useRef(false);

  const timelineRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchJob = useCallback(() => {
    Promise.all([
      fetch(`/api/jobs/${jobId}`).then((r) => r.json()),
      fetch(`/api/jobs/${jobId}/phases`).then((r) => r.json()),
    ]).then(([jobData, phasesData]) => {
      setJob({ ...jobData, phases: phasesData });
    });
  }, [jobId]);

  useEffect(() => {
    Promise.all([
      fetch(`/api/jobs/${jobId}`).then((r) => r.json()),
      fetch(`/api/jobs/${jobId}/phases`).then((r) => r.json()),
    ]).then(([jobData, phasesData]) => {
      setJob({ ...jobData, phases: phasesData });
      setLoading(false);
    });
  }, [jobId]);

  const phases = job?.phases || [];

  const getViewRange = useCallback((): { viewStart: Date; viewEnd: Date; dayWidth: number } => {
    if (viewMode === "week") {
      const viewStart = startOfWeek(currentDate, { weekStartsOn: 0 });
      const viewEnd = endOfWeek(currentDate, { weekStartsOn: 0 });
      return { viewStart, viewEnd, dayWidth: 80 };
    }
    if (viewMode === "month") {
      const viewStart = startOfMonth(currentDate);
      const viewEnd = endOfMonth(currentDate);
      return { viewStart, viewEnd, dayWidth: 32 };
    }
    const datedPhases = phases.filter((p) => p.startDate && p.endDate);
    if (datedPhases.length === 0) {
      const viewStart = startOfMonth(currentDate);
      const viewEnd = endOfMonth(addWeeks(currentDate, 4));
      return { viewStart, viewEnd, dayWidth: 28 };
    }
    const starts = datedPhases.map((p) => parseISO(p.startDate!));
    const ends = datedPhases.map((p) => parseISO(p.endDate!));
    const viewStart = addDays(starts.reduce((a, b) => (a < b ? a : b)), -2);
    const viewEnd = addDays(ends.reduce((a, b) => (a > b ? a : b)), 2);
    const totalDays = Math.max(differenceInDays(viewEnd, viewStart) + 1, 1);
    const containerW = containerRef.current?.clientWidth ?? 800;
    const availableW = containerW - sidebarWidth;
    const dayWidth = Math.max(20, Math.floor(availableW / totalDays));
    return { viewStart, viewEnd, dayWidth };
  }, [viewMode, currentDate, phases, sidebarWidth]);

  // ─── Drag handlers ─────────────────────────────────────────────────────────

  const saveDraggedPhase = useCallback(async (phaseId: string, newStartStr: string, newEndStr: string) => {
    setSavingDrag(true);
    try {
      // Preview cascade (old system uses dependsOnId)
      const previewRes = await fetch(`/api/jobs/${jobId}/phases/${phaseId}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate: newStartStr, endDate: newEndStr, preview: true }),
      });
      const previewData = await previewRes.json();

      const phase = job?.phases.find((p) => p.id === phaseId);

      if (previewData.updatedPhases && previewData.updatedPhases.length > 0) {
        setGanttCascadeModal({
          phaseId,
          phaseName: phase?.name ?? "",
          newStartDate: newStartStr,
          newEndDate: newEndStr,
          updatedPhases: previewData.updatedPhases,
          conflicts: previewData.conflicts ?? [],
        });
      } else {
        // No dependents — commit directly
        await commitDragDates(phaseId, newStartStr, newEndStr);
      }
    } finally {
      setSavingDrag(false);
    }
  }, [jobId, job]);

  const commitDragDates = useCallback(async (phaseId: string, newStartStr: string, newEndStr: string) => {
    // Old system (dependsOnId cascade)
    await fetch(`/api/jobs/${jobId}/phases/${phaseId}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startDate: newStartStr, endDate: newEndStr, preview: false }),
    });
    // New system (PhaseDependency cascade)
    const res = await fetch(`/api/phases/${phaseId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startDate: newStartStr, endDate: newEndStr }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.cascadedPhases?.length > 0) {
        setGanttToast({ count: data.cascadedPhases.length, phases: data.cascadedPhases });
        setTimeout(() => setGanttToast(null), 7000);
      }
    }
    fetchJob();
  }, [jobId, fetchJob]);

  const confirmGanttCascade = useCallback(async () => {
    if (!ganttCascadeModal) return;
    setSavingDrag(true);
    await commitDragDates(ganttCascadeModal.phaseId, ganttCascadeModal.newStartDate, ganttCascadeModal.newEndDate);
    setGanttCascadeModal(null);
    setSavingDrag(false);
  }, [ganttCascadeModal, commitDragDates]);

  // Global mouse handlers for drag
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      const ds = dragStateRef.current;
      if (!ds) return;

      const deltaX = e.clientX - ds.startClientX;
      if (Math.abs(deltaX) >= DRAG_THRESHOLD) {
        ds.didDrag = true;
      }
      if (!ds.didDrag) return;

      const deltaDays = Math.round(deltaX / dayWidthRef.current);
      const rawNewStart = addDays(ds.originalStart, deltaDays);
      const newStart = snapToWeekdayLocal(rawNewStart);
      const newEnd = endFromBizDays(newStart, ds.bizDayDuration);

      const preview = { phaseId: ds.phaseId, newStart, newEnd, deltaDays };
      dragPreviewRef.current = preview;
      setDragPreview(preview);
    };

    const onMouseUp = (e: MouseEvent) => {
      const ds = dragStateRef.current;
      if (!ds) return;

      dragStateRef.current = null;
      setDraggingPhaseId(null);

      if (!ds.didDrag) {
        setDragPreview(null);
        dragPreviewRef.current = null;
        return;
      }

      wasRealDragRef.current = true;

      const preview = dragPreviewRef.current;
      setDragPreview(null);
      dragPreviewRef.current = null;

      if (!preview) return;

      const newStartStr = format(preview.newStart, "yyyy-MM-dd");
      const newEndStr = format(preview.newEnd, "yyyy-MM-dd");
      saveDraggedPhase(ds.phaseId, newStartStr, newEndStr);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [saveDraggedPhase]);

  // ─── Sidebar drag ──────────────────────────────────────────────────────────

  const startSidebarDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    const onMove = (me: MouseEvent) => {
      const maxW = Math.floor(window.innerWidth * 0.6);
      const newWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(maxW, startWidth + me.clientX - startX));
      setSidebarWidth(newWidth);
      localStorage.setItem("gantt-sidebar-width", String(newWidth));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const startSidebarTouchDrag = (e: React.TouchEvent) => {
    const startX = e.touches[0].clientX;
    const startWidth = sidebarWidth;
    const onMove = (te: TouchEvent) => {
      te.preventDefault();
      const maxW = Math.floor(window.innerWidth * 0.6);
      const newWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(maxW, startWidth + te.touches[0].clientX - startX));
      setSidebarWidth(newWidth);
      localStorage.setItem("gantt-sidebar-width", String(newWidth));
    };
    const onEnd = () => {
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
    };
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
  };

  // ─── View calculations ─────────────────────────────────────────────────────

  const { viewStart, viewEnd, dayWidth } = getViewRange();
  // Keep refs in sync for drag handlers
  dayWidthRef.current = dayWidth;
  viewStartRef.current = viewStart;

  const totalDays = Math.max(differenceInDays(viewEnd, viewStart) + 1, 1);
  const timelineWidth = totalDays * dayWidth;
  const days = eachDayOfInterval({ start: viewStart, end: viewEnd });

  const getBarStyle = (phase: Phase, overrideStart?: Date, overrideEnd?: Date) => {
    const start = overrideStart ?? (phase.startDate ? parseISO(phase.startDate) : null);
    const end = overrideEnd ?? (phase.endDate ? parseISO(phase.endDate) : null);
    if (!start || !end) return null;
    const leftDays = differenceInDays(start, viewStart);
    const widthDays = Math.max(differenceInDays(end, start) + 1, 1);
    return {
      left: leftDays * dayWidth,
      width: widthDays * dayWidth,
      color: overrideStart ? "#f59e0b" : getPhaseColor(phase), // amber when dragging preview
    };
  };

  const prevPeriod = () => {
    if (viewMode === "week") setCurrentDate((d) => subWeeks(d, 1));
    else if (viewMode === "month") setCurrentDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  };

  const nextPeriod = () => {
    if (viewMode === "week") setCurrentDate((d) => addWeeks(d, 1));
    else if (viewMode === "month") setCurrentDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1));
  };

  const getMonthLabels = () => {
    const labels: { label: string; left: number }[] = [];
    let lastMonth = -1;
    days.forEach((day, i) => {
      if (day.getMonth() !== lastMonth) {
        labels.push({ label: format(day, "MMM yyyy"), left: i * dayWidth });
        lastMonth = day.getMonth();
      }
    });
    return labels;
  };

  const getDependencyLines = () => {
    const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
    phases.forEach((phase, idx) => {
      if (!phase.dependsOnId) return;
      const parentIdx = phases.findIndex((p) => p.id === phase.dependsOnId);
      if (parentIdx < 0) return;
      const parent = phases[parentIdx];
      const childBar = getBarStyle(phase);
      const parentBar = getBarStyle(parent);
      if (!childBar || !parentBar) return;
      const x1 = parentBar.left + parentBar.width;
      const y1 = parentIdx * ROW_HEIGHT + ROW_HEIGHT / 2;
      const x2 = childBar.left;
      const y2 = idx * ROW_HEIGHT + ROW_HEIGHT / 2;
      lines.push({ x1, y1, x2, y2 });
    });
    return lines;
  };

  const handleBarMouseDown = (e: React.MouseEvent, phase: Phase) => {
    if (!phase.startDate || !phase.endDate) return;
    e.preventDefault();

    const originalStart = parseISO(phase.startDate);
    const originalEnd = parseISO(phase.endDate);

    dragStateRef.current = {
      phaseId: phase.id,
      startClientX: e.clientX,
      originalStart,
      originalEnd,
      bizDayDuration: durationBizDays(originalStart, originalEnd),
      didDrag: false,
    };
    setDraggingPhaseId(phase.id);
    setPopover(null);
  };

  const handleBarClick = (e: React.MouseEvent, phase: Phase) => {
    e.stopPropagation();
    if (wasRealDragRef.current) {
      wasRealDragRef.current = false;
      return;
    }
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setPopover({ phase, x: rect.left, y: rect.bottom + 8 });
  };

  if (loading || !job) {
    return (
      <Layout>
        <div className="p-6 text-gray-400">Loading Gantt...</div>
      </Layout>
    );
  }

  const depLines = getDependencyLines();
  const totalHeight = phases.length * ROW_HEIGHT;

  return (
    <Layout>
      <div
        className="p-4 md:p-6 max-w-full"
        style={{ userSelect: draggingPhaseId ? "none" : undefined }}
      >
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2 text-sm text-gray-400 mb-1">
              <Link href="/jobs" className="hover:text-gray-600">Jobs</Link>
              <span>/</span>
              <Link href={`/jobs/${jobId}`} className="hover:text-gray-600">{job.name}</Link>
              <span>/</span>
              <span className="text-gray-700">Gantt</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: job.color }} />
              <h1 className="text-xl font-bold text-gray-900">{job.name} — Gantt Chart</h1>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex bg-gray-100 rounded-lg p-1">
              {(["week", "month", "wholejob"] as ViewMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    viewMode === mode ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {mode === "week" ? "Week" : mode === "month" ? "Month" : "Whole Job"}
                </button>
              ))}
            </div>

            {viewMode !== "wholejob" && (
              <>
                <button onClick={prevPeriod} className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-600 text-sm">←</button>
                <button onClick={() => setCurrentDate(new Date())} className="px-3 py-2 border border-gray-300 rounded-lg text-xs hover:bg-gray-50 text-gray-600">Today</button>
                <button onClick={nextPeriod} className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-600 text-sm">→</button>
              </>
            )}
          </div>
        </div>

        {viewMode !== "wholejob" && (
          <p className="text-sm text-gray-500 mb-4">
            {viewMode === "week"
              ? `${format(viewStart, "MMM d")} – ${format(viewEnd, "MMM d, yyyy")}`
              : format(currentDate, "MMMM yyyy")}
          </p>
        )}

        {phases.filter((p) => p.startDate && p.endDate).length === 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-amber-800 text-sm mb-4">
            ⚠️ No phases have dates set yet. Go to the{" "}
            <Link href={`/jobs/${jobId}`} className="underline font-medium">Phases tab</Link>{" "}
            and add start/end dates to see them on the Gantt chart.
          </div>
        )}

        {/* Saving overlay */}
        {savingDrag && (
          <div className="fixed inset-0 bg-black/20 z-40 flex items-center justify-center pointer-events-none">
            <div className="bg-white rounded-xl shadow-lg px-5 py-3 text-sm font-medium text-gray-700">
              Saving...
            </div>
          </div>
        )}

        {/* Gantt chart */}
        <div
          ref={containerRef}
          className="bg-white rounded-xl shadow-sm overflow-hidden"
          onClick={() => setPopover(null)}
        >
          <div className="flex">
            {/* Sidebar */}
            <div className="shrink-0 bg-white z-10" style={{ width: sidebarWidth }}>
              <div className="h-10 border-b border-gray-100 flex items-center px-3">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Phase</span>
              </div>
              {phases.map((phase) => (
                <div
                  key={phase.id}
                  className="flex items-center px-3 border-b border-gray-50"
                  style={{ height: ROW_HEIGHT }}
                >
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-gray-900 truncate">{phase.name}</p>
                    {phase.startDate && phase.endDate && (
                      <p className="text-[10px] text-gray-400 truncate">
                        {format(parseISO(phase.startDate), "M/d")} – {format(parseISO(phase.endDate), "M/d")}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Sidebar resize handle */}
            <div
              className="w-5 shrink-0 cursor-col-resize z-10 flex items-stretch"
              style={{ touchAction: "none" }}
              onMouseDown={startSidebarDrag}
              onTouchStart={startSidebarTouchDrag}
            >
              <div className="w-1.5 mx-auto bg-gray-200 hover:bg-blue-400 active:bg-blue-500 transition-colors border-x border-gray-200" />
            </div>

            {/* Timeline */}
            <div className="flex-1 overflow-x-auto min-w-0" style={{ WebkitOverflowScrolling: "touch" }}>
              <div style={{ width: timelineWidth, minWidth: "100%" }}>
                {/* Month labels (wholejob view) */}
                {viewMode === "wholejob" && (
                  <div className="relative h-5 border-b border-gray-100 bg-gray-50">
                    {getMonthLabels().map((ml, i) => (
                      <div
                        key={i}
                        className="absolute top-0 h-full flex items-center"
                        style={{ left: ml.left }}
                      >
                        <span className="text-[10px] font-medium text-gray-500 px-1 bg-gray-50 whitespace-nowrap">{ml.label}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Day headers */}
                <div className="relative h-10 border-b border-gray-100 flex" style={{ width: timelineWidth }}>
                  {days.map((day, i) => {
                    const isWeekendDay = skipWeekendDisplay(day);
                    const isToday = isSameDay(day, new Date());
                    return (
                      <div
                        key={i}
                        className={`flex-none border-r border-gray-50 flex flex-col items-center justify-center ${isWeekendDay ? "bg-gray-50" : ""} ${isToday ? "bg-blue-50" : ""}`}
                        style={{ width: dayWidth }}
                      >
                        {dayWidth >= 28 && (
                          <>
                            <span className={`text-[10px] font-medium ${isToday ? "text-blue-600" : isWeekendDay ? "text-gray-300" : "text-gray-400"}`}>
                              {format(day, "EEE").substring(0, 1)}
                            </span>
                            <span className={`text-xs font-semibold ${isToday ? "text-blue-600 font-bold" : isWeekendDay ? "text-gray-400" : "text-gray-600"}`}>
                              {format(day, "d")}
                            </span>
                          </>
                        )}
                        {dayWidth >= 60 && (
                          <span className="text-[10px] text-gray-400">{format(day, "MMM")}</span>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Timeline body */}
                <div
                  ref={timelineRef}
                  className="relative"
                  style={{
                    height: totalHeight,
                    width: timelineWidth,
                    cursor: draggingPhaseId ? "grabbing" : "default",
                  }}
                >
                  {/* Weekend columns */}
                  {days.map((day, i) =>
                    skipWeekendDisplay(day) ? (
                      <div
                        key={i}
                        className="absolute top-0 bottom-0 bg-gray-50/80"
                        style={{ left: i * dayWidth, width: dayWidth }}
                      />
                    ) : null
                  )}

                  {/* Today line */}
                  {(() => {
                    const todayOffset = differenceInDays(new Date(), viewStart);
                    if (todayOffset >= 0 && todayOffset <= totalDays) {
                      return (
                        <div
                          className="absolute top-0 bottom-0 w-px bg-blue-400/60 z-10"
                          style={{ left: todayOffset * dayWidth }}
                        />
                      );
                    }
                    return null;
                  })()}

                  {/* Row dividers */}
                  {phases.map((_, i) => (
                    <div
                      key={i}
                      className="absolute left-0 right-0 border-b border-gray-50"
                      style={{ top: (i + 1) * ROW_HEIGHT - 1 }}
                    />
                  ))}

                  {/* Dependency arrows */}
                  {depLines.length > 0 && (
                    <svg
                      className="absolute inset-0 pointer-events-none"
                      style={{ width: timelineWidth, height: totalHeight }}
                    >
                      {depLines.map((line, i) => {
                        const midX = line.x1 + 16;
                        const path = `M ${line.x1} ${line.y1} H ${midX} V ${line.y2} H ${line.x2}`;
                        return (
                          <path
                            key={i}
                            d={path}
                            fill="none"
                            stroke="#6366f1"
                            strokeWidth="1.5"
                            strokeDasharray="4 2"
                            opacity="0.7"
                          />
                        );
                      })}
                      {depLines.map((line, i) => (
                        <polygon
                          key={`arrow-${i}`}
                          points={`${line.x2},${line.y2} ${line.x2 - 6},${line.y2 - 4} ${line.x2 - 6},${line.y2 + 4}`}
                          fill="#6366f1"
                          opacity="0.7"
                        />
                      ))}
                    </svg>
                  )}

                  {/* Phase bars */}
                  {phases.map((phase, idx) => {
                    const isDraggingThis = draggingPhaseId === phase.id;
                    const preview = isDraggingThis ? dragPreview : null;

                    const bar = preview
                      ? getBarStyle(phase, preview.newStart, preview.newEnd)
                      : getBarStyle(phase);

                    const rowTop = idx * ROW_HEIGHT + (ROW_HEIGHT - BAR_HEIGHT) / 2;

                    if (!bar) {
                      return (
                        <div
                          key={phase.id}
                          className="absolute flex items-center"
                          style={{ top: rowTop, left: 8, height: BAR_HEIGHT }}
                        >
                          <span className="text-[10px] text-gray-400 italic">No dates set</span>
                        </div>
                      );
                    }

                    return (
                      <div key={phase.id}>
                        {/* Ghost bar — shows original position while dragging */}
                        {isDraggingThis && preview && phase.startDate && phase.endDate && (() => {
                          const origBar = getBarStyle(phase);
                          if (!origBar) return null;
                          return (
                            <div
                              className="absolute rounded-md opacity-25 pointer-events-none"
                              style={{
                                top: rowTop,
                                left: origBar.left,
                                width: Math.max(origBar.width, 4),
                                height: BAR_HEIGHT,
                                backgroundColor: origBar.color,
                              }}
                            />
                          );
                        })()}

                        {/* Actual / preview bar */}
                        <button
                          onClick={(e) => handleBarClick(e, phase)}
                          onMouseDown={(e) => handleBarMouseDown(e, phase)}
                          className={`absolute rounded-md flex items-center px-2 text-white text-xs font-medium shadow-sm overflow-hidden transition-opacity ${
                            isDraggingThis
                              ? "cursor-grabbing ring-2 ring-amber-400 ring-offset-1 opacity-95"
                              : "hover:opacity-90 cursor-grab"
                          }`}
                          style={{
                            top: rowTop,
                            left: bar.left,
                            width: Math.max(bar.width, 4),
                            height: BAR_HEIGHT,
                            backgroundColor: bar.color,
                          }}
                        >
                          {bar.width > 40 && (
                            <span className="truncate">{phase.name}</span>
                          )}
                        </button>

                        {/* Drag date tooltip */}
                        {isDraggingThis && preview && (
                          <div
                            className="absolute z-30 bg-gray-900 text-white text-[10px] rounded px-2 py-1 pointer-events-none whitespace-nowrap shadow-lg"
                            style={{
                              top: rowTop - 28,
                              left: Math.max(0, bar.left),
                            }}
                          >
                            {format(preview.newStart, "MMM d")} – {format(preview.newEnd, "MMM d, yyyy")}
                            {preview.deltaDays !== 0 && (
                              <span className="ml-1.5 opacity-70">
                                ({preview.deltaDays > 0 ? "+" : ""}{preview.deltaDays}d)
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Legend */}
          <div className="border-t border-gray-100 px-4 py-3 flex items-center gap-6 flex-wrap">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm bg-slate-400" />
              <span className="text-xs text-gray-500">Not Started</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm bg-blue-500" />
              <span className="text-xs text-gray-500">In Progress</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm bg-green-500" />
              <span className="text-xs text-gray-500">Complete</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-4 h-0.5 bg-indigo-400" style={{ borderBottom: "1.5px dashed #6366f1" }} />
              <span className="text-xs text-gray-500">Dependency</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm bg-amber-400" />
              <span className="text-xs text-gray-500">Dragging</span>
            </div>
            <span className="text-xs text-gray-400 ml-auto italic">Drag bars to reschedule</span>
          </div>
        </div>
      </div>

      {/* Phase popover */}
      {popover && (
        <div
          className="fixed z-50 bg-white rounded-xl shadow-xl border border-gray-200 p-4 w-64"
          style={{ top: Math.min(popover.y, window.innerHeight - 200), left: Math.min(popover.x, window.innerWidth - 280) }}
        >
          <div className="flex items-start justify-between mb-2">
            <h4 className="font-semibold text-gray-900 text-sm">{popover.phase.name}</h4>
            <button onClick={() => setPopover(null)} className="text-gray-400 hover:text-gray-600 text-lg leading-none ml-2">×</button>
          </div>
          {popover.phase.description && (
            <p className="text-xs text-gray-500 mb-2">{popover.phase.description}</p>
          )}
          {popover.phase.startDate && popover.phase.endDate && (
            <div className="text-xs text-gray-700 space-y-1">
              <div className="flex justify-between">
                <span className="text-gray-500">Start</span>
                <span className="font-medium">{format(parseISO(popover.phase.startDate), "MMM d, yyyy")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">End</span>
                <span className="font-medium">{format(parseISO(popover.phase.endDate), "MMM d, yyyy")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Duration</span>
                <span className="font-medium">
                  {differenceInDays(parseISO(popover.phase.endDate), parseISO(popover.phase.startDate)) + 1} days
                </span>
              </div>
            </div>
          )}
          {!popover.phase.startDate && (
            <p className="text-xs text-gray-400 italic">No dates set for this phase</p>
          )}
          <div
            className="w-full h-1.5 rounded-full mt-3"
            style={{ backgroundColor: getPhaseColor(popover.phase) }}
          />
          <Link
            href={`/jobs/${jobId}`}
            className="mt-3 block text-center text-xs text-blue-600 hover:underline"
          >
            Edit dates →
          </Link>
        </div>
      )}

      {/* Cascade confirmation modal */}
      {ganttCascadeModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-2">⚠️ Cascade Phase Dates</h3>
            <p className="text-sm text-gray-600 mb-4">
              Moving <strong>{ganttCascadeModal.phaseName}</strong> will shift{" "}
              <strong>{ganttCascadeModal.updatedPhases.length}</strong> dependent phase(s).
            </p>

            <div className="mb-4 space-y-1">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Phases that will shift:</p>
              {ganttCascadeModal.updatedPhases.map((p) => (
                <div key={p.id} className="text-sm text-gray-700 bg-blue-50 rounded px-3 py-1.5">
                  <span className="font-medium">{p.name}</span>
                  {p.startDate && p.endDate && (
                    <span className="text-xs text-blue-600 ml-2">
                      → {format(parseISO(p.startDate.split("T")[0]), "MMM d")} – {format(parseISO(p.endDate.split("T")[0]), "MMM d, yyyy")}
                    </span>
                  )}
                </div>
              ))}
            </div>

            {ganttCascadeModal.conflicts.length > 0 && (
              <div className="mb-4">
                <p className="text-xs font-semibold text-red-600 uppercase tracking-wide mb-1">
                  ⚠️ Scheduling Conflicts Found:
                </p>
                {ganttCascadeModal.conflicts.map((c, i) => (
                  <div key={i} className="text-sm text-red-700 bg-red-50 rounded px-3 py-1.5 mb-1">
                    {c.userName} on {c.date} is also booked at {c.jobName} ({c.phaseName})
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => { setGanttCascadeModal(null); fetchJob(); }}
                className="flex-1 border border-gray-300 text-gray-700 py-2 px-4 rounded-lg text-sm hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmGanttCascade}
                disabled={savingDrag}
                className="flex-1 bg-blue-600 text-white py-2 px-4 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {savingDrag ? "Saving..." : "Confirm & Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cascade toast */}
      {ganttToast && (
        <div className="fixed bottom-6 right-6 z-50 bg-gray-900 text-white rounded-xl shadow-xl p-4 max-w-xs">
          <p className="font-semibold text-sm mb-1">
            {ganttToast.count} phase{ganttToast.count !== 1 ? "s" : ""} automatically rescheduled
          </p>
          <div className="space-y-0.5">
            {ganttToast.phases.map((p, i) => (
              <p key={i} className="text-xs text-gray-300">
                {p.name}
                {p.startDate && (
                  <span className="text-gray-400 ml-1">
                    → {format(parseISO(p.startDate.split("T")[0]), "MMM d")}
                  </span>
                )}
              </p>
            ))}
          </div>
          <button
            onClick={() => setGanttToast(null)}
            className="mt-2 text-xs text-gray-400 hover:text-white"
          >
            Dismiss
          </button>
        </div>
      )}
    </Layout>
  );
}
