"use client";

import { useState, useRef, useEffect } from "react";

type ConfirmUpload = {
  url: string;
  name: string;
  type: string;
  jobId: string | null;
  jobName: string | null;
  phaseId: string | null;
  phaseName: string | null;
};

type Message = {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  filePreview?: { url: string; name: string; isImage: boolean };
};

type StoredMessage = {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  filePreview?: { url: string; name: string; isImage: boolean };
};

const STORAGE_KEY = "ai_chat_history";
const MAX_STORED = 100;

const WELCOME: Message = {
  role: "assistant",
  content:
    "Hi! Ask me anything about your schedule — active jobs, phases, who's working, upcoming deadlines, or send a progress update. You can also create jobs or phases, or attach a photo or file 📎",
  timestamp: new Date(),
};

function loadHistory(): Message[] {
  if (typeof window === "undefined") return [WELCOME];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [WELCOME];
    const stored: StoredMessage[] = JSON.parse(raw);
    if (!Array.isArray(stored) || stored.length === 0) return [WELCOME];
    return stored.map((m) => ({ ...m, timestamp: new Date(m.timestamp) }));
  } catch {
    return [WELCOME];
  }
}

function saveHistory(messages: Message[]) {
  if (typeof window === "undefined") return;
  try {
    const toStore: StoredMessage[] = messages.slice(-MAX_STORED).map((m) => ({
      ...m,
      timestamp: m.timestamp.toISOString(),
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
  } catch {
    // storage full or unavailable — ignore
  }
}

export default function AIChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>(() => loadHistory());
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingFile, setPendingFile] = useState<{ url: string; name: string; type: string } | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<ConfirmUpload | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Persist messages to localStorage whenever they change
  useEffect(() => {
    saveHistory(messages);
  }, [messages]);

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/ai/upload-temp", { method: "POST", body: formData });
      const data = await res.json();
      if (data.url) {
        setPendingFile({ url: data.url, name: file.name, type: file.type });
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Sorry, couldn't upload that file. Please try again.", timestamp: new Date() },
      ]);
    } finally {
      setLoading(false);
      // Reset input so same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function sendMessage() {
    const text = input.trim();
    if ((!text && !pendingFile) || loading) return;

    // If we have a pending confirm and user says yes/no, handle confirmation
    if (pendingConfirm) {
      const normalized = text.toLowerCase();
      if (normalized === "yes" || normalized === "y" || normalized === "confirm") {
        const userMsg: Message = { role: "user", content: text, timestamp: new Date() };
        setMessages((prev) => [...prev, userMsg]);
        setInput("");
        setLoading(true);
        try {
          const res = await fetch("/api/ai/confirm-upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(pendingConfirm),
          });
          const data = await res.json();
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: data.reply ?? "✅ File saved!", timestamp: new Date() },
          ]);
          setPendingConfirm(null);
        } catch {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: "Sorry, couldn't save the file. Please try again.", timestamp: new Date() },
          ]);
        } finally {
          setLoading(false);
        }
        return;
      }
      if (normalized === "no" || normalized === "n" || normalized === "cancel") {
        setMessages((prev) => [
          ...prev,
          { role: "user", content: text, timestamp: new Date() },
          { role: "assistant", content: "Cancelled. Send the file again with a caption if you'd like to try.", timestamp: new Date() },
        ]);
        setInput("");
        setPendingConfirm(null);
        return;
      }
    }

    const userMsg: Message = {
      role: "user",
      content: text || `[Attached: ${pendingFile?.name}]`,
      timestamp: new Date(),
      filePreview: pendingFile
        ? { url: pendingFile.url, name: pendingFile.name, isImage: pendingFile.type.startsWith("image/") }
        : undefined,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    const fileToSend = pendingFile;
    setPendingFile(null);
    setLoading(true);

    try {
      const history = messages
        .filter((m) => m.role !== "assistant" || m.content !== WELCOME.content)
        .map((m) => ({ role: m.role, content: m.content }));

      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          history,
          pendingFile: fileToSend ?? undefined,
        }),
      });

      const data = await res.json();
      const reply = data.reply ?? "Sorry, something went wrong.";

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: reply, timestamp: new Date() },
      ]);

      if (data.confirmUpload) {
        setPendingConfirm(data.confirmUpload);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Sorry, I couldn't reach the server. Please try again.",
          timestamp: new Date(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function clearHistory() {
    setMessages([WELCOME]);
  }

  return (
    <>
      {open && (
        <div className="fixed bottom-36 right-4 md:bottom-24 z-50 flex flex-col w-[380px] max-w-[calc(100vw-2rem)] h-[500px] bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-blue-600 text-white flex-shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 bg-white/20 rounded-full flex items-center justify-center text-sm">
                🤖
              </div>
              <span className="font-semibold text-sm">Siteworks AI</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={clearHistory}
                className="text-white/60 hover:text-white transition-colors p-1 rounded text-xs"
                title="Clear chat history"
                aria-label="Clear chat history"
              >
                Clear
              </button>
              <button
                onClick={() => setOpen(false)}
                className="text-white/80 hover:text-white transition-colors p-1 rounded"
                aria-label="Close chat"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 bg-slate-50">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] px-3 py-2 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                    msg.role === "user"
                      ? "bg-blue-600 text-white rounded-br-sm"
                      : "bg-white text-slate-800 border border-slate-200 rounded-bl-sm shadow-sm"
                  }`}
                >
                  {msg.filePreview && (
                    <div className="mb-1">
                      {msg.filePreview.isImage ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={msg.filePreview.url}
                          alt={msg.filePreview.name}
                          className="rounded-lg max-w-full max-h-32 object-cover"
                        />
                      ) : (
                        <div className="flex items-center gap-1 text-xs text-white/80">
                          <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                          </svg>
                          <span className="truncate">{msg.filePreview.name}</span>
                        </div>
                      )}
                    </div>
                  )}
                  {msg.content}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="bg-white border border-slate-200 rounded-2xl rounded-bl-sm shadow-sm px-4 py-3">
                  <div className="flex gap-1 items-center">
                    <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* File preview bar */}
          {pendingFile && (
            <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border-t border-blue-100 flex-shrink-0">
              {pendingFile.type.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={pendingFile.url} alt={pendingFile.name} className="w-10 h-10 rounded object-cover flex-shrink-0" />
              ) : (
                <div className="w-10 h-10 bg-blue-100 rounded flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
              )}
              <span className="text-xs text-slate-600 flex-1 truncate">{pendingFile.name}</span>
              <button
                onClick={() => setPendingFile(null)}
                className="text-slate-400 hover:text-slate-600 flex-shrink-0"
                aria-label="Remove file"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}

          {/* Input bar */}
          <div className="flex items-center gap-2 px-3 py-3 border-t border-slate-200 bg-white flex-shrink-0">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,application/pdf,.doc,.docx,.xlsx"
              className="hidden"
              onChange={handleFileSelect}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
              className="text-slate-400 hover:text-blue-600 disabled:opacity-40 transition-colors flex-shrink-0 p-1"
              aria-label="Attach file"
              title="Attach photo or file"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
            </button>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={pendingFile ? "Add a caption..." : "Ask or create jobs/phases..."}
              disabled={loading}
              className="flex-1 text-sm px-3 py-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 bg-slate-50"
            />
            <button
              onClick={sendMessage}
              disabled={loading || (!input.trim() && !pendingFile)}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl px-3 py-2 transition-colors flex-shrink-0"
              aria-label="Send message"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Floating button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-20 right-4 md:bottom-6 z-50 w-14 h-14 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg flex items-center justify-center transition-all duration-200 hover:scale-105 active:scale-95"
        aria-label="Open AI chat"
      >
        {open ? (
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
            <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z" />
          </svg>
        )}
      </button>
    </>
  );
}
