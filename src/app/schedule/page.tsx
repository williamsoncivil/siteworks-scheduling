"use client";

import { useEffect, useState } from "react";
import Layout from "@/components/Layout";
import Link from "next/link";
import {
  format,
  startOfWeek,
  endOfWeek,
  addWeeks,
  subWeeks,
  eachDayOfInterval,
  parseISO,
  isSameDay,
  startOfMonth,
  endOfMonth,
  eachWeekOfInterval,
} from "date-fns";

interface ScheduleEntry {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  notes: string | null;
  job: { id: string; name: string; color: string };
  phase: { id: string; name: string } | null;
  user: { id: string; name: string; role: string };
}

interface User {
  id: string;
  name: string;
}

export default function SchedulePage() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [entries, setEntries] = useState<ScheduleEntry[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [filterUserId, setFilterUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"week" | "month">("week");

  const weekStart = startOfWeek(currentDate, { weekStartsOn: 0 });
  const weekEnd = endOfWeek(currentDate, { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start: weekStart, end: weekEnd });

  useEffect(() => {
    fetch("/api/people").then((r) => r.json()).then((d) => setUsers(d));
  }, []);

  useEffect(() => {
    setLoading(true);
    const weekStr = format(weekStart, "yyyy-MM-dd");
    const url = filterUserId
      ? `/api/schedule?week=${weekStr}&userId=${filterUserId}`
      : `/api/schedule?week=${weekStr}`;

    fetch(url).then((r) => r.json()).then((d) => {
      setEntries(d);
      setLoading(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDate, filterUserId]);

  const getEntriesForDay = (day: Date) =>
    entries.filter((e) => isSameDay(parseISO(e.date), day));

  const prevPeriod = () => setCurrentDate(subWeeks(currentDate, 1));
  const nextPeriod = () => setCurrentDate(addWeeks(currentDate, 1));

  // For month view
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const weeksInMonth = eachWeekOfInterval(
    { start: monthStart, end: monthEnd },
    { weekStartsOn: 0 }
  );

  return (
    <Layout>
      <div className="p-6 max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Schedule</h1>
            <p className="text-gray-500 text-sm mt-0.5">
              {viewMode === "week"
                ? `${format(weekStart, "MMM d")} – ${format(weekEnd, "MMM d, yyyy")}`
                : format(currentDate, "MMMM yyyy")}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Gantt View link */}
            <Link
              href="/schedule/gantt"
              className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              📊 Gantt View
            </Link>

            {/* View toggle */}
            <div className="flex bg-gray-100 rounded-lg p-1">
              <button
                onClick={() => setViewMode("week")}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${viewMode === "week" ? "bg-white shadow-sm text-gray-900" : "text-gray-500"}`}
              >
                Week
              </button>
              <button
                onClick={() => setViewMode("month")}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${viewMode === "month" ? "bg-white shadow-sm text-gray-900" : "text-gray-500"}`}
              >
                Month
              </button>
            </div>

            {/* Navigation */}
            <button onClick={prevPeriod} className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-600">
              ←
            </button>
            <button onClick={() => setCurrentDate(new Date())} className="px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 text-gray-600">
              Today
            </button>
            <button onClick={nextPeriod} className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-600">
              →
            </button>
          </div>
        </div>

        {/* Filter */}
        <div className="mb-4">
          <select
            value={filterUserId}
            onChange={(e) => setFilterUserId(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="">All People</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="text-gray-400 text-center py-12">Loading...</div>
        ) : viewMode === "week" ? (
          /* Weekly View */
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <div className="grid grid-cols-7 border-b border-gray-100">
              {days.map((day) => (
                <div key={day.toISOString()} className="p-3 text-center border-r last:border-r-0 border-gray-100">
                  <p className="text-xs font-medium text-gray-400 uppercase">{format(day, "EEE")}</p>
                  <p className={`text-lg font-semibold mt-0.5 ${
                    isSameDay(day, new Date()) ? "text-blue-600" : "text-gray-700"
                  }`}>
                    {format(day, "d")}
                  </p>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 min-h-64">
              {days.map((day) => {
                const dayEntries = getEntriesForDay(day);
                const isToday = isSameDay(day, new Date());
                return (
                  <div key={day.toISOString()} className={`p-2 border-r last:border-r-0 border-gray-100 min-h-32 ${isToday ? "bg-blue-50/50" : ""}`}>
                    {dayEntries.map((entry) => (
                      <Link key={entry.id} href={`/jobs/${entry.job.id}`}>
                        <div
                          className="mb-1.5 p-2 rounded-lg text-white text-xs cursor-pointer hover:opacity-90 transition-opacity"
                          style={{ backgroundColor: entry.job.color }}
                        >
                          <p className="font-semibold truncate">{entry.job.name}</p>
                          <p className="opacity-80 truncate">{entry.user.name}</p>
                          <p className="opacity-70">{entry.startTime}–{entry.endTime}</p>
                        </div>
                      </Link>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          /* Month View */
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <div className="grid grid-cols-7 border-b border-gray-100">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                <div key={d} className="p-3 text-center">
                  <p className="text-xs font-medium text-gray-400 uppercase">{d}</p>
                </div>
              ))}
            </div>
            {weeksInMonth.map((weekStart) => {
              const weekDays = eachDayOfInterval({
                start: weekStart,
                end: endOfWeek(weekStart, { weekStartsOn: 0 }),
              });
              return (
                <div key={weekStart.toISOString()} className="grid grid-cols-7 border-b last:border-b-0 border-gray-100">
                  {weekDays.map((day) => {
                    const dayEntries = getEntriesForDay(day);
                    const inMonth = day.getMonth() === currentDate.getMonth();
                    const isToday = isSameDay(day, new Date());
                    return (
                      <div key={day.toISOString()} className={`p-2 border-r last:border-r-0 border-gray-100 min-h-24 ${!inMonth ? "bg-gray-50" : ""} ${isToday ? "bg-blue-50/50" : ""}`}>
                        <p className={`text-xs font-medium mb-1 ${!inMonth ? "text-gray-300" : isToday ? "text-blue-600 font-bold" : "text-gray-600"}`}>
                          {format(day, "d")}
                        </p>
                        {dayEntries.slice(0, 3).map((entry) => (
                          <Link key={entry.id} href={`/jobs/${entry.job.id}`}>
                            <div
                              className="mb-0.5 px-1.5 py-0.5 rounded text-white text-xs truncate cursor-pointer hover:opacity-90"
                              style={{ backgroundColor: entry.job.color }}
                            >
                              {entry.user.name.split(" ")[0]} · {entry.job.name}
                            </div>
                          </Link>
                        ))}
                        {dayEntries.length > 3 && (
                          <p className="text-xs text-gray-400">+{dayEntries.length - 3} more</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Layout>
  );
}
