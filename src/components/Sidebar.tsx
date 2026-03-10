"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";

const navLinks = [
  { href: "/", label: "Dashboard", icon: "🏠" },
  { href: "/jobs", label: "Jobs", icon: "🏗️" },
  { href: "/schedule", label: "Schedule", icon: "📅" },
  { href: "/schedule/gantt", label: "Gantt Chart", icon: "📊" },
  { href: "/schedule/timeline", label: "People Timeline", icon: "👤" },
  { href: "/files", label: "Files", icon: "📁" },
  { href: "/people", label: "People", icon: "👥" },
  { href: "/settings", label: "Settings", icon: "⚙️" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    // Avoid /schedule/gantt matching /schedule
    if (href === "/schedule") return pathname === "/schedule";
    return pathname.startsWith(href);
  };

  return (
    <aside className="hidden md:flex fixed left-0 top-0 h-full w-64 bg-slate-800 flex-col z-50">
      <div className="p-6 border-b border-slate-700">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🔨</span>
          <div>
            <h1 className="text-white font-bold text-sm leading-tight">Williamson</h1>
            <h2 className="text-slate-400 text-xs">Scheduling</h2>
          </div>
        </div>
      </div>

      <nav className="flex-1 py-4 px-3">
        {navLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg mb-1 text-sm font-medium transition-colors ${
              isActive(link.href)
                ? "bg-blue-600 text-white"
                : "text-slate-400 hover:text-white hover:bg-slate-700"
            }`}
          >
            <span>{link.icon}</span>
            <span>{link.label}</span>
          </Link>
        ))}
      </nav>

      <div className="p-4 border-t border-slate-700">
        {session?.user && (
          <div className="mb-3">
            <p className="text-white text-sm font-medium truncate">{session.user.name}</p>
            <p className="text-slate-400 text-xs truncate">{session.user.email}</p>
            <span className="inline-block mt-1 text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">
              {session.user.role}
            </span>
          </div>
        )}
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="w-full text-left text-slate-400 hover:text-white text-sm transition-colors px-3 py-2 rounded-lg hover:bg-slate-700"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
