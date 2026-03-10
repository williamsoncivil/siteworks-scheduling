"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Layout from "@/components/Layout";
import Link from "next/link";
import {
  format,
  parseISO,
  differenceInDays,
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

// ─── Types ────────────────────────────────────────────────────────────────────

interface Worker {
  id: string;
  name: string;
  email: string;
}

interface PhaseSchedule {
  user: Worker;
}

interface Phase {
  id: string;
  name: string;
  description: string | null;
  orderIndex: number;
  startDate: string | null;
  endDate: string | null;
  schedules: PhaseSchedule[];
}

interface Job {
  id: string;
  name: string;
  address: string;
  color: string;
  status: string;
  phases: Phase[];
}

interface TimelineData {
  jobs: Job[];
  allWorkers: Worker[];
}

type ViewMode = "week" | "month";

// ─── Color palette (consistent per user) ─────────────────────────────────────

const PALETTE = [
  "#3b82f6", // blue-500
  "#10b981", // emerald-500
  "#f59e0b", // amber-500
  "#ef4444", // red-500
  "#8b5cf6", // violet-500
  "#06b6d4", // cyan-500
  "#f97316", // orange-500
  "#84cc16", // lime-500
  "#ec4899", // pink-500
  "#6366f1", // indigo-500
  "#14b8a6", // teal-500
  "#eab308", // yellow-500
];

function getUserColor(userId: string, allWorkers: Worker[]): string {
  const idx = allWorkers.findIndex((w) => w.id === userId);
  if (idx < 0) return "#94a3b8";
  return PALETTE[idx % PALETTE.length];
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

// ─── Layout constants ─────────────────────────────────────────────────────────

const JOB_LABEL_WIDTH = 200;
const ROW_HEIGHT = 48;
const BAR_HEIGHT = 28;

// ─── Component ────────────────────────────────────────────────────────────────

export default function TimelinePage() {
  const [data, setData] = useState<TimelineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [tooltip, setTooltip] = useState<{
    phase: Phase;
    job: Job;
    x: number;
    y: number;
  } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/schedule/timeline")
      .then((r) => r.json())
      .then((d: TimelineData) => {
        setData(d);
        setLoading(false);
      });
  }, []);

  // ── View range ──────────────────────────────────────────────────────────────
  const getViewRange = useCallback((): {
    viewStart: Date;
    viewEnd: Date;
    dayWidth: number;
  } => {
    if (viewMode === "week") {
      const viewStart = startOfWeek(currentDate, { weekStartsOn: 0 });
      const viewEnd = endOfWeek(currentDate, { weekStartsOn: 0 });
      return { viewStart, viewEnd, dayWidth: 80 };
    }
    // month
    const viewStart = startOfMonth(currentDate);
    const viewEnd = endOfMonth(currentDate);
    return { viewStart, viewEnd, dayWidth: 32 };
  }, [viewMode, currentDate]);

  const { viewStart, viewEnd, dayWidth } = getViewRange();
  const days = eachDayOfInterval({ start: viewStart, end: viewEnd });
  const totalDays = days.length;
  const timelineWidth = totalDays * dayWidth;

  // ── Navigation ──────────────────────────────────────────────────────────────
  const prev = () => {
    if (viewMode === "week") setCurrentDate((d) => subWeeks(d, 1));
    else setCurrentDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  };
  const next = () => {
    if (viewMode === "week") setCurrentDate((d) => addWeeks(d, 1));
    else setCurrentDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1));
  };

  // ── Bar geometry ─────────────────────────────────────────────────────────────
  const getBarStyle = (phase: Phase) => {
    if (!phase.startDate || !phase.endDate) return null;
    const start = parseISO(phase.startDate);
    const end = parseISO(phase.endDate);
    const leftDays = differenceInDays(start, viewStart);
    const widthDays = Math.max(differenceInDays(end, start) + 1, 1);
    const left = leftDays * dayWidth;
    const width = widthDays * dayWidth;
    // Clamp so bars that start/end outside view still show partially
    const clampedLeft = Math.max(left, 0);
    const clampedRight = Math.min(left + width, timelineWidth);
    if (clampedRight <= 0 || clampedLeft >= timelineWidth) return null;
    return { left: clampedLeft, width: clampedRight - clampedLeft, rawLeft: left, rawWidth: width };
  };

  // ── Tooltip handler ──────────────────────────────────────────────────────────
  const handleBarMouseEnter = (
    e: React.MouseEvent,
    phase: Phase,
    job: Job
  ) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setTooltip({ phase, job, x: rect.left, y: rect.bottom + 8 });
  };

  if (loading || !data) {
    return (
      <Layout>
        <div className="p-6 text-gray-400">Loading timeline…</div>
      </Layout>
    );
  }

  const { jobs, allWorkers } = data;

  const periodLabel =
    viewMode === "week"
      ? `${format(viewStart, "MMM d")} – ${format(viewEnd, "MMM d, yyyy")}`
      : format(currentDate, "MMMM yyyy");

  // Today marker
  const todayOffset = differenceInDays(new Date(), viewStart);
  const showToday = todayOffset >= 0 && todayOffset <= totalDays;

  const jobsWithPhases = jobs.filter((j) => j.phases.length > 0);

  return (
    <Layout>
      <div className="p-4 md:p-6 max-w-full" onClick={() => setTooltip(null)}>
        {/* ── Page header ─────────────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">People Timeline</h1>
            <p className="text-sm text-gray-500 mt-0.5">Jobs as rows · phases colored by assigned person</p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* View mode toggle */}
            <div className="flex bg-gray-100 rounded-lg p-1">
              {(["week", "month"] as ViewMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    viewMode === mode
                      ? "bg-white shadow-sm text-gray-900"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {mode === "week" ? "Week" : "Month"}
                </button>
              ))}
            </div>

            {/* Prev / Today / Next */}
            <button
              onClick={prev}
              className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-600 text-sm"
            >
              ←
            </button>
            <span className="text-sm font-medium text-gray-700 px-1 whitespace-nowrap">
              {periodLabel}
            </span>
            <button
              onClick={next}
              className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-600 text-sm"
            >
              →
            </button>
            <button
              onClick={() => setCurrentDate(new Date())}
              className="px-3 py-2 border border-gray-300 rounded-lg text-xs hover:bg-gray-50 text-gray-600"
            >
              Today
            </button>

            <Link
              href="/schedule/gantt"
              className="px-3 py-2 border border-gray-300 rounded-lg text-xs hover:bg-gray-50 text-gray-600"
            >
              ← Gantt
            </Link>
          </div>
        </div>

        {/* ── Person color legend ──────────────────────────────────────────────── */}
        {allWorkers.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm px-4 py-3 mb-4 flex flex-wrap gap-3 items-center">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide mr-1">
              People
            </span>
            {allWorkers.map((worker) => (
              <div key={worker.id} className="flex items-center gap-1.5">
                <div
                  className="w-3 h-3 rounded-sm shrink-0"
                  style={{ backgroundColor: getUserColor(worker.id, allWorkers) }}
                />
                <span className="text-xs text-gray-700">{worker.name}</span>
              </div>
            ))}
            <div className="flex items-center gap-1.5 ml-2">
              <div className="w-3 h-3 rounded-sm bg-slate-300 shrink-0" />
              <span className="text-xs text-gray-500">Unassigned</span>
            </div>
          </div>
        )}

        {/* ── Timeline grid ────────────────────────────────────────────────────── */}
        {jobsWithPhases.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm p-8 text-center text-gray-400">
            No active jobs with phases to display
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <div className="flex">
              {/* ── Sticky job-name column ─────────────────────────────────────── */}
              <div
                className="shrink-0 border-r border-gray-200 bg-white z-10 sticky left-0"
                style={{ width: JOB_LABEL_WIDTH }}
              >
                {/* Column header */}
                <div className="h-10 border-b border-gray-100 flex items-center px-3">
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Job
                  </span>
                </div>

                {/* One row per job */}
                {jobsWithPhases.map((job) => (
                  <div
                    key={job.id}
                    className="flex items-center px-3 border-b border-gray-100"
                    style={{ height: ROW_HEIGHT, backgroundColor: job.color + "14" }}
                  >
                    <div className="w-2 h-2 rounded-full mr-2 shrink-0" style={{ backgroundColor: job.color }} />
                    <Link
                      href={`/jobs/${job.id}`}
                      className="text-xs font-semibold text-gray-900 hover:underline truncate"
                    >
                      {job.name}
                    </Link>
                  </div>
                ))}
              </div>

              {/* ── Scrollable timeline area ───────────────────────────────────── */}
              <div ref={scrollRef} className="flex-1 overflow-x-auto">
                <div style={{ width: timelineWidth, minWidth: "100%" }}>
                  {/* Day header row */}
                  <div
                    className="relative h-10 border-b border-gray-100 flex"
                    style={{ width: timelineWidth }}
                  >
                    {days.map((day, i) => {
                      const weekend = isWeekend(day);
                      const today = isSameDay(day, new Date());
                      return (
                        <div
                          key={i}
                          className={`flex-none border-r border-gray-50 flex flex-col items-center justify-center ${
                            weekend ? "bg-gray-50" : ""
                          } ${today ? "bg-blue-50" : ""}`}
                          style={{ width: dayWidth }}
                        >
                          {dayWidth >= 28 && (
                            <>
                              <span
                                className={`text-[10px] ${
                                  today ? "text-blue-600" : weekend ? "text-gray-300" : "text-gray-400"
                                }`}
                              >
                                {format(day, "EEE").substring(0, 1)}
                              </span>
                              <span
                                className={`text-xs font-semibold ${
                                  today ? "text-blue-600" : weekend ? "text-gray-400" : "text-gray-600"
                                }`}
                              >
                                {format(day, "d")}
                              </span>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Grid body: one row per job */}
                  <div
                    className="relative"
                    style={{ height: ROW_HEIGHT * jobsWithPhases.length, width: timelineWidth }}
                  >
                    {/* Weekend shading */}
                    {days.map((day, i) =>
                      isWeekend(day) ? (
                        <div
                          key={i}
                          className="absolute top-0 bottom-0 bg-gray-50/60"
                          style={{ left: i * dayWidth, width: dayWidth }}
                        />
                      ) : null
                    )}

                    {/* Today line */}
                    {showToday && (
                      <div
                        className="absolute top-0 bottom-0 w-px bg-blue-400/60 z-10"
                        style={{ left: todayOffset * dayWidth }}
                      />
                    )}

                    {/* Row dividers + bars */}
                    {jobsWithPhases.map((job, rowIdx) => {
                      const rowTop = rowIdx * ROW_HEIGHT;
                      const barTop = rowTop + (ROW_HEIGHT - BAR_HEIGHT) / 2;

                      // Phases with dates (render bars)
                      const datedPhases = job.phases.filter(
                        (p) => p.startDate && p.endDate
                      );
                      // Phases without dates (placeholder)
                      const undatedPhases = job.phases.filter(
                        (p) => !p.startDate || !p.endDate
                      );

                      return (
                        <div key={job.id}>
                          {/* Row background tint + divider */}
                          <div
                            className="absolute left-0 right-0 border-b border-gray-100"
                            style={{
                              top: rowTop,
                              height: ROW_HEIGHT,
                              backgroundColor: job.color + "08",
                            }}
                          />

                          {/* Dated phase bars */}
                          {datedPhases.map((phase) => {
                            const bar = getBarStyle(phase);
                            if (!bar) return null;

                            const workers = phase.schedules.map((s) => s.user);
                            const primaryWorker = workers[0] ?? null;
                            const barColor = primaryWorker
                              ? getUserColor(primaryWorker.id, allWorkers)
                              : "#cbd5e1"; // slate-300 = unassigned
                            const extraWorkers = workers.slice(1);

                            return (
                              <button
                                key={phase.id}
                                className="absolute rounded text-white text-xs font-medium shadow-sm hover:opacity-90 transition-opacity overflow-hidden flex items-center gap-1 px-1.5 group"
                                style={{
                                  top: barTop,
                                  left: bar.left,
                                  width: Math.max(bar.width, 4),
                                  height: BAR_HEIGHT,
                                  backgroundColor: barColor,
                                }}
                                onMouseEnter={(e) => handleBarMouseEnter(e, phase, job)}
                                onMouseLeave={() => setTooltip(null)}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  // keep tooltip visible on click
                                  handleBarMouseEnter(e, phase, job);
                                }}
                              >
                                {/* Phase name */}
                                {bar.width > 50 && (
                                  <span className="truncate text-[11px] font-semibold drop-shadow-sm">
                                    {phase.name}
                                  </span>
                                )}

                                {/* Extra worker initials */}
                                {bar.width > 80 &&
                                  extraWorkers.slice(0, 3).map((w) => (
                                    <span
                                      key={w.id}
                                      className="shrink-0 text-[9px] font-bold rounded-full px-1 py-0.5 leading-none"
                                      style={{ backgroundColor: "rgba(0,0,0,0.25)" }}
                                      title={w.name}
                                    >
                                      {getInitials(w.name)}
                                    </span>
                                  ))}
                              </button>
                            );
                          })}

                          {/* Undated phases: thin placeholder strip at bottom of row */}
                          {undatedPhases.length > 0 && (
                            <div
                              className="absolute left-0 right-0 flex items-center gap-1 px-2 opacity-40 pointer-events-none"
                              style={{ top: rowTop + ROW_HEIGHT - 10, height: 8 }}
                            >
                              {undatedPhases.map((p) => (
                                <div
                                  key={p.id}
                                  className="h-1.5 rounded-full bg-slate-300 flex-1 min-w-0"
                                  title={`${p.name} (no dates)`}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Tooltip ──────────────────────────────────────────────────────────── */}
      {tooltip && (
        <div
          className="fixed z-50 bg-white rounded-xl shadow-xl border border-gray-200 p-4 w-72 pointer-events-none"
          style={{
            top: Math.min(tooltip.y, (typeof window !== "undefined" ? window.innerHeight : 800) - 240),
            left: Math.min(tooltip.x, (typeof window !== "undefined" ? window.innerWidth : 1200) - 300),
          }}
        >
          <div className="mb-1">
            <h4 className="font-semibold text-gray-900 text-sm">{tooltip.phase.name}</h4>
            <p className="text-xs text-blue-600 font-medium">{tooltip.job.name}</p>
          </div>

          {tooltip.phase.description && (
            <p className="text-xs text-gray-500 mb-2">{tooltip.phase.description}</p>
          )}

          {/* Date range */}
          {tooltip.phase.startDate && tooltip.phase.endDate ? (
            <div className="text-xs text-gray-700 space-y-1 mb-2">
              <div className="flex justify-between">
                <span className="text-gray-500">Start</span>
                <span className="font-medium">
                  {format(parseISO(tooltip.phase.startDate), "MMM d, yyyy")}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">End</span>
                <span className="font-medium">
                  {format(parseISO(tooltip.phase.endDate), "MMM d, yyyy")}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Duration</span>
                <span className="font-medium">
                  {differenceInDays(
                    parseISO(tooltip.phase.endDate),
                    parseISO(tooltip.phase.startDate)
                  ) + 1}
                  d
                </span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-gray-400 italic mb-2">No dates set</p>
          )}

          {/* Assigned people */}
          {tooltip.phase.schedules.length > 0 ? (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                Assigned
              </p>
              <div className="flex flex-col gap-1">
                {tooltip.phase.schedules.map((s) => (
                  <div key={s.user.id} className="flex items-center gap-2">
                    <div
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{
                        backgroundColor: data
                          ? getUserColor(s.user.id, data.allWorkers)
                          : "#94a3b8",
                      }}
                    />
                    <span className="text-xs text-gray-700">{s.user.name}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-xs text-gray-400 italic">No workers assigned</p>
          )}
        </div>
      )}
    </Layout>
  );
}
