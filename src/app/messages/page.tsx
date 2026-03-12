"use client";

import { useEffect, useState, useRef } from "react";
import Layout from "@/components/Layout";
import { format, parseISO } from "date-fns";

interface Message {
  id: string;
  content: string;
  createdAt: string;
  author: { id: string; name: string; role: string };
  job: { id: string; name: string; color: string };
  phase: { id: string; name: string } | null;
}

interface Job { id: string; name: string; color: string; }
interface Phase { id: string; name: string; }

export default function MessagesPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [phases, setPhases] = useState<Phase[]>([]);
  const [filterJobId, setFilterJobId] = useState("");
  const [filterPhaseId, setFilterPhaseId] = useState("");
  const [newJobId, setNewJobId] = useState("");
  const [newPhaseId, setNewPhaseId] = useState("");
  const [newPhases, setNewPhases] = useState<Phase[]>([]);
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Load jobs
  useEffect(() => {
    fetch("/api/jobs").then((r) => r.json()).then((d) => setJobs(d));
  }, []);

  // Load phases when filter job changes
  useEffect(() => {
    if (!filterJobId) { setPhases([]); setFilterPhaseId(""); return; }
    fetch(`/api/jobs/${filterJobId}/phases`).then((r) => r.json()).then((d) => {
      setPhases(d);
      setFilterPhaseId("");
    });
  }, [filterJobId]);

  // Load phases for new message job
  useEffect(() => {
    if (!newJobId) { setNewPhases([]); setNewPhaseId(""); return; }
    fetch(`/api/jobs/${newJobId}/phases`).then((r) => r.json()).then((d) => {
      setNewPhases(d);
      setNewPhaseId("");
    });
  }, [newJobId]);

  // Mark as read on load
  useEffect(() => {
    fetch("/api/messages/read", { method: "POST" });
    // Dispatch so sidebar badge resets
    window.dispatchEvent(new Event("messages-read"));
  }, []);

  // Fetch messages
  const fetchMessages = () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterJobId) params.set("jobId", filterJobId);
    if (filterPhaseId) params.set("phaseId", filterPhaseId);
    fetch(`/api/messages?${params}`)
      .then((r) => r.json())
      .then((d) => { setMessages(d.reverse()); setLoading(false); });
  };

  useEffect(() => { fetchMessages(); }, [filterJobId, filterPhaseId]); // eslint-disable-line

  // Scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() || !newJobId) return;
    setSending(true);
    await fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, jobId: newJobId, phaseId: newPhaseId || null }),
    });
    setContent("");
    setSending(false);
    fetchMessages();
  };

  const grouped = messages.reduce<Record<string, Message[]>>((acc, m) => {
    const day = format(parseISO(m.createdAt), "MMMM d, yyyy");
    if (!acc[day]) acc[day] = [];
    acc[day].push(m);
    return acc;
  }, {});

  return (
    <Layout>
      <div className="p-6 max-w-4xl mx-auto flex flex-col" style={{ height: "calc(100vh - 32px)" }}>
        {/* Header */}
        <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Messages</h1>
            <p className="text-gray-500 text-sm mt-0.5">Job & phase discussions</p>
          </div>
          {/* Filters */}
          <div className="flex gap-2 flex-wrap">
            <select value={filterJobId} onChange={(e) => setFilterJobId(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
              <option value="">All Jobs</option>
              {jobs.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
            </select>
            {filterJobId && (
              <select value={filterPhaseId} onChange={(e) => setFilterPhaseId(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                <option value="">All Phases</option>
                {phases.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            )}
          </div>
        </div>

        {/* Message list */}
        <div className="flex-1 overflow-y-auto bg-white rounded-xl shadow-sm p-4 mb-4 space-y-1 min-h-0">
          {loading ? (
            <div className="text-gray-400 text-center py-12">Loading…</div>
          ) : messages.length === 0 ? (
            <div className="text-gray-400 text-center py-12">
              No messages yet{filterJobId ? " for this filter" : ""} — send one below
            </div>
          ) : (
            Object.entries(grouped).map(([day, msgs]) => (
              <div key={day}>
                <div className="flex items-center gap-3 my-4">
                  <div className="flex-1 h-px bg-gray-100" />
                  <span className="text-xs text-gray-400 font-medium">{day}</span>
                  <div className="flex-1 h-px bg-gray-100" />
                </div>
                {msgs.map((msg) => (
                  <div key={msg.id} className="flex gap-3 py-2 hover:bg-gray-50 rounded-lg px-2 transition-colors">
                    {/* Avatar */}
                    <div className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-white text-xs font-bold"
                      style={{ backgroundColor: msg.job.color }}>
                      {msg.author.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-gray-900">{msg.author.name}</span>
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full text-white" style={{ backgroundColor: msg.job.color }}>
                          {msg.job.name}
                        </span>
                        {msg.phase && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                            {msg.phase.name}
                          </span>
                        )}
                        <span className="text-xs text-gray-400">{format(parseISO(msg.createdAt), "h:mm a")}</span>
                      </div>
                      <p className="text-sm text-gray-700 mt-0.5">{msg.content}</p>
                    </div>
                  </div>
                ))}
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>

        {/* Compose */}
        <div className="bg-white rounded-xl shadow-sm p-4">
          <form onSubmit={sendMessage} className="space-y-3">
            <div className="flex gap-2 flex-wrap">
              <select value={newJobId} onChange={(e) => setNewJobId(e.target.value)} required
                className="flex-1 min-w-32 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                <option value="">Select job…</option>
                {jobs.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
              </select>
              {newJobId && (
                <select value={newPhaseId} onChange={(e) => setNewPhaseId(e.target.value)}
                  className="flex-1 min-w-32 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                  <option value="">No specific phase</option>
                  {newPhases.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              )}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Type a message…"
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button type="submit" disabled={sending || !content.trim() || !newJobId}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 shrink-0">
                {sending ? "…" : "Send"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Layout>
  );
}
