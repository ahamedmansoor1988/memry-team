"use client";
import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { Search, Users } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Person {
  id: string;
  display_name: string;
  email: string | null;
  avatar_url: string | null;
  figma_handle: string | null;
  slack_handle: string | null;
  decisions: number;
  contributions: number;
  projects: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

const AVATAR_COLORS = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];
function colorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

function roleOf(p: Person): string {
  if (p.figma_handle && p.slack_handle) return "Design · Slack";
  if (p.figma_handle) return "Designer";
  if (p.slack_handle) return "Slack member";
  return "Member";
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function PeoplePage() {
  const [people, setPeople]   = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState("");

  useEffect(() => {
    fetch("/api/people")
      .then(r => r.json())
      .then((d: { people?: Person[] }) => { setPeople(d.people ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return people;
    return people.filter(p =>
      p.display_name.toLowerCase().includes(q) ||
      (p.email ?? "").toLowerCase().includes(q)
    );
  }, [people, search]);

  return (
    <div className="min-h-full" style={{ background: "var(--bg)" }}>
      <div className="px-7 pt-6 pb-10 max-w-4xl">

        {/* ── Header ── */}
        <div className="mb-5">
          <h1 style={{ fontSize: 20, fontWeight: 600, color: "var(--text)", letterSpacing: "-0.02em" }}>People</h1>
          <p style={{ fontSize: 13, color: "var(--text-2)", marginTop: 2 }}>
            Team members and their impact.
          </p>
        </div>

        {/* ── Search ── */}
        <div style={{ position: "relative", marginBottom: 12, maxWidth: 320 }}>
          <Search style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", width: 13, height: 13, color: "var(--text-3)", pointerEvents: "none" }} />
          <input
            type="text"
            placeholder="Search people…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: "100%", padding: "8px 12px 8px 32px", fontSize: 12,
              borderRadius: 8, border: "1px solid var(--border)",
              background: "var(--surface)", color: "var(--text)", outline: "none",
            }}
          />
        </div>

        {/* ── Table ── */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", boxShadow: "var(--shadow-1)" }}>

          {/* Column header */}
          <div style={{
            display: "flex", alignItems: "center", gap: 12,
            padding: "8px 16px", borderBottom: "1px solid var(--border-2)",
            background: "var(--bg)",
          }}>
            <span style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-3)" }}>
              Member
            </span>
            {["Decisions", "Contributions", "Projects"].map(h => (
              <span key={h} style={{ width: 92, textAlign: "center", fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-3)" }} className="max-sm:hidden">
                {h}
              </span>
            ))}
          </div>

          {loading ? (
            <div style={{ padding: 16 }} className="space-y-4">
              {[0, 1, 2].map(i => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div className="skeleton" style={{ width: 36, height: 36, borderRadius: 99 }} />
                  <div style={{ flex: 1 }}>
                    <div className="skeleton" style={{ height: 13, width: "30%", borderRadius: 4, marginBottom: 5 }} />
                    <div className="skeleton" style={{ height: 11, width: "20%", borderRadius: 4 }} />
                  </div>
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: "56px 0", textAlign: "center" }}>
              <Users style={{ width: 28, height: 28, color: "var(--border)", margin: "0 auto 10px" }} />
              <p style={{ fontSize: 14, fontWeight: 500, color: "var(--text)" }}>
                {people.length === 0 ? "No team members yet" : "Nobody matches"}
              </p>
              <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 4 }}>
                {people.length === 0
                  ? "Profiles are created automatically as people comment in Figma and Slack."
                  : "Try a different search."}
              </p>
            </div>
          ) : (
            filtered.map(p => (
              <div
                key={p.id}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "11px 16px", borderBottom: "1px solid var(--border-2)",
                }}
                className="last:border-0 hover:bg-[var(--accent-softer)] transition-colors"
              >
                {/* Avatar + name */}
                <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 10 }}>
                  {p.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.avatar_url} alt="" style={{ width: 36, height: 36, borderRadius: 99, objectFit: "cover", flexShrink: 0 }} />
                  ) : (
                    <div style={{
                      width: 36, height: 36, borderRadius: 99, flexShrink: 0,
                      background: colorFor(p.display_name), color: "#fff",
                      fontSize: 12, fontWeight: 700,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {initials(p.display_name)}
                    </div>
                  )}
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }} className="truncate">{p.display_name}</p>
                    <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 1 }} className="truncate">{roleOf(p)}</p>
                  </div>
                </div>

                {/* Metrics */}
                {[p.decisions, p.contributions, p.projects].map((n, i) => (
                  <span key={i} style={{ width: 92, textAlign: "center", fontFamily: "var(--font-mono)", fontSize: 13, color: n > 0 ? "var(--text)" : "var(--text-3)" }} className="max-sm:hidden">
                    {n}
                  </span>
                ))}
              </div>
            ))
          )}
        </div>

        {/* Manage link */}
        {!loading && people.length > 0 && (
          <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 10 }}>
            Manage handles and invites in{" "}
            <Link href="/team" style={{ color: "var(--blue)", textDecoration: "none" }} className="hover:underline">
              Team settings →
            </Link>
          </p>
        )}

      </div>
    </div>
  );
}
