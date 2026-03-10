"use client";

import { useEffect, useState, useRef, useCallback } from "react";
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

interface Phase {
  id: string;
  name: string;
  description: string | null;
  orderIndex: number;
  startDate: string | null;
  endDate: string | null;
  dependsOnId: string | null;
}

interface JobWithPhases {
  id: string;
  name: string;
  address: string;
  color: string;
  status: string;
  phases: Phase[];
  visible: boolean;
}

type ViewMode = "week" | "month" | "wholejob";

const ROW_HEIGHT = 44;
const JOB_HEADER_HEIGHT = 36;
const BAR_HEIGHT = 26;
const SIDEBAR_WIDTH = 220;

function getPhaseColor(phase: Phase): string {
  if (!phase.startDate || !phase.endDate) return "#94a3b8";
  const now = new Date();
  const start = parseISO(phase.startDate);
  const end = parseISO(phase.endDate);
  if (end < now) return "#22c55e";
  if (start <= now && end >= now) return "#3b82f6";
  return "#94a3b8";
}

export default function MasterGanttPage() {
  const [jobs, setJobs] = useState<JobWithPhases[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [popover, setPopover] = useState<{ phase: Phase; jobName: string; x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/jobs")
      .then((r) => r.json())
      .then(async (jobList: JobWithPhases[]) => {
        const activeJobs = jobList.filter((j) => j.status === "ACTIVE");
        const withPhases = await Promise.all(
          activeJobs.map(async (job) => {
            const phases = await fetch(`/api/jobs/${job.id}/phases`).then((r) => r.json());
            return { ...job, phases, visible: true };
          })
        );
        setJobs(withPhases);
        setLoading(false);
      });
  }, []);

  const visibleJobs = jobs.filter((j) => j.visible);

  const toggleJobVisibility = (jobId: string) => {
    setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, visible: !j.visible } : j)));
  };

  const allPhases = visibleJobs.flatMap((j) => j.phases);

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
    // Whole job
    const datedPhases = allPhases.filter((p) => p.startDate && p.endDate);
    if (datedPhases.length === 0) {
      const viewStart = startOfMonth(currentDate);
      const viewEnd = endOfMonth(addWeeks(currentDate, 8));
      return { viewStart, viewEnd, dayWidth: 20 };
    }
    const starts = datedPhases.map((p) => parseISO(p.startDate!));
    const ends = datedPhases.map((p) => parseISO(p.endDate!));
    const viewStart = addDays(starts.reduce((a, b) => (a < b ? a : b)), -2);
    const viewEnd = addDays(ends.reduce((a, b) => (a > b ? a : b)), 2);
    const totalDays = Math.max(differenceInDays(viewEnd, viewStart) + 1, 1);
    const containerW = containerRef.current?.clientWidth ?? 800;
    const availableW = containerW - SIDEBAR_WIDTH;
    const dayWidth = Math.max(16, Math.floor(availableW / totalDays));
    return { viewStart, viewEnd, dayWidth };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, currentDate, JSON.stringify(allPhases.map((p) => p.id))]);

  const { viewStart, viewEnd, dayWidth } = getViewRange();
  const totalDays = Math.max(differenceInDays(viewEnd, viewStart) + 1, 1);
  const timelineWidth = totalDays * dayWidth;
  const days = eachDayOfInterval({ start: viewStart, end: viewEnd });

  const prevPeriod = () => {
    if (viewMode === "week") setCurrentDate((d) => subWeeks(d, 1));
    else if (viewMode === "month") setCurrentDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  };

  const nextPeriod = () => {
    if (viewMode === "week") setCurrentDate((d) => addWeeks(d, 1));
    else if (viewMode === "month") setCurrentDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1));
  };

  const getBarStyle = (phase: Phase) => {
    if (!phase.startDate || !phase.endDate) return null;
    const start = parseISO(phase.startDate);
    const end = parseISO(phase.endDate);
    const leftDays = differenceInDays(start, viewStart);
    const widthDays = Math.max(differenceInDays(end, start) + 1, 1);
    return {
      left: leftDays * dayWidth,
      width: widthDays * dayWidth,
      color: getPhaseColor(phase),
    };
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

  // Build flat rows with row types
  type RowItem =
    | { type: "job-header"; job: JobWithPhases; rowIndex: number }
    | { type: "phase"; phase: Phase; job: JobWithPhases; rowIndex: number };

  const rows: RowItem[] = [];
  let rowOffset = 0;
  visibleJobs.forEach((job) => {
    rows.push({ type: "job-header", job, rowIndex: rowOffset });
    rowOffset++;
    job.phases.forEach((phase) => {
      rows.push({ type: "phase", phase, job, rowIndex: rowOffset });
      rowOffset++;
    });
  });

  const totalHeight = rows.reduce((acc, row) => {
    return acc + (row.type === "job-header" ? JOB_HEADER_HEIGHT : ROW_HEIGHT);
  }, 0);

  // Calculate Y positions for each row
  const rowYPositions: number[] = [];
  let currentY = 0;
  rows.forEach((row) => {
    rowYPositions.push(currentY);
    currentY += row.type === "job-header" ? JOB_HEADER_HEIGHT : ROW_HEIGHT;
  });

  // Dependency arrows
  const getDependencyLines = () => {
    const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
    rows.forEach((row, rowIdx) => {
      if (row.type !== "phase") return;
      const { phase } = row;
      if (!phase.dependsOnId) return;

      // Find parent phase in rows
      const parentRowIdx = rows.findIndex(
        (r) => r.type === "phase" && r.phase.id === phase.dependsOnId
      );
      if (parentRowIdx < 0) return;

      const parentRow = rows[parentRowIdx];
      if (parentRow.type !== "phase") return;

      const childBar = getBarStyle(phase);
      const parentBar = getBarStyle(parentRow.phase);
      if (!childBar || !parentBar) return;

      const parentY = rowYPositions[parentRowIdx] + ROW_HEIGHT / 2;
      const childY = rowYPositions[rowIdx] + ROW_HEIGHT / 2;

      lines.push({
        x1: parentBar.left + parentBar.width,
        y1: parentY,
        x2: childBar.left,
        y2: childY,
      });
    });
    return lines;
  };

  const handleBarClick = (e: React.MouseEvent, phase: Phase, jobName: string) => {
    e.stopPropagation();
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setPopover({ phase, jobName, x: rect.left, y: rect.bottom + 8 });
  };

  if (loading) {
    return (
      <Layout>
        <div className="p-6 text-gray-400">Loading master Gantt...</div>
      </Layout>
    );
  }

  const depLines = getDependencyLines();

  return (
    <Layout>
      <div className="p-4 md:p-6 max-w-full" onClick={() => setPopover(null)}>
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Master Gantt Chart</h1>
            <p className="text-sm text-gray-500 mt-0.5">All active jobs</p>
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
                  {mode === "week" ? "Week" : mode === "month" ? "Month" : "All Jobs"}
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

            <Link
              href="/schedule"
              className="px-3 py-2 border border-gray-300 rounded-lg text-xs hover:bg-gray-50 text-gray-600"
            >
              ← Calendar View
            </Link>
          </div>
        </div>

        {/* Job filter */}
        <div className="flex gap-2 flex-wrap mb-4">
          <span className="text-xs font-medium text-gray-500 self-center">Show/hide jobs:</span>
          {jobs.map((job) => (
            <button
              key={job.id}
              onClick={() => toggleJobVisibility(job.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                job.visible
                  ? "border-transparent text-white"
                  : "border-gray-300 text-gray-500 bg-white"
              }`}
              style={job.visible ? { backgroundColor: job.color } : {}}
            >
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: job.visible ? "white" : job.color }}
              />
              {job.name}
            </button>
          ))}
        </div>

        {visibleJobs.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm p-8 text-center text-gray-400">
            No active jobs to display
          </div>
        ) : (
          <div
            ref={containerRef}
            className="bg-white rounded-xl shadow-sm overflow-hidden"
          >
            <div className="flex">
              {/* Left sidebar */}
              <div
                className="shrink-0 border-r border-gray-200 bg-white z-10"
                style={{ width: SIDEBAR_WIDTH }}
              >
                {/* Header spacer */}
                {viewMode === "wholejob" && <div className="h-5 border-b border-gray-100" />}
                <div className="h-10 border-b border-gray-100 flex items-center px-3">
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Job / Phase</span>
                </div>

                {/* Rows */}
                {rows.map((row, i) => {
                  if (row.type === "job-header") {
                    return (
                      <div
                        key={`job-${row.job.id}`}
                        className="flex items-center px-3 border-b border-gray-200"
                        style={{ height: JOB_HEADER_HEIGHT, backgroundColor: row.job.color + "18" }}
                      >
                        <div className="w-2 h-2 rounded-full mr-2 shrink-0" style={{ backgroundColor: row.job.color }} />
                        <Link
                          href={`/jobs/${row.job.id}`}
                          className="text-xs font-bold text-gray-900 hover:underline truncate"
                        >
                          {row.job.name}
                        </Link>
                      </div>
                    );
                  }
                  return (
                    <div
                      key={`phase-${row.phase.id}`}
                      className="flex items-center px-3 pl-6 border-b border-gray-50"
                      style={{ height: ROW_HEIGHT }}
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-gray-800 truncate">{row.phase.name}</p>
                        {row.phase.startDate && row.phase.endDate && (
                          <p className="text-[10px] text-gray-400 truncate">
                            {format(parseISO(row.phase.startDate), "M/d")} – {format(parseISO(row.phase.endDate), "M/d")}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Timeline */}
              <div className="flex-1 overflow-x-auto">
                <div style={{ width: timelineWidth, minWidth: "100%" }}>
                  {/* Month labels for whole job */}
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
                      const isWeekendDay = isWeekend(day);
                      const isToday = isSameDay(day, new Date());
                      return (
                        <div
                          key={i}
                          className={`flex-none border-r border-gray-50 flex flex-col items-center justify-center ${isWeekendDay ? "bg-gray-50" : ""} ${isToday ? "bg-blue-50" : ""}`}
                          style={{ width: dayWidth }}
                        >
                          {dayWidth >= 28 && (
                            <>
                              <span className={`text-[10px] ${isToday ? "text-blue-600" : isWeekendDay ? "text-gray-300" : "text-gray-400"}`}>
                                {format(day, "EEE").substring(0, 1)}
                              </span>
                              <span className={`text-xs font-semibold ${isToday ? "text-blue-600" : isWeekendDay ? "text-gray-400" : "text-gray-600"}`}>
                                {format(day, "d")}
                              </span>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Timeline body */}
                  <div className="relative" style={{ height: totalHeight, width: timelineWidth }}>
                    {/* Weekend columns */}
                    {days.map((day, i) =>
                      isWeekend(day) ? (
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

                    {/* Job header row backgrounds */}
                    {rows.map((row, i) => {
                      if (row.type !== "job-header") return null;
                      return (
                        <div
                          key={`job-bg-${row.job.id}`}
                          className="absolute left-0 right-0 border-b border-gray-200"
                          style={{
                            top: rowYPositions[i],
                            height: JOB_HEADER_HEIGHT,
                            backgroundColor: row.job.color + "12",
                          }}
                        />
                      );
                    })}

                    {/* Row dividers for phases */}
                    {rows.map((row, i) => {
                      if (row.type !== "phase") return null;
                      return (
                        <div
                          key={`divider-${i}`}
                          className="absolute left-0 right-0 border-b border-gray-50"
                          style={{ top: rowYPositions[i] + ROW_HEIGHT - 1 }}
                        />
                      );
                    })}

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
                              opacity="0.6"
                            />
                          );
                        })}
                        {depLines.map((line, i) => (
                          <polygon
                            key={`arrow-${i}`}
                            points={`${line.x2},${line.y2} ${line.x2 - 5},${line.y2 - 3} ${line.x2 - 5},${line.y2 + 3}`}
                            fill="#6366f1"
                            opacity="0.6"
                          />
                        ))}
                      </svg>
                    )}

                    {/* Phase bars */}
                    {rows.map((row, i) => {
                      if (row.type !== "phase") return null;
                      const { phase, job } = row;
                      const bar = getBarStyle(phase);
                      const rowTop = rowYPositions[i];
                      const barTop = rowTop + (ROW_HEIGHT - BAR_HEIGHT) / 2;

                      if (!bar) return null;

                      return (
                        <button
                          key={phase.id}
                          onClick={(e) => handleBarClick(e, phase, job.name)}
                          className="absolute rounded flex items-center px-1.5 text-white text-xs font-medium shadow-sm hover:opacity-90 transition-opacity overflow-hidden"
                          style={{
                            top: barTop,
                            left: bar.left,
                            width: Math.max(bar.width, 4),
                            height: BAR_HEIGHT,
                            backgroundColor: bar.color,
                          }}
                        >
                          {bar.width > 40 && <span className="truncate">{phase.name}</span>}
                        </button>
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
            </div>
          </div>
        )}
      </div>

      {/* Popover */}
      {popover && (
        <div
          className="fixed z-50 bg-white rounded-xl shadow-xl border border-gray-200 p-4 w-64"
          style={{
            top: Math.min(popover.y, window.innerHeight - 220),
            left: Math.min(popover.x, window.innerWidth - 280),
          }}
        >
          <div className="flex items-start justify-between mb-1">
            <h4 className="font-semibold text-gray-900 text-sm">{popover.phase.name}</h4>
            <button onClick={() => setPopover(null)} className="text-gray-400 hover:text-gray-600 text-lg leading-none ml-2">×</button>
          </div>
          <p className="text-xs text-gray-400 mb-2">{popover.jobName}</p>
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
                  {differenceInDays(parseISO(popover.phase.endDate), parseISO(popover.phase.startDate)) + 1}d
                </span>
              </div>
            </div>
          )}
          {!popover.phase.startDate && (
            <p className="text-xs text-gray-400 italic">No dates set</p>
          )}
        </div>
      )}
    </Layout>
  );
}
