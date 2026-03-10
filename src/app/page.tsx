"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Layout from "@/components/Layout";
import Link from "next/link";
import { format, startOfWeek, endOfWeek, isToday, parseISO, addDays } from "date-fns";

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

interface ConflictGroup {
  date: string;
  entries: ScheduleEntry[];
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default function DashboardPage() {
  const { data: session } = useSession();
  const [todayEntries, setTodayEntries] = useState<ScheduleEntry[]>([]);
  const [weekEntries, setWeekEntries] = useState<ScheduleEntry[]>([]);
  const [allWeekEntries, setAllWeekEntries] = useState<ScheduleEntry[]>([]);
  const [conflicts, setConflicts] = useState<ConflictGroup[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session?.user) return;

    const today = new Date();
    const todayStr = format(today, "yyyy-MM-dd");
    const weekStart = format(startOfWeek(today, { weekStartsOn: 0 }), "yyyy-MM-dd");

    Promise.all([
      fetch(`/api/schedule?userId=${session.user.id}&date=${todayStr}`).then((r) => r.json()),
      fetch(`/api/schedule?userId=${session.user.id}&week=${weekStart}`).then((r) => r.json()),
      fetch(`/api/schedule?week=${weekStart}`).then((r) => r.json()),
    ]).then(([todayData, weekData, allWeekData]) => {
      setTodayEntries(todayData);
      setWeekEntries(weekData.filter((e: ScheduleEntry) => !isToday(parseISO(e.date))));
      setAllWeekEntries(allWeekData);

      // Detect double-bookings across all users this week
      const dateUserMap: Record<string, Record<string, ScheduleEntry[]>> = {};
      for (const entry of allWeekData) {
        const dateKey = format(parseISO(entry.date), "yyyy-MM-dd");
        if (!dateUserMap[dateKey]) dateUserMap[dateKey] = {};
        if (!dateUserMap[dateKey][entry.user.id]) dateUserMap[dateKey][entry.user.id] = [];
        dateUserMap[dateKey][entry.user.id].push(entry);
      }

      const found: ConflictGroup[] = [];
      for (const [date, userMap] of Object.entries(dateUserMap)) {
        for (const [, entries] of Object.entries(userMap)) {
          if (entries.length > 1) {
            found.push({ date, entries });
          }
        }
      }
      setConflicts(found);
      setLoading(false);
    });
  }, [session]);

  if (!session) return null;

  const today = new Date();

  return (
    <Layout>
      <div className="p-6 max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">
            {getGreeting()}, {session.user.name.split(" ")[0]} 👋
          </h1>
          <p className="text-gray-500 mt-1">{format(today, "EEEE, MMMM d, yyyy")}</p>
        </div>

        {/* Conflict Warnings */}
        {conflicts.length > 0 && (
          <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-xl">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-yellow-600 text-lg">⚠️</span>
              <h3 className="font-semibold text-yellow-800">
                {conflicts.length} scheduling conflict{conflicts.length > 1 ? "s" : ""} this week
              </h3>
            </div>
            <div className="space-y-2">
              {conflicts.map((conflict, i) => (
                <div key={i} className="text-sm text-yellow-700">
                  <span className="font-medium">{conflict.entries[0].user.name}</span> is double-booked on{" "}
                  <span className="font-medium">{format(parseISO(conflict.date), "EEE, MMM d")}</span>:{" "}
                  {conflict.entries.map((e) => e.job.name).join(" & ")}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Today's Schedule */}
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Today&apos;s Schedule</h2>
          {loading ? (
            <div className="bg-white rounded-xl shadow-sm p-6 text-gray-400">Loading...</div>
          ) : todayEntries.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm p-6 text-gray-400 text-center">
              No scheduled work today
            </div>
          ) : (
            <div className="space-y-3">
              {todayEntries.map((entry) => (
                <Link key={entry.id} href={`/jobs/${entry.job.id}`}>
                  <div className="bg-white rounded-xl shadow-sm p-4 border-l-4 hover:shadow-md transition-shadow cursor-pointer" style={{ borderLeftColor: entry.job.color }}>
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-semibold text-gray-900">{entry.job.name}</p>
                        {entry.phase && <p className="text-sm text-gray-500">{entry.phase.name}</p>}
                        {entry.notes && <p className="text-sm text-gray-400 mt-1">{entry.notes}</p>}
                      </div>
                      <span className="text-sm text-gray-500 ml-4 shrink-0">
                        {entry.startTime} – {entry.endTime}
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* This Week Upcoming */}
        {weekEntries.length > 0 && (
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Coming Up This Week</h2>
            <div className="space-y-2">
              {weekEntries.map((entry) => (
                <Link key={entry.id} href={`/jobs/${entry.job.id}`}>
                  <div className="bg-white rounded-xl shadow-sm p-4 flex items-center gap-4 hover:shadow-md transition-shadow cursor-pointer">
                    <div className="w-2 h-12 rounded-full shrink-0" style={{ backgroundColor: entry.job.color }} />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 truncate">{entry.job.name}</p>
                      {entry.phase && <p className="text-sm text-gray-500">{entry.phase.name}</p>}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-medium text-gray-700">{format(parseISO(entry.date), "EEE, MMM d")}</p>
                      <p className="text-xs text-gray-400">{entry.startTime} – {entry.endTime}</p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Quick Links */}
        <div className="grid grid-cols-2 gap-4">
          <Link href="/jobs">
            <div className="bg-white rounded-xl shadow-sm p-5 hover:shadow-md transition-shadow cursor-pointer">
              <div className="text-2xl mb-2">🏗️</div>
              <p className="font-semibold text-gray-900">Jobs</p>
              <p className="text-sm text-gray-500">View all active projects</p>
            </div>
          </Link>
          <Link href="/schedule">
            <div className="bg-white rounded-xl shadow-sm p-5 hover:shadow-md transition-shadow cursor-pointer">
              <div className="text-2xl mb-2">📅</div>
              <p className="font-semibold text-gray-900">Schedule</p>
              <p className="text-sm text-gray-500">Team calendar view</p>
            </div>
          </Link>
        </div>
      </div>
    </Layout>
  );
}
