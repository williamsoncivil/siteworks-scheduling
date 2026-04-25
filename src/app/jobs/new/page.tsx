"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Layout from "@/components/Layout";
import Link from "next/link";

const PRESET_COLORS = [
  "#3B82F6", // blue
  "#10B981", // green
  "#F59E0B", // amber
  "#EF4444", // red
  "#8B5CF6", // violet
  "#EC4899", // pink
];

interface TemplatePhase {
  id: string;
  name: string;
  description: string | null;
  orderIndex: number;
  category: string | null;
}

interface JobTemplate {
  id: string;
  name: string;
  description: string | null;
  phases: TemplatePhase[];
}

export default function NewJobPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [templates, setTemplates] = useState<JobTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");

  useEffect(() => {
    fetch("/api/job-templates")
      .then((r) => r.json())
      .then((data) => setTemplates(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId) ?? null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      let job;

      if (selectedTemplateId) {
        const res = await fetch(`/api/jobs/from-template/${selectedTemplateId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, address, description, color }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to create job");
        }
        job = await res.json();
      } else {
        const res = await fetch("/api/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, address, description, color }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to create job");
        }
        job = await res.json();
      }

      router.push(`/jobs/${job.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create job");
      setLoading(false);
    }
  };

  return (
    <Layout>
      <div className="p-6 max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Link href="/jobs" className="text-gray-400 hover:text-gray-600">
            ← Jobs
          </Link>
          <span className="text-gray-300">/</span>
          <h1 className="text-xl font-bold text-gray-900">New Job</h1>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-6">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Job Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="Riverside Commons"
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Address <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                required
                placeholder="123 Main St, Bellingham, WA"
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description <span className="text-gray-400">(optional)</span>
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="Project overview..."
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Color
              </label>
              <div className="flex gap-3">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className="w-8 h-8 rounded-full transition-transform hover:scale-110"
                    style={{
                      backgroundColor: c,
                      outline: color === c ? `3px solid ${c}` : "none",
                      outlineOffset: "2px",
                    }}
                  />
                ))}
              </div>
            </div>

            {/* Template selector */}
            <div className="border-t border-gray-100 pt-5">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Use Template <span className="text-gray-400">(optional)</span>
              </label>
              <select
                value={selectedTemplateId}
                onChange={(e) => setSelectedTemplateId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">— No template —</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.phases.length} phase{t.phases.length !== 1 ? "s" : ""})
                  </option>
                ))}
              </select>

              {selectedTemplate && (
                <div className="mt-3 bg-blue-50 border border-blue-100 rounded-lg p-3">
                  {selectedTemplate.description && (
                    <p className="text-xs text-blue-700 mb-2">{selectedTemplate.description}</p>
                  )}
                  <p className="text-xs font-medium text-blue-800 mb-1.5">
                    Phases that will be created:
                  </p>
                  <ol className="space-y-0.5">
                    {selectedTemplate.phases.map((p) => (
                      <li key={p.id} className="text-xs text-blue-700 flex items-center gap-1.5">
                        <span className="text-blue-400 font-medium">{p.orderIndex + 1}.</span>
                        <span>{p.name}</span>
                        {p.category && (
                          <span className="text-blue-400">({p.category})</span>
                        )}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>

            <div className="flex gap-3 pt-2">
              <Link href="/jobs">
                <button
                  type="button"
                  className="border border-gray-300 text-gray-700 py-2 px-4 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
              </Link>
              <button
                type="submit"
                disabled={loading}
                className="bg-blue-600 text-white py-2 px-6 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {loading
                  ? "Creating..."
                  : selectedTemplateId
                  ? "Create from Template"
                  : "Create Job"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Layout>
  );
}
