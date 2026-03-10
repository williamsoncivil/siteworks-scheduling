"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Layout from "@/components/Layout";
import Link from "next/link";
import {
  format,
  parseISO,
  startOfWeek,
  endOfWeek,
  eachWeekOfInterval,
  isSameWeek,
  addDays,
  subDays,
} from "date-fns";

interface ScheduleEntry {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  notes: string | null;
  job: { id: string; name: string; color: string };
  phase: { id: string; name: string } | null;
}

interface ConflictGroup {
  date: string;
  entries: ScheduleEntry[];
}

interface UserDetail {
  id: string;
  name: string;
  email: string;
  role: string;
  phone: string | null;
  schedules: ScheduleEntry[];
  conflicts: ConflictGroup[];
}

const roleBadge: Record<string, string> = {
  ADMIN: "bg-purple-100 text-purple-800",
  EMPLOYEE: "bg-blue-100 text-blue-800",
  SUBCONTRACTOR: "bg-orange-100 text-orange-800",
};

export default function PersonPage() {
  const params = useParams();
  const userId = params.id as string;

  const [user, setUser] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [fromDate, setFromDate] = useState(format(subDays(new Date(), 30), "yyyy-MM-dd"));
  const [toDate, setToDate] = useState(format(addDays(new Date(), 90), "yyyy-MM-dd"));

  useEffect(() => {
    fetch(`/api/people/${userId}`)
      .then((r) => r.json())
      .then((d) => {
        setUser(d);
        setLoading(false);
      });
  }, [userId]);

  if (loading || !user) {
    return (
      <Layout>
        <div className="p-6 text-gray-400">Loading...</div>
      </Layout>
    );
  }

  // Filter schedules by date range
  const filteredSchedules = user.schedules.filter((entry) => {
    const d = parseISO(entry.date);
    return d >= parseISO(fromDate) && d <= parseISO(toDate);
  });

  // Detect conflict dates in filtered range
  const conflictDates = new Set(
    user.conflicts
      .filter((c) => {
        const d = parseISO(c.date);
        return d >= parseISO(fromDate) && d <= parseISO(toDate);
      })
      .map((c) => c.date)
  );

  const conflictsInRange = user.conflicts.filter((c) => {
    const d = parseISO(c.date);
    return d >= parseISO(fromDate) && d <= parseISO(toDate);
  });

  // Group by week
  const weekMap: Record<string, ScheduleEntry[]> = {};
  for (const entry of filteredSchedules) {
    const weekKey = format(startOfWeek(parseISO(entry.date), { weekStartsOn: 0 }), "yyyy-MM-dd");
    if (!weekMap[weekKey]) weekMap[weekKey] = [];
    weekMap[weekKey].push(entry);
  }
  const weeks = Object.keys(weekMap).sort();

  return (
    <Layout>
      <div className="p-6 max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Link href="/people" className="text-gray-400 hover:text-gray-600 text-sm">← People</Link>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-full bg-slate-800 flex items-center justify-center text-white font-bold text-xl shrink-0">
              {user.name[0]}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-xl font-bold text-gray-900">{user.name}</h1>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${roleBadge[user.role] || roleBadge.EMPLOYEE}`}>
                  {user.role}
                </span>
              </div>
              <p className="text-gray-500 text-sm mt-1">{user.email}</p>
              {user.phone && <p className="text-gray-400 text-sm">{user.phone}</p>}
              <p className="text-gray-400 text-xs mt-1">{user.schedules.length} total schedule entries</p>
            </div>
          </div>
        </div>

        {/* Conflict Banner */}
        {conflictsInRange.length > 0 && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-red-600">⚠️</span>
              <h3 className="font-semibold text-red-800">
                {conflictsInRange.length} scheduling conflict{conflictsInRange.length !== 1 ? "s" : ""} found
              </h3>
            </div>
            <div className="space-y-1">
              {conflictsInRange.map((conflict, i) => (
                <p key={i} className="text-sm text-red-700">
                  <span className="font-medium">{format(parseISO(conflict.date), "EEE, MMM d yyyy")}</span>:{" "}
                  {conflict.entries.map((e) => `${e.job.name} (${e.startTime}–${e.endTime})`).join(" & ")}
                </p>
              ))}
            </div>
          </div>
        )}

        {/* Date Range Filter */}
        <div className="flex gap-3 mb-4 items-center">
          <div>
            <label className="block text-xs text-gray-500 mb-1">From</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">To</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Schedule grouped by week */}
        {weeks.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm p-8 text-center text-gray-400">
            No schedule entries in this date range
          </div>
        ) : (
          <div className="space-y-4">
            {weeks.map((weekKey) => {
              const weekEntries = weekMap[weekKey].sort((a, b) =>
                a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime)
              );
              const weekStart = parseISO(weekKey);
              const weekEnd = endOfWeek(weekStart, { weekStartsOn: 0 });

              return (
                <div key={weekKey} className="bg-white rounded-xl shadow-sm overflow-hidden">
                  <div className="bg-gray-50 px-4 py-2 border-b border-gray-100">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      {format(weekStart, "MMM d")} – {format(weekEnd, "MMM d, yyyy")}
                    </p>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {weekEntries.map((entry) => {
                      const entryDateStr = format(parseISO(entry.date), "yyyy-MM-dd");
                      const hasConflict = conflictDates.has(entryDateStr);
                      return (
                        <Link key={entry.id} href={`/jobs/${entry.job.id}`}>
                          <div className={`flex items-center gap-4 p-4 hover:bg-gray-50 transition-colors cursor-pointer ${hasConflict ? "bg-red-50 hover:bg-red-100" : ""}`}>
                            <div className="w-1.5 h-12 rounded-full shrink-0" style={{ backgroundColor: entry.job.color }} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="font-semibold text-sm text-gray-900 truncate">{entry.job.name}</p>
                                {hasConflict && (
                                  <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-medium shrink-0">
                                    CONFLICT
                                  </span>
                                )}
                              </div>
                              {entry.phase && <p className="text-xs text-gray-500">{entry.phase.name}</p>}
                              {entry.notes && <p className="text-xs text-gray-400 truncate">{entry.notes}</p>}
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-sm font-medium text-gray-700">{format(parseISO(entry.date), "EEE, MMM d")}</p>
                              <p className="text-xs text-gray-400">{entry.startTime} – {entry.endTime}</p>
                            </div>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Layout>
  );
}
