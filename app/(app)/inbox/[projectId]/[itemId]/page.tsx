"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Sparkles, CheckCircle2, AlertCircle,
  HelpCircle, ExternalLink, Send, MoreHorizontal,
  MessageSquare, ChevronDown, Zap, Clock,
  type LucideIcon,
} from "lucide-react";
import ConnectedContext from "@/components/linker/ConnectedContext";

// ─── Types ────────────────────────────────────────────────────────────────────

interface FigmaFile { id: string; name: string; figma_file_key: string; }
interface Reply { id: string; author_name: string; raw_content: string; figma_created_at: string; }
interface FigmaComment {
  id: string; author_name: string; author_avatar: string | null;
  raw_content: string; figma_created_at: string;
  figma_comment_id: string; figma_order_id: string;
  page_name: string | null; frame_name: string | null;
  figma_file: FigmaFile | null;
}
interface DesignReference {
  id: string; file_key: string; node_id: string;
  frame_name: string | null; page_name: string | null;
  thumbnail_url: string | null;
  preview_status: "pending" | "ready" | "failed" | "stale";
  preview_error_reason: string | null;
}
interface AuthorProfile {
  id: string;
  display_name: string;
  email: string | null;
  avatar_url: string | null;
  figma_handle: string | null;
  slack_handle: string | null;
}

interface OwnerProfile {
  id: string;
  display_name: string;
  figma_handle: string | null;
  slack_handle: string | null;
}

interface FeedbackItem {
  id: string; status: string; priority: string;
  ai_summary: string | null; ai_classification: string | null;
  ai_key_question: string | null; ai_tags: string[] | null;
  ai_risk_flag: boolean; ai_vague_flag: boolean;
  ai_vague_reason: string | null; ai_confidence: number | null;
  ai_suggested_action: string | null;
  figma_node_id: string | null; figma_preview_url: string | null;
  created_at: string; updated_at?: string;
  slack_message_ts: string | null;
  slack_channel_id: string | null;
  author_profile: AuthorProfile | null;
  figma_comment: FigmaComment | null;
  design_reference: DesignReference | null;
  project: { id: string; name: string } | null;
  replies: Reply[];
  owner_name: string | null;
  owner_profile_id: string | null;
  waiting_since: string | null;
  ownership_source: string | null;
  owner_profile: { display_name: string; slack_handle: string | null } | null;
}

type DecisionKind = "approve" | "reject" | "clarify";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function initials(name?: string | null): string {
  if (!name) return "?";
  return name.split(/\s+/).map(w => w[0]?.toUpperCase() ?? "").slice(0, 2).join("");
}

function Avatar({ name, size = "md" }: { name?: string | null; size?: "sm" | "md" | "lg" }) {
  const cls = {
    sm: "w-7 h-7 text-[10px]",
    md: "w-9 h-9 text-[11px]",
    lg: "w-10 h-10 text-[13px]",
  }[size];
  return (
    <span className={`${cls} rounded-full bg-ink text-paper flex items-center justify-center font-semibold shrink-0 select-none`}>
      {initials(name)}
    </span>
  );
}

// ─── Related Decisions panel ─────────────────────────────────────────────────

interface SearchResult {
  id: string;
  status: string;
  ai_key_question: string | null;
  ai_summary: string | null;
  created_at: string;
  project: { id: string; name: string } | null;
}

function RelatedDecisions({ item }: { item: FeedbackItem }) {
  const [results, setResults]   = useState<SearchResult[]>([]);
  const [loading, setLoading]   = useState(false);

  useEffect(() => {
    const q = item.ai_key_question ?? item.ai_summary;
    if (!q) return;

    let cancelled = false;
    setLoading(true);
    fetch(`/api/search?q=${encodeURIComponent(q)}&limit=4`)
      .then(r => r.json())
      .then((d: { results?: SearchResult[] }) => {
        if (cancelled) return;
        const filtered = (d.results ?? [])
          .filter(r => r.id !== item.id)
          .slice(0, 3);
        setResults(filtered);
        setLoading(false);
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [item.id, item.ai_key_question, item.ai_summary]);

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400 mb-2">
        Related Decisions
      </p>
      {loading ? (
        <div className="space-y-2">
          <div className="animate-pulse bg-zinc-100 rounded h-3 w-full" />
          <div className="animate-pulse bg-zinc-100 rounded h-3 w-4/5" />
        </div>
      ) : results.length === 0 ? (
        <p className="text-xs text-zinc-400">No related decisions found.</p>
      ) : (
        <div className="space-y-2">
          {results.map(r => {
            const title = r.ai_key_question && r.ai_key_question !== "None"
              ? r.ai_key_question
              : r.ai_summary ?? "Feedback item";
            const href = r.project?.id
              ? `/inbox/${r.project.id}/${r.id}`
              : "#";
            return (
              <Link
                key={r.id}
                href={href}
                className="flex flex-col gap-0.5 group"
              >
                <span className="text-xs text-zinc-500 font-medium truncate group-hover:text-zinc-900 transition-colors">
                  {title}
                </span>
                <span className="text-[10px] text-zinc-400">
                  {r.status.replace("_", " ")} · {timeAgo(r.created_at)}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Design Context Preview ───────────────────────────────────────────────────

function FigmaLogoMini() {
  return (
    <svg width="10" height="14" viewBox="0 0 38 57" fill="none">
      <path d="M19 28.5C19 23.8 22.8 20 27.5 20C32.2 20 36 23.8 36 28.5C36 33.2 32.2 37 27.5 37C22.8 37 19 33.2 19 28.5Z" fill="#1ABCFE"/>
      <path d="M2 46C2 41.3 5.8 37.5 10.5 37.5H19V46C19 50.7 15.2 54.5 10.5 54.5C5.8 54.5 2 50.7 2 46Z" fill="#0ACF83"/>
      <path d="M19 2V20H27.5C32.2 20 36 16.2 36 11.5C36 6.8 32.2 3 27.5 3H19V2Z" fill="#FF7262"/>
      <path d="M2 11.5C2 16.2 5.8 20 10.5 20H19V3H10.5C5.8 3 2 6.8 2 11.5Z" fill="#F24E1E"/>
      <path d="M2 28.5C2 33.2 5.8 37 10.5 37H19V20H10.5C5.8 20 2 23.8 2 28.5Z" fill="#FF7262"/>
    </svg>
  );
}

function PreviewStatusPill({ status }: { status: DesignReference["preview_status"] }) { // eslint-disable-line @typescript-eslint/no-unused-vars
  const map = {
    pending: { label: "Generating…", cls: "bg-zinc-100 text-zinc-600" },
    ready:   { label: "Preview ready", cls: "bg-zinc-100 text-zinc-700" },
    failed:  { label: "Preview unavailable", cls: "bg-red-50 text-red-500" },
    stale:   { label: "Stale — will refresh", cls: "bg-gray-100 text-muted" },
  };
  const { label, cls } = map[status] ?? map.pending;
  return (
    <span className={`inline-flex items-center text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${cls}`}>
      {label}
    </span>
  );
}

// ─── Status dropdown ──────────────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<string, string[]> = {
  open:           ["needs_decision", "resolved", "archived"],
  needs_decision: ["resolved", "open", "archived"],
  resolved:       ["archived", "open"],
  archived:       ["open"],
};

const STATUS_META: Record<string, { label: string; pillCls: string; dotCls: string }> = {
  open:           { label: "Open",           pillCls: "bg-blue-soft text-blue border-transparent",   dotCls: "bg-blue"   },
  needs_decision: { label: "Needs Decision", pillCls: "bg-amber-soft text-amber border-transparent", dotCls: "bg-amber"  },
  resolved:       { label: "Resolved",       pillCls: "bg-green-soft text-green border-transparent", dotCls: "bg-green"  },
  archived:       { label: "Archived",       pillCls: "bg-wash text-muted border-transparent",       dotCls: "bg-muted"  },
};

function StatusDropdown({ item, onStatusChange }: {
  item: FeedbackItem;
  onStatusChange: (newStatus: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [changing, setChanging] = useState(false);

  async function handleChange(toStatus: string) {
    if (toStatus === item.status) { setOpen(false); return; }
    setChanging(true);
    setOpen(false);
    try {
      const res = await fetch(`/api/feedback/${item.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: toStatus }),
      });
      if (res.ok) onStatusChange(toStatus);
    } catch {
      // non-fatal — item will show stale status until reload
    } finally {
      setChanging(false);
    }
  }

  const current = STATUS_META[item.status] ?? STATUS_META.open;
  const allowed = VALID_TRANSITIONS[item.status] ?? [];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        disabled={changing}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold uppercase tracking-wider border transition-opacity disabled:opacity-50 ${current.pillCls}`}
      >
        {changing ? "…" : current.label}
        {!changing && <ChevronDown size={10} className="opacity-60" />}
      </button>

      {open && allowed.length > 0 && (
        <>
          {/* Click-outside overlay */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-full mt-1 bg-paper border border-border rounded-lg shadow-lg overflow-hidden z-20 min-w-[160px]">
            {allowed.map(s => {
              const meta = STATUS_META[s] ?? STATUS_META.open;
              return (
                <button
                  key={s}
                  onClick={() => void handleChange(s)}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-body text-muted hover:text-ink hover:bg-surface transition-colors"
                >
                  <span className={`w-2 h-2 rounded-full shrink-0 ${meta.dotCls}`} />
                  {meta.label}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ── Generic frame name detection ─────────────────────────────────────────────
// Frames named "001", "Frame 3", "Screen 2" etc. are structural IDs, not context.
// When detected, we derive a more meaningful label from page name + frame name.

const GENERIC_FRAME_RE = /^(frame|screen|artboard|page|group|component|f|s)\s*\d+$|^\d+$|^-?\d+(\.\d+)?$/i;

function isGenericName(name: string | null): boolean {
  if (!name) return true;
  return GENERIC_FRAME_RE.test(name.trim());
}

/** Returns the best human-readable label for the frame. */
function resolveDisplayName(
  frameName: string | null,
  pageName: string | null,
): { primary: string; isGeneric: boolean } {
  const generic = isGenericName(frameName);
  if (!generic && frameName) return { primary: frameName, isGeneric: false };

  // Name is generic — build a better label from page context
  if (pageName && frameName) return { primary: `${pageName} · ${frameName}`, isGeneric: true };
  if (pageName) return { primary: pageName, isGeneric: true };
  if (frameName) return { primary: frameName, isGeneric: true };
  return { primary: "Unknown frame", isGeneric: true };
}

// ── Preview failure presentation ──────────────────────────────────────────────
// Maps the backend `preview_error_reason` to a human-readable label + tone, so the
// UI can tell a *temporary* quota stall apart from a *genuine* permanent failure.
//   warning (amber) → transient, will retry automatically (quota)
//   error   (red)   → permanent, user action needed (access / missing frame)

type PreviewFailureTone = "warning" | "error";

function previewFailureInfo(
  reason: string | null | undefined,
): { label: string; tone: PreviewFailureTone } {
  switch (reason) {
    case "rate_limited":      return { label: "Figma API quota exceeded", tone: "warning" };
    case "permission_denied": return { label: "No access to this frame",  tone: "error"   };
    case "node_missing":      return { label: "Frame no longer exists",   tone: "error"   };
    default:                  return { label: "Preview unavailable",      tone: "error"   };
  }
}

/** Parse a decision reply (same ✅/⚠️/❓ prefixes written by handleMakeDecision). */
function parseDecision(raw: string): { label: string; cls: string; Icon: LucideIcon } | null {
  if (raw.startsWith("✅")) return { label: "Accepted",      cls: "text-green bg-green-soft border-transparent", Icon: CheckCircle2 };
  if (raw.startsWith("⚠️")) return { label: "Needs Work",    cls: "text-amber bg-amber-soft border-transparent", Icon: AlertCircle  };
  if (raw.startsWith("❓")) return { label: "Clarification", cls: "text-blue bg-blue-soft border-transparent",   Icon: HelpCircle   };
  return null;
}

// ── Memry Status Card ─────────────────────────────────────────────────────────
// The primary card. Must answer in under 5 seconds: what state is this in,
// why is it here, and what should happen next.

interface StatusConfig {
  icon: string;
  label: string;
  bg: string;
  border: string;
  labelCls: string;
  reasonFn: (item: FeedbackItem) => string;
}

const STATUS_CONFIGS: StatusConfig[] = [
  {
    icon: "🚧",
    label: "Blocked",
    bg: "bg-red-soft",
    border: "border-red/20",
    labelCls: "text-red",
    reasonFn: () => "Work is stalled. Someone is waiting on a decision before they can proceed.",
  },
  {
    icon: "🟠",
    label: "Decision Required",
    bg: "bg-amber-soft",
    border: "border-amber/20",
    labelCls: "text-amber",
    reasonFn: (item) => item.ai_vague_reason
      ? `A decision is needed. ${item.ai_vague_reason}`
      : "A decision must be made before work can continue.",
  },
  {
    icon: "⚠️",
    label: "Risk Flagged",
    bg: "bg-amber-soft",
    border: "border-amber/20",
    labelCls: "text-amber",
    reasonFn: () => "Memry detected a risk that could affect the project or timeline.",
  },
  {
    icon: "❓",
    label: "Needs Clarification",
    bg: "bg-wash",
    border: "border-border",
    labelCls: "text-muted",
    reasonFn: (item) => item.ai_vague_reason ?? "The discussion is unclear and needs clarification before a decision can be made.",
  },
  {
    icon: "✅",
    label: "Resolved",
    bg: "bg-green-soft",
    border: "border-green/20",
    labelCls: "text-green",
    reasonFn: () => "This discussion has been resolved.",
  },
  {
    icon: "📋",
    label: "Needs Review",
    bg: "bg-paper",
    border: "border-border",
    labelCls: "text-muted",
    reasonFn: () => "Memry captured this discussion and is waiting for a review.",
  },
];

function resolveStatusConfig(item: FeedbackItem): StatusConfig {
  if (item.status === "resolved" || item.status === "archived") return STATUS_CONFIGS[4];
  if (item.ai_classification === "Blocked" || item.status === "blocked") return STATUS_CONFIGS[0];
  if (item.ai_classification === "Needs Decision" || item.status === "needs_decision") return STATUS_CONFIGS[1];
  if (item.ai_risk_flag || item.ai_classification === "Risk") return STATUS_CONFIGS[2];
  if (item.ai_vague_flag || item.ai_classification === "Vague") return STATUS_CONFIGS[3];
  return STATUS_CONFIGS[5];
}

function MemryStatusCard({ item }: { item: FeedbackItem }) {
  const cfg = resolveStatusConfig(item);

  // Last activity = most recent timestamp across original comment + all replies
  const allTimes = [
    item.figma_comment?.figma_created_at,
    item.created_at,
    ...(item.replies ?? []).map(r => r.figma_created_at),
  ].filter(Boolean) as string[];
  const lastActivity = allTimes.length
    ? allTimes.reduce((a, b) => (a > b ? a : b))
    : item.created_at;

  return (
    <section className={`rounded-panel border ${cfg.bg} ${cfg.border} px-5 py-4 space-y-3`}>
      {/* State label */}
      <div className="flex items-center gap-2">
        <span className="text-base">{cfg.icon}</span>
        <span className={`text-sm font-bold ${cfg.labelCls}`}>{cfg.label}</span>
        <span className="ml-auto text-caption text-muted">{timeAgo(lastActivity)}</span>
      </div>

      {/* Reason — why this is in the inbox */}
      <p className="text-lead text-ink leading-relaxed">{cfg.reasonFn(item)}</p>

      {/* Recommended next step */}
      {item.ai_suggested_action && (
        <div className="flex items-start gap-2 pt-1">
          <Zap size={12} className="text-muted shrink-0 mt-0.5" />
          <div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted block mb-0.5">Recommended next step</span>
            <p className="text-body font-medium text-ink leading-snug">{item.ai_suggested_action}</p>
          </div>
        </div>
      )}
    </section>
  );
}

// ── Lightweight sidebar thumbnail ─────────────────────────────────────────────

function DesignThumbnail({ item }: { item: FeedbackItem }) {
  const [imgError, setImgError] = useState(false);
  const dr = item.design_reference;
  const fc = item.figma_comment;
  const fileKey = dr?.file_key ?? fc?.figma_file?.figma_file_key ?? null;
  const nodeId  = dr?.node_id ?? item.figma_node_id ?? null;
  const frameName = dr?.frame_name ?? fc?.frame_name ?? null;
  const pageName  = dr?.page_name  ?? fc?.page_name  ?? null;
  const thumbUrl  = (dr?.preview_status === "ready" ? dr.thumbnail_url : null) ?? item.figma_preview_url ?? null;
  const figmaUrl  = fileKey
    ? `https://www.figma.com/design/${fileKey}${nodeId ? `?node-id=${encodeURIComponent(nodeId)}` : ""}`
    : null;

  const { primary: displayName } = resolveDisplayName(frameName, pageName);

  if (!figmaUrl && !thumbUrl) return null;

  return (
    <a
      href={figmaUrl ?? "#"}
      target={figmaUrl ? "_blank" : undefined}
      rel="noreferrer"
      className="block border border-border rounded-panel overflow-hidden bg-paper hover:border-ink/20 transition-all group"
      onClick={!figmaUrl ? e => e.preventDefault() : undefined}
    >
      {thumbUrl && !imgError ? (
        <div className="h-24 bg-[#F0F0F0] overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={thumbUrl}
            alt={displayName}
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
            loading="lazy"
          />
        </div>
      ) : (
        <div className="h-16 bg-[#F7F7F8] flex items-center justify-center">
          <FigmaLogoMini />
        </div>
      )}
      <div className="px-3 py-2 flex items-center justify-between gap-2">
        <p className="text-caption text-ink font-medium truncate">{displayName}</p>
        {figmaUrl && <ExternalLink size={10} className="text-muted shrink-0 group-hover:text-ink transition-colors" />}
      </div>
    </a>
  );
}

// ── Linked to panel (kit screen 4) ───────────────────────────────────────────

function LinkedToPanel({ item, commentCount }: { item: FeedbackItem; commentCount: number }) {
  const fc = item.figma_comment;
  return (
    <div className="rounded-panel border border-border bg-paper p-3.5 space-y-2.5">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted">Linked to</p>

      {item.project && (
        <div>
          <p className="text-[10px] text-muted">Project</p>
          <Link
            href={`/projects/${item.project.id}`}
            className="text-body text-blue hover:underline"
          >
            {item.project.name}
          </Link>
        </div>
      )}

      {fc?.figma_file?.name && (
        <div>
          <p className="text-[10px] text-muted">File</p>
          <p className="text-body text-ink">{fc.figma_file.name}</p>
        </div>
      )}

      <div>
        <p className="text-[10px] text-muted mb-1">Sources</p>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-caption text-ink">
              <svg width="10" height="13" viewBox="0 0 38 57" fill="none" className="shrink-0">
                <path d="M19 28.5C19 23.8 22.8 20 27.5 20C32.2 20 36 23.8 36 28.5C36 33.2 32.2 37 27.5 37C22.8 37 19 33.2 19 28.5Z" fill="#1ABCFE"/>
                <path d="M2 46C2 41.3 5.8 37.5 10.5 37.5H19V46C19 50.7 15.2 54.5 10.5 54.5C5.8 54.5 2 50.7 2 46Z" fill="#0ACF83"/>
                <path d="M19 2V20H27.5C32.2 20 36 16.2 36 11.5C36 6.8 32.2 3 27.5 3H19V2Z" fill="#FF7262"/>
                <path d="M2 11.5C2 16.2 5.8 20 10.5 20H19V3H10.5C5.8 3 2 6.8 2 11.5Z" fill="#F24E1E"/>
                <path d="M2 28.5C2 33.2 5.8 37 10.5 37H19V20H10.5C5.8 20 2 23.8 2 28.5Z" fill="#A259FF"/>
              </svg>
              Figma
            </span>
            <span className="font-mono text-[10px] text-muted">
              {commentCount} comment{commentCount !== 1 ? "s" : ""}
            </span>
          </div>
          {item.slack_message_ts && item.slack_channel_id && (
            <div className="flex items-center justify-between">
              <a
                href={`https://slack.com/app_redirect?channel=${item.slack_channel_id}&message_ts=${item.slack_message_ts}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 text-caption text-blue hover:underline"
              >
                <svg width="11" height="11" viewBox="0 0 122.8 122.8" className="shrink-0">
                  <path d="M25.8 77.6c0 7.1-5.8 12.9-12.9 12.9S0 84.7 0 77.6s5.8-12.9 12.9-12.9h12.9v12.9zm6.5 0c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9v32.3c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V77.6z" fill="#e01e5a"/>
                  <path d="M45.2 25.8c-7.1 0-12.9-5.8-12.9-12.9S38.1 0 45.2 0s12.9 5.8 12.9 12.9v12.9H45.2zm0 6.5c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H12.9C5.8 58.1 0 52.3 0 45.2s5.8-12.9 12.9-12.9h32.3z" fill="#36c5f0"/>
                  <path d="M97 45.2c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9-5.8 12.9-12.9 12.9H97V45.2zm-6.5 0c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V12.9C64.7 5.8 70.5 0 77.6 0s12.9 5.8 12.9 12.9v32.3z" fill="#2eb67d"/>
                  <path d="M77.6 97c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9-12.9-5.8-12.9-12.9V97h12.9zm0-6.5c-7.1 0-12.9-5.8-12.9-12.9s5.8-12.9 12.9-12.9h32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H77.6z" fill="#ecb22e"/>
                </svg>
                Slack thread
              </a>
              <span className="font-mono text-[10px] text-muted">linked</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Owner panel ───────────────────────────────────────────────────────────────

function OwnerPanel({ item, profiles, onOwnerChange }: {
  item: FeedbackItem;
  profiles: OwnerProfile[];
  onOwnerChange: (
    ownerName: string | null,
    ownerProfileId: string | null,
    ownerProfile: { display_name: string; slack_handle: string | null } | null,
  ) => void;
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [assigning, setAssigning]       = useState(false);

  const waitingDays = item.waiting_since
    ? Math.floor((Date.now() - new Date(item.waiting_since).getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  async function assignOwner(
    profileId: string,
    ownerName: string,
    ownerProf: { display_name: string; slack_handle: string | null },
  ) {
    setAssigning(true);
    setDropdownOpen(false);
    try {
      await fetch(`/api/feedback/${item.id}/owner`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner_profile_id: profileId, owner_name: ownerName }),
      });
      onOwnerChange(ownerName, profileId, ownerProf);
    } catch {
      // non-fatal — optimistic update already applied
    }
    setAssigning(false);
  }

  function initialsOf(name: string) {
    return name.split(/\s+/).map(w => w[0]?.toUpperCase() ?? "").slice(0, 2).join("");
  }

  return (
    <div className="border border-border rounded-panel bg-paper">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted">Owner</span>
        {item.ownership_source && (
          <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${
            item.ownership_source === "ai"
              ? "bg-zinc-100 text-zinc-700"
              : "bg-gray-100 text-gray-500"
          }`}>
            {item.ownership_source === "ai" ? "AI" : "Manual"}
          </span>
        )}
      </div>

      {/* Body */}
      <div className="px-4 py-3 relative">
        {item.owner_name ? (
          <div className="space-y-2">
            {/* Owner identity row */}
            <div className="flex items-center gap-2.5">
              <span className="w-7 h-7 rounded-full bg-ink text-paper flex items-center justify-center text-[10px] font-semibold shrink-0 select-none">
                {initialsOf(item.owner_profile?.display_name ?? item.owner_name)}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-body font-semibold text-ink truncate">
                  {item.owner_profile?.display_name ?? item.owner_name}
                </p>
                {item.owner_profile?.slack_handle && (
                  <p className="text-caption text-muted">@{item.owner_profile.slack_handle}</p>
                )}
              </div>
              <button
                onClick={() => setDropdownOpen(v => !v)}
                disabled={assigning}
                className="text-muted hover:text-ink transition-colors shrink-0 disabled:opacity-40"
                title="Reassign owner"
              >
                <ChevronDown size={12} />
              </button>
            </div>
            {/* Waiting indicator — only shown after 2 days */}
            {item.waiting_since && waitingDays > 2 && (
              <p className="flex items-center gap-1 text-caption text-zinc-600 font-medium">
                <Clock size={10} className="shrink-0" />
                Waiting {waitingDays} day{waitingDays !== 1 ? "s" : ""}
              </p>
            )}
          </div>
        ) : (
          <button
            onClick={() => setDropdownOpen(v => !v)}
            disabled={assigning}
            className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-border text-body text-muted hover:text-ink hover:border-ink/30 transition-colors disabled:opacity-40"
          >
            <span>Unassigned</span>
            <ChevronDown size={12} className="opacity-60" />
          </button>
        )}

        {/* Profile picker dropdown */}
        {dropdownOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setDropdownOpen(false)} />
            <div className="absolute left-0 right-0 top-full mt-1 bg-paper border border-border rounded-lg shadow-lg overflow-hidden z-20">
              {profiles.length === 0 ? (
                <p className="px-3 py-2.5 text-body text-muted text-center">No profiles yet</p>
              ) : (
                profiles.map(p => (
                  <button
                    key={p.id}
                    onClick={() => void assignOwner(
                      p.id,
                      p.display_name,
                      { display_name: p.display_name, slack_handle: p.slack_handle },
                    )}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-body text-muted hover:text-ink hover:bg-surface transition-colors text-left"
                  >
                    <span className="w-6 h-6 rounded-full bg-ink text-paper flex items-center justify-center text-[9px] font-semibold shrink-0 select-none">
                      {initialsOf(p.display_name)}
                    </span>
                    <span className="truncate">{p.display_name}</span>
                  </button>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ItemDetailPage({ params }: { params: { projectId: string; itemId: string } }) {
  const { projectId, itemId } = params;
  const router = useRouter();

  const [item, setItem] = useState<FeedbackItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"thread" | "resolved">("thread");

  // Decision state — suggestion text is editable via the Edit action
  const [suggestionText, setSuggestionText] = useState("");
  const [editingSuggestion, setEditingSuggestion] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);

  // Reply
  const [replyText, setReplyText] = useState("");
  const [replying, setReplying] = useState(false);
  const [localReplies, setLocalReplies] = useState<Reply[]>([]);

  // Summary
  const [summarising, setSummarising] = useState(false);

  const [profiles, setProfiles] = useState<OwnerProfile[]>([]);
  const [rawCollapsed, setRawCollapsed] = useState(true);

  function fetchItem(silent = false) {
    fetch(`/api/feedback?projectId=${projectId}`)
      .then(r => r.json())
      .then((d: { items?: FeedbackItem[] }) => {
        const all = d.items ?? [];
        const found = all.find(i => i.id === itemId) ?? null;
        setItem(found);
        if (found) {
          setLocalReplies(found.replies ?? []);
          setSuggestionText(prev => prev || (
            found.ai_suggested_action
            ?? (found.ai_key_question && found.ai_key_question !== "None"
                ? `Resolve: ${found.ai_key_question}`
                : "Mark this discussion as resolved.")
          ));
        }
        if (!silent) setLoading(false);
      });
  }

  useEffect(() => {
    fetchItem();
    // Poll for new replies every 30s (picks up Figma replies synced in background)
    const interval = setInterval(() => fetchItem(true), 30_000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, itemId]);

  // Fetch workspace profiles once for the owner dropdown
  useEffect(() => {
    fetch("/api/profiles")
      .then(r => r.json())
      .then((d: { profiles?: OwnerProfile[] }) => setProfiles(d.profiles ?? []))
      .catch(() => {});
  }, []);

  function handleOwnerChange(
    ownerName: string | null,
    ownerProfileId: string | null,
    ownerProfile: { display_name: string; slack_handle: string | null } | null,
  ) {
    setItem(prev => prev ? {
      ...prev,
      owner_name: ownerName,
      owner_profile_id: ownerProfileId,
      ownership_source: "manual",
      owner_profile: ownerProfile,
    } : prev);
  }

  async function submitDecision(kind: DecisionKind) {
    if (!item) return;
    const text = suggestionText.trim();
    const message =
      kind === "approve" ? (text ? `✅ Approved: ${text}` : "✅ Approved")
      : kind === "reject" ? (text ? `⚠️ Needs Work: rejected "${text}"` : "⚠️ Needs Work")
      : "❓ Asking for clarification";
    setSubmitting(true);
    const res = await fetch(`/api/feedback/${item.id}/reply`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, resolve: kind === "approve" }),
    });
    const data = await res.json() as { ok?: boolean; error?: string };
    if (res.ok) {
      setSubmitMsg("Decision posted to Figma");
      setItem(prev => prev ? { ...prev, status: kind === "approve" ? "resolved" : "open" } : prev);
      setLocalReplies(prev => [...prev, {
        id: `temp-${Date.now()}`, author_name: "You",
        raw_content: message, figma_created_at: new Date().toISOString(),
      }]);
      setActiveTab("resolved");
      setEditingSuggestion(false);
    } else {
      setSubmitMsg(`Failed: ${data.error ?? "Unknown error"}`);
    }
    setSubmitting(false);
  }

  async function handleReply() {
    if (!replyText.trim() || !item) return;
    setReplying(true);
    const res = await fetch(`/api/feedback/${item.id}/reply`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: replyText.trim() }),
    });
    if (res.ok) {
      setLocalReplies(prev => [...prev, {
        id: `temp-${Date.now()}`, author_name: "You",
        raw_content: replyText.trim(), figma_created_at: new Date().toISOString(),
      }]);
      setReplyText("");
    }
    setReplying(false);
  }

  async function handleSummarise() {
    if (!item || item.ai_summary) return;
    setSummarising(true);
    const res = await fetch(`/api/feedback/${item.id}/summarize-thread`, { method: "POST" });
    const data = await res.json() as { summary?: string };
    if (data.summary) setItem(prev => prev ? { ...prev, ai_summary: data.summary! } : prev);
    setSummarising(false);
  }

  async function handleResolve() {
    if (!item) return;
    await fetch(`/api/feedback/${item.id}/status`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "resolved" }),
    });
    setItem(prev => prev ? { ...prev, status: "resolved" } : prev);
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="space-y-3 w-full max-w-3xl px-8">
          <div className="skeleton h-5 w-32 rounded" />
          <div className="skeleton h-8 w-3/4 rounded" />
          <div className="skeleton h-32 rounded-panel" />
        </div>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="flex h-screen items-center justify-center flex-col gap-3">
        <p className="text-lead font-medium text-ink">Discussion not found</p>
        <button onClick={() => router.push(`/inbox/${projectId}`)} className="text-body text-muted hover:text-ink">
          ← Back to project
        </button>
      </div>
    );
  }

  const fc = item.figma_comment;
  const resolvedReplies = localReplies.filter(r =>
    r.raw_content.startsWith("✅") || r.raw_content.startsWith("⚠️") || r.raw_content.startsWith("❓")
  );
  const threadReplies = localReplies.filter(r => !resolvedReplies.includes(r));
  const displayReplies = activeTab === "thread" ? threadReplies : resolvedReplies;

  // ── Key Decisions (Stage 2A): existing resolved-decision detection, reused ──
  const isActionable = item.status === "open" || item.status === "needs_decision";
  const madeDecisions = resolvedReplies.flatMap(reply => {
    const meta = parseDecision(reply.raw_content);
    return meta ? [{ reply, meta }] : [];
  });

  return (
    <div className="flex h-screen overflow-hidden bg-paper">

      {/* ── Left: main thread panel ── */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden border-r border-border">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border shrink-0">
          <button
            onClick={() => router.push(`/inbox/${projectId}`)}
            className="flex items-center gap-1.5 text-body text-muted hover:text-ink transition-colors"
          >
            <ArrowLeft size={14} /> Back to inbox
          </button>
          <div className="flex items-center gap-3">
            <StatusDropdown
              item={item}
              onStatusChange={newStatus => setItem(prev => prev ? { ...prev, status: newStatus } : prev)}
            />
            <button className="text-muted hover:text-ink transition-colors"><MoreHorizontal size={15} /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="px-6 py-5 space-y-4">

            {/* ══ SECTION 1 · Memry Status ══
                First thing the user sees. State + reason + next step. No reading required. */}
            <MemryStatusCard item={item} />

            {/* ══ SECTION 2 · Memry Conclusion ══
                One sentence. What Memry believes this discussion is about. */}
            {(item.ai_key_question && item.ai_key_question !== "None" && item.ai_key_question.trim() !== "") || item.ai_summary ? (
              <section className="px-4 py-3 rounded-panel border border-border bg-paper">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles size={11} className="text-muted shrink-0" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted">Memry's read</span>
                  {item.ai_confidence !== null && item.ai_confidence < 0.70 && (
                    <span className="ml-auto text-[10px] text-amber italic">Low confidence</span>
                  )}
                </div>
                <p className="text-body text-ink leading-relaxed">
                  {item.ai_key_question && item.ai_key_question !== "None" && item.ai_key_question.trim() !== ""
                    ? item.ai_key_question
                    : item.ai_summary}
                </p>
              </section>
            ) : null}

            {/* ══ SECTION 3 · Actions ══
                Immediately after the conclusion. The product is a decision system. */}
            {(isActionable || madeDecisions.length > 0) && (
              <section className="space-y-2">

                {/* Previously made decisions */}
                {madeDecisions.map(({ reply, meta }) => {
                  const Icon = meta.Icon;
                  return (
                    <div key={reply.id} className={`flex items-start gap-2.5 rounded-panel border px-4 py-3 ${meta.cls}`}>
                      <Icon size={14} className="shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-body font-semibold">{meta.label}</span>
                          <span className="text-caption opacity-70">{reply.author_name} · {timeAgo(reply.figma_created_at)}</span>
                        </div>
                        <p className="text-body leading-snug mt-0.5 break-words">{reply.raw_content}</p>
                      </div>
                    </div>
                  );
                })}

                {/* Action panel */}
                {isActionable && (
                  <div className="rounded-panel border border-border bg-paper p-4 space-y-3">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted">Take action</p>

                    {editingSuggestion ? (
                      <textarea
                        value={suggestionText}
                        onChange={e => setSuggestionText(e.target.value)}
                        rows={2}
                        autoFocus
                        className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-body text-ink outline-none resize-none focus:border-[var(--accent-border)]"
                      />
                    ) : (
                      <p className="text-body text-muted leading-relaxed">{suggestionText}</p>
                    )}

                    {submitMsg && (
                      <p className={`text-caption ${submitMsg.startsWith("Decision") ? "text-green" : "text-red"}`}>
                        {submitMsg}
                      </p>
                    )}

                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => void submitDecision("approve")}
                        disabled={submitting}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-body font-semibold disabled:opacity-40"
                        style={{ background: "var(--green)", color: "#fff", cursor: "pointer" }}
                      >
                        <CheckCircle2 size={13} />
                        {submitting ? "Posting…" : "Capture decision"}
                      </button>
                      <button
                        onClick={() => void submitDecision("clarify")}
                        disabled={submitting}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-body font-medium bg-paper text-ink border border-border hover:border-ink/30 disabled:opacity-40"
                        style={{ cursor: "pointer" }}
                      >
                        <HelpCircle size={13} />
                        Ask for clarification
                      </button>
                      <button
                        onClick={() => setEditingSuggestion(e => !e)}
                        disabled={submitting}
                        className="px-3 py-2 rounded-lg text-body text-muted hover:text-ink border border-border hover:border-ink/20 disabled:opacity-40"
                        style={{ cursor: "pointer" }}
                      >
                        {editingSuggestion ? "Done" : "Edit"}
                      </button>
                      <button
                        onClick={() => void submitDecision("reject")}
                        disabled={submitting}
                        className="ml-auto px-3 py-2 text-body text-muted hover:text-red disabled:opacity-40"
                        style={{ background: "none", border: "none", cursor: "pointer" }}
                      >
                        Ignore
                      </button>
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* ══ SECTION 4 · Cross-tool findings ══
                The strategic differentiator. Memry connects conversations across tools.
                Renders nothing when no links exist. */}
            <ConnectedContext itemType="feedback_item" itemId={item.id} />

            {/* ══ SECTION 5 · Evidence summary ══
                Counts + key points. Collapsed thread inside. */}
            <section>
              <button
                onClick={() => setRawCollapsed(v => !v)}
                className="w-full flex items-center justify-between px-4 py-3 rounded-panel border border-border bg-paper hover:border-ink/20 transition-colors"
                style={{ cursor: "pointer" }}
              >
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted">Evidence</span>
                  <span className="text-caption text-muted">
                    {localReplies.length + 1} message{localReplies.length + 1 !== 1 ? "s" : ""}
                  </span>
                  {localReplies.length > 0 && (
                    <span className="text-caption text-muted">
                      · {Array.from(new Set([fc?.author_name, ...localReplies.map(r => r.author_name)].filter(Boolean))).length} participant{Array.from(new Set([fc?.author_name, ...localReplies.map(r => r.author_name)].filter(Boolean))).length !== 1 ? "s" : ""}
                    </span>
                  )}
                  {item.slack_message_ts && <span className="text-caption text-muted">· Slack thread linked</span>}
                </div>
                <ChevronDown
                  size={13}
                  className="text-muted shrink-0"
                  style={{ transform: rawCollapsed ? "rotate(0deg)" : "rotate(180deg)", transition: "transform 0.15s" }}
                />
              </button>

              {/* Key points from AI tags */}
              {item.ai_tags && item.ai_tags.length > 0 && (
                <div className="px-4 pt-2 pb-1 flex items-center gap-1.5 flex-wrap">
                  {item.ai_tags.map(tag => (
                    <span key={tag} className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-paper border border-border text-muted">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </section>

            {/* ══ SECTION 6 · Original discussion (collapsed) ══
                The thread is evidence. It is not the product. */}
            {!rawCollapsed && (
              <section className="rounded-panel border border-border overflow-hidden">
                {/* Original comment */}
                <div className="px-5 py-4">
                  <div className="flex items-start gap-3">
                    <Avatar name={fc?.author_name} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-body font-semibold text-ink">{fc?.author_name ?? "Unknown"}</span>
                        <span className="text-caption text-muted">{fc?.figma_created_at ? timeAgo(fc.figma_created_at) : ""}</span>
                      </div>
                      {item.author_profile && (item.author_profile.figma_handle || item.author_profile.slack_handle) && (
                        <div className="flex items-center gap-3 mb-1.5 text-caption text-muted">
                          {item.author_profile.figma_handle && <span>Figma @{item.author_profile.figma_handle}</span>}
                          {item.author_profile.slack_handle && <span>Slack @{item.author_profile.slack_handle}</span>}
                        </div>
                      )}
                      <p className="text-lead text-ink leading-relaxed">{fc?.raw_content}</p>
                      <div className="flex items-center gap-1 mt-1.5 text-caption text-muted">
                        <FigmaLogoMini />
                        <span>{item.project?.name}</span>
                        {fc?.figma_file?.name && <><span className="opacity-40 mx-1">/</span><span>{fc.figma_file.name}</span></>}
                        {fc?.page_name && <><span className="opacity-40 mx-1">/</span><span>{fc.page_name}</span></>}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Thread replies */}
                <div className="border-t border-border">
                  <div className="border-b border-border">
                    <div className="flex items-center gap-1 px-4 pt-3">
                      <button
                        onClick={() => setActiveTab("thread")}
                        className={`px-3 py-1.5 text-body font-medium border-b-2 transition-colors ${activeTab === "thread" ? "border-ink text-ink" : "border-transparent text-muted"}`}
                      >
                        Thread
                      </button>
                      {resolvedReplies.length > 0 && (
                        <button
                          onClick={() => setActiveTab("resolved")}
                          className={`px-3 py-1.5 text-body font-medium border-b-2 transition-colors ${activeTab === "resolved" ? "border-ink text-ink" : "border-transparent text-muted"}`}
                        >
                          Resolved <span className="text-caption">{resolvedReplies.length}</span>
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="divide-y divide-border">
                    {displayReplies.length === 0 ? (
                      <p className="px-4 py-6 text-body text-muted text-center">No replies yet</p>
                    ) : (
                      displayReplies.map(r => (
                        <div key={r.id} className="flex items-start gap-3 px-4 py-3.5">
                          <Avatar name={r.author_name} size="sm" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-body font-semibold text-ink">{r.author_name}</span>
                              <span className="text-caption text-muted">{timeAgo(r.figma_created_at)}</span>
                            </div>
                            <p className="text-body text-ink leading-relaxed">{r.raw_content}</p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="flex items-center gap-2 px-4 py-3 border-t border-border bg-surface/50">
                    {(item.status === "open" || item.status === "needs_decision") && (
                      <button
                        onClick={handleResolve}
                        className="px-3 py-1.5 rounded-lg border border-border text-body text-muted hover:text-ink hover:border-ink/30 transition-colors"
                      >
                        Resolve
                      </button>
                    )}
                    <button
                      onClick={handleSummarise}
                      disabled={summarising || !!item.ai_summary}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border text-body text-muted hover:text-ink hover:border-ink/30 transition-colors disabled:opacity-40"
                    >
                      <Sparkles size={11} />
                      {summarising ? "Summarising…" : item.ai_summary ? "Summarised" : "Summarise"}
                    </button>
                    {item.slack_message_ts && item.slack_channel_id && (
                      <a
                        href={`https://slack.com/app_redirect?channel=${item.slack_channel_id}&message_ts=${item.slack_message_ts}`}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border text-body text-muted hover:text-ink transition-colors"
                      >
                        <MessageSquare size={11} />
                        Slack
                      </a>
                    )}
                  </div>

                  <div className="flex items-center gap-3 px-4 py-3 border-t border-border">
                    <input
                      value={replyText}
                      onChange={e => setReplyText(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void handleReply(); }}
                      placeholder="Reply to thread…"
                      className="flex-1 bg-transparent text-body text-ink placeholder:text-muted outline-none"
                    />
                    {replyText.trim() && (
                      <button
                        onClick={handleReply}
                        disabled={replying}
                        className="text-ink hover:opacity-60 transition-opacity disabled:opacity-40"
                      >
                        <Send size={15} />
                      </button>
                    )}
                  </div>
                </div>
              </section>
            )}

          </div>
        </div>
      </div>

      {/* ── Right: sidebar — owner + lightweight design thumbnail ── */}
      <div className="w-64 shrink-0 overflow-y-auto bg-paper border-l border-border hidden lg:block">
        <div className="p-4 space-y-4">
          <OwnerPanel item={item} profiles={profiles} onOwnerChange={handleOwnerChange} />
          <DesignThumbnail item={item} />
        </div>
      </div>

    </div>
  );
}
