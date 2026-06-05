"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Sparkles, CheckCircle2, AlertCircle,
  HelpCircle, ExternalLink, Send, MoreHorizontal, Bookmark,
  Activity, ZoomIn, MessageSquare, Clock, ChevronDown, Zap,
  type LucideIcon,
} from "lucide-react";

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
  figma_comment: FigmaComment | null;
  design_reference: DesignReference | null;
  project: { id: string; name: string } | null;
  replies: Reply[];
}

type DecisionType = "approve" | "needs_work" | "clarify" | null;

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
    pending: { label: "Generating…", cls: "bg-yellow-50 text-yellow-600" },
    ready:   { label: "Preview ready", cls: "bg-emerald-50 text-emerald-600" },
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
  open:           { label: "Open",           pillCls: "bg-sky-50 text-sky-700 border-sky-200",       dotCls: "bg-sky-400"     },
  needs_decision: { label: "Needs Decision", pillCls: "bg-orange-50 text-orange-700 border-orange-200", dotCls: "bg-orange-400" },
  resolved:       { label: "Resolved",       pillCls: "bg-emerald-50 text-emerald-700 border-emerald-200", dotCls: "bg-emerald-400" },
  archived:       { label: "Archived",       pillCls: "bg-gray-100 text-gray-500 border-gray-200",   dotCls: "bg-gray-300"    },
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

// ── Decision-intelligence presentation (Stage 2A) ─────────────────────────────
// Pure, presentation-only helpers. They read existing AI fields already returned
// by GET /api/feedback and map them to the app's existing colour vocabulary
// (mirrors app/(app)/decisions/page.tsx and app/(app)/risks/page.tsx). No backend
// or business logic is involved.

// Classification → colour, mirrored from the decisions page.
const CLASSIFICATION_CLS: Record<string, string> = {
  "Needs Decision": "text-red-500 bg-red-50",
  "Blocked":        "text-red-500 bg-red-50",
  "Approved":       "text-emerald-600 bg-emerald-50",
  "Risk":           "text-orange-500 bg-orange-50",
  "Vague":          "text-yellow-600 bg-yellow-50",
  "Info":           "text-blue-500 bg-blue-50",
};

// Priority → colour, mirrored from the risks page severity vocabulary.
const PRIORITY_META: Record<string, { label: string; cls: string }> = {
  high:   { label: "High priority",   cls: "text-red-600 bg-red-50"     },
  medium: { label: "Medium priority", cls: "text-orange-600 bg-orange-50" },
  low:    { label: "Low priority",    cls: "text-muted bg-wash"          },
};

/** Parse a decision reply (same ✅/⚠️/❓ prefixes written by handleMakeDecision). */
function parseDecision(raw: string): { label: string; cls: string; Icon: LucideIcon } | null {
  if (raw.startsWith("✅")) return { label: "Accepted",      cls: "text-emerald-700 bg-emerald-50 border-emerald-200", Icon: CheckCircle2 };
  if (raw.startsWith("⚠️")) return { label: "Needs Work",    cls: "text-orange-600 bg-orange-50 border-orange-200",   Icon: AlertCircle  };
  if (raw.startsWith("❓")) return { label: "Clarification", cls: "text-blue-600 bg-blue-50 border-blue-200",         Icon: HelpCircle   };
  return null;
}

// ── SECTION 1 · Decision Summary Hero ─────────────────────────────────────────
// The 5-second answer: status + classification + priority + risk/vague + summary
// + key question, all surfaced at the very top.
// Stage 2A.1: severity tones the hero panel bg/border; redundant chips and
// low-priority are suppressed; empty summary is demoted to body-level text.
function DecisionSummaryHero({ item }: { item: FeedbackItem }) {
  const status   = STATUS_META[item.status] ?? STATUS_META.open;
  const classCls = item.ai_classification
    ? CLASSIFICATION_CLS[item.ai_classification] ?? "text-muted bg-wash"
    : null;

  // Show priority only when it adds urgency signal (low is absence of urgency)
  const priority = (item.priority === "high" || item.priority === "medium")
    ? PRIORITY_META[item.priority] : null;

  // Hero panel tones — risk is communicated by the panel itself, not a second section
  const blocked = item.ai_classification === "Blocked";
  const hasRisk = item.ai_risk_flag || item.ai_classification === "Risk";
  const heroPanel = blocked        ? "border-red-200 bg-red-50"
                  : hasRisk        ? "border-orange-200 bg-orange-50"
                  : item.ai_vague_flag ? "border-yellow-200 bg-yellow-50"
                  : "border-border bg-surface";

  // Suppress risk/vague chips when the classification badge already says the same thing
  const showRiskChip  = item.ai_risk_flag
    && item.ai_classification !== "Blocked"
    && item.ai_classification !== "Risk";
  const showVagueChip = item.ai_vague_flag
    && item.ai_classification !== "Vague";

  return (
    <section className={`rounded-panel border ${heroPanel} px-5 py-4 space-y-3`}>
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted">Decision Summary</p>

      {/* Signal row — each chip only appears when it adds new information */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${status.pillCls}`}>
          {status.label}
        </span>
        {classCls && item.ai_classification && (
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${classCls}`}>
            {item.ai_classification}
          </span>
        )}
        {priority && (
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${priority.cls}`}>
            {priority.label}
          </span>
        )}
        {showRiskChip && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider text-orange-500 bg-orange-50">
            <AlertCircle size={10} /> Risk
          </span>
        )}
        {showVagueChip && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider text-yellow-600 bg-yellow-50">
            <HelpCircle size={10} /> Vague
          </span>
        )}
      </div>

      {/* Summary — empty state demoted to body text so it doesn't compete with real content */}
      {item.ai_summary ? (
        <p className="text-lead text-ink leading-relaxed">{item.ai_summary}</p>
      ) : (
        <p className="text-body text-muted">No AI summary yet — generate one from the discussion below.</p>
      )}

      {/* Suggested Action callout */}
      {item.ai_suggested_action && (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-violet-50 border border-violet-200">
          <Zap size={13} className="text-violet-500 shrink-0" />
          <div>
            <p className="text-[9px] font-bold uppercase tracking-widest text-violet-400 mb-0.5">Suggested Action</p>
            <p className="text-body font-semibold text-violet-700 leading-snug">{item.ai_suggested_action}</p>
          </div>
        </div>
      )}

      {/* Key question */}
      {item.ai_key_question && (
        <div className="flex items-start gap-2 rounded-lg bg-paper border border-border px-3 py-2">
          <HelpCircle size={13} className="text-muted shrink-0 mt-0.5" />
          <p className="text-body text-ink leading-snug">
            <span className="text-muted font-medium">Key question: </span>{item.ai_key_question}
          </p>
        </div>
      )}

      {/* Vague reason — only when the AI flagged vagueness AND gave a reason */}
      {item.ai_vague_flag && item.ai_vague_reason && (
        <div className="flex items-start gap-2 rounded-lg bg-yellow-50 border border-yellow-200 px-3 py-2">
          <HelpCircle size={13} className="text-yellow-600 shrink-0 mt-0.5" />
          <p className="text-body text-yellow-800 leading-snug">
            <span className="font-medium">Why this is vague: </span>{item.ai_vague_reason}
          </p>
        </div>
      )}

      {/* AI tags */}
      {item.ai_tags && item.ai_tags.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {item.ai_tags.map(tag => (
            <span
              key={tag}
              className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-paper border border-border text-muted"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* AI Uncertain — shown only when confidence < 0.70 */}
      {item.ai_confidence !== null && item.ai_confidence < 0.70 && (
        <p className="text-caption text-muted italic">
          AI Uncertain — classification may not be accurate
        </p>
      )}
    </section>
  );
}

// ── Design context card ───────────────────────────────────────────────────────

function DesignContextPreview({ item, frameCommentCount }: {
  item: FeedbackItem;
  frameCommentCount: number;
}) {
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genMsg, setGenMsg] = useState<string | null>(null);

  async function handleGeneratePreview(e: React.MouseEvent) {
    e.preventDefault(); // card is a link — stop navigation
    setGenerating(true);
    setGenMsg(null);
    try {
      const res = await fetch("/api/figma/enrich-previews", { method: "POST" });
      const data = await res.json() as {
        ok: boolean; enriched?: number; processed?: number;
        retryAfterHours?: number; message?: string;
      };
      if (!data.ok && data.retryAfterHours) {
        setGenMsg(`Rate limited — retry in ~${data.retryAfterHours}h`);
      } else if (data.enriched && data.enriched > 0) {
        setGenMsg("Preview ready — reload to see it");
      } else {
        setGenMsg(data.message ?? "Nothing to generate");
      }
    } catch {
      setGenMsg("Request failed");
    }
    setGenerating(false);
  }

  const dr = item.design_reference;
  const fc = item.figma_comment;
  const fileKey   = dr?.file_key ?? fc?.figma_file?.figma_file_key ?? null;
  const nodeId    = dr?.node_id ?? item.figma_node_id ?? null;
  const frameName = dr?.frame_name ?? fc?.frame_name ?? null;
  const pageName  = dr?.page_name  ?? fc?.page_name  ?? null;
  const fileName  = fc?.figma_file?.name ?? null;
  const previewStatus = dr?.preview_status ?? "pending";
  const failureInfo = previewFailureInfo(dr?.preview_error_reason);
  const thumbUrl  = (previewStatus === "ready" ? dr?.thumbnail_url : null) ?? item.figma_preview_url ?? null;
  const showImage = !!thumbUrl && !imgError;

  // DEBUG — remove once gray-placeholder bug is identified
  console.log("[preview:detail]", {
    itemId: item.id,
    nodeId,
    previewStatus,
    drThumbnailUrl: dr?.thumbnail_url ?? null,
    figmaPreviewUrl: item.figma_preview_url ?? null,
    thumbUrl,
    showImage,
    imgLoaded,
    imgError,
  });

  // Figma deep link: goes directly to the node, not just the file
  const figmaUrl = fileKey
    ? `https://www.figma.com/design/${fileKey}${nodeId ? `?node-id=${encodeURIComponent(nodeId)}` : ""}`
    : null;

  const { primary: displayName, isGeneric } = resolveDisplayName(frameName, pageName);

  // Last activity = most recent of: comment created, last reply
  const allTimes = [
    fc?.figma_created_at,
    ...((item.replies ?? []).map(r => r.figma_created_at)),
  ].filter(Boolean) as string[];
  const lastActivityAt = allTimes.length
    ? allTimes.reduce((latest, t) => (t > latest ? t : latest))
    : item.created_at;

  return (
    <a
      href={figmaUrl ?? "#"}
      target={figmaUrl ? "_blank" : undefined}
      rel="noreferrer"
      className="block border border-border rounded-panel overflow-hidden bg-paper hover:border-ink/20 hover:shadow-sm transition-all group"
      onClick={figmaUrl ? undefined : e => e.preventDefault()}
    >
      {/* ── Preview image ── */}
      {showImage ? (
        <div
          className={`relative bg-[#F0F0F0] overflow-hidden transition-all duration-200 ${expanded ? "h-64" : "h-44"}`}
          onClick={e => { e.preventDefault(); setExpanded(v => !v); }}
        >
          {!imgLoaded && <div className="absolute inset-0 skeleton" />}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={thumbUrl!}
            alt={displayName}
            className={`w-full h-full object-cover transition-opacity duration-300 ${imgLoaded ? "opacity-100" : "opacity-0"}`}
            onLoad={() => { console.log("[preview:detail] onLoad fired", thumbUrl); setImgLoaded(true); }}
            onError={() => { console.log("[preview:detail] onError fired", thumbUrl); setImgError(true); }}
            loading="lazy"
          />
          {/* Expand hint */}
          <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <span className="bg-black/40 text-white rounded p-1 flex items-center">
              <ZoomIn size={11} />
            </span>
          </div>
        </div>
      ) : (
        /* No-image placeholder — still shows all context */
        <div className="bg-[#F7F7F8] px-4 pt-4 pb-3 border-b border-border">
          <span className={`text-[9px] font-bold uppercase tracking-[0.15em] block mb-1 ${
            imgError
              ? "text-red-400"
              : previewStatus === "failed"
                ? failureInfo.tone === "warning" ? "text-amber-500" : "text-red-400"
                : "text-gray-400"
          }`}>
            {imgError
              ? "Preview failed to load"
              : previewStatus === "failed"
                ? failureInfo.label
                : "Frame"}
          </span>
          <p className="text-[20px] font-bold text-gray-700 leading-tight mb-0.5 break-words">
            {displayName}
          </p>
          {isGeneric && frameName && pageName && (
            <p className="text-[10px] text-gray-400">Frame {frameName}</p>
          )}
        </div>
      )}

      {/* ── Context rows ── */}
      <div className="px-4 py-3 space-y-2.5">

        {/* Primary label (below image) + breadcrumb */}
        <div>
          {/* Display name */}
          <p className="text-body font-semibold text-ink leading-snug break-words">
            {displayName}
          </p>
          {/* Breadcrumb: page / file */}
          <div className="flex items-center gap-1 mt-0.5 text-caption text-muted overflow-hidden">
            <FigmaLogoMini />
            {pageName && (
              <><span className="truncate">{pageName}</span><span className="opacity-40 shrink-0">/</span></>
            )}
            {fileName && <span className="truncate">{fileName}</span>}
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-border" />

        {/* Activity */}
        <div className="flex items-center justify-between text-caption text-muted">
          <span className="flex items-center gap-1.5">
            <MessageSquare size={11} className="shrink-0" />
            <span>
              {frameCommentCount === 1
                ? "1 comment on this frame"
                : `${frameCommentCount} comments on this frame`}
            </span>
          </span>
          <span className="flex items-center gap-1 shrink-0 ml-2">
            <Clock size={10} className="shrink-0" />
            <span>{timeAgo(lastActivityAt)}</span>
          </span>
        </div>

        {/* Retry loading — image URL exists but browser failed to load it */}
        {imgError && thumbUrl && (
          <button
            onClick={() => setImgError(false)}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-border text-body text-muted hover:text-ink hover:border-ink/30 transition-colors"
          >
            Retry loading preview
          </button>
        )}

        {/* Generate preview — no URL exists yet and not already ready */}
        {!showImage && !imgError && previewStatus !== "ready" && (
          <div className="space-y-1">
            <button
              onClick={handleGeneratePreview}
              disabled={generating}
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-ink text-paper text-body font-medium hover:opacity-80 disabled:opacity-40 transition-opacity"
            >
              {generating
                ? <><span className="w-3 h-3 rounded-full border-2 border-paper/30 border-t-paper animate-spin" />Generating…</>
                : "Generate Frame Preview"}
            </button>
            {genMsg && (
              <p className={`text-caption text-center ${
                genMsg.includes("Rate") ? "text-orange-500"
                : genMsg.includes("ready") ? "text-emerald-600"
                : "text-muted"
              }`}>
                {genMsg}
              </p>
            )}
          </div>
        )}

        {/* Open in Figma row — only when figmaUrl known */}
        {figmaUrl && (
          <div className="flex items-center gap-1 text-caption text-muted group-hover:text-ink transition-colors">
            <ExternalLink size={10} className="shrink-0" />
            <span>Open in Figma</span>
          </div>
        )}
      </div>
    </a>
  );
}

// ─── Activity log ─────────────────────────────────────────────────────────────

function ActivityLog({ item }: { item: FeedbackItem }) {
  const events = [
    { time: item.figma_comment?.figma_created_at ?? item.created_at, label: "Comment created in Figma", sub: `By ${item.figma_comment?.author_name ?? "Unknown"}`, icon: "figma" },
    { time: item.created_at, label: "Synced to memry", sub: "Auto detection completed", icon: "sync" },
    ...(item.ai_classification ? [{ time: item.created_at, label: "AI analysis completed", sub: item.ai_classification, icon: "ai" }] : []),
    ...(item.replies ?? []).map(r => ({
      time: r.figma_created_at,
      label: `${r.author_name ?? "Someone"} replied: ${r.raw_content?.slice(0, 60) ?? ""}${(r.raw_content?.length ?? 0) > 60 ? "…" : ""}`,
      sub: `By ${r.author_name}`,
      icon: "reply",
    })),
  ].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

  const iconMap: Record<string, React.ReactNode> = {
    figma: (
      <svg width="10" height="14" viewBox="0 0 38 57" fill="none">
        <path d="M19 28.5C19 23.8 22.8 20 27.5 20C32.2 20 36 23.8 36 28.5C36 33.2 32.2 37 27.5 37C22.8 37 19 33.2 19 28.5Z" fill="#1ABCFE"/>
        <path d="M2 46C2 41.3 5.8 37.5 10.5 37.5H19V46C19 50.7 15.2 54.5 10.5 54.5C5.8 54.5 2 50.7 2 46Z" fill="#0ACF83"/>
        <path d="M19 2V20H27.5C32.2 20 36 16.2 36 11.5C36 6.8 32.2 3 27.5 3H19V2Z" fill="#FF7262"/>
        <path d="M2 11.5C2 16.2 5.8 20 10.5 20H19V3H10.5C5.8 3 2 6.8 2 11.5Z" fill="#F24E1E"/>
        <path d="M2 28.5C2 33.2 5.8 37 10.5 37H19V20H10.5C5.8 20 2 23.8 2 28.5Z" fill="#FF7262"/>
      </svg>
    ),
    sync: <span className="text-[11px]">↻</span>,
    ai: <Sparkles size={10} />,
    reply: <span className="text-[11px]">↩</span>,
  };

  return (
    <div className="border border-border rounded-panel overflow-hidden bg-paper">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted">Activity Log</span>
        <button className="text-caption text-muted hover:text-ink transition-colors">Show all</button>
      </div>
      <div className="divide-y divide-border">
        {events.slice(0, 5).map((e, i) => (
          <div key={i} className="flex items-start gap-3 px-4 py-3">
            <div className="w-5 h-5 rounded-full bg-surface border border-border flex items-center justify-center shrink-0 mt-0.5 text-muted">
              {iconMap[e.icon] ?? <Activity size={10} />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-body font-medium text-ink leading-snug">{e.label}</p>
              <p className="text-caption text-muted mt-0.5">{e.sub}</p>
            </div>
            <span className="text-caption text-muted shrink-0">{timeAgo(e.time)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ItemDetailPage({ params }: { params: { projectId: string; itemId: string } }) {
  const { projectId, itemId } = params;
  const router = useRouter();

  const [item, setItem] = useState<FeedbackItem | null>(null);
  const [frameCommentCount, setFrameCommentCount] = useState<number>(1);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"thread" | "resolved">("thread");

  // Decision state
  const [decision, setDecision] = useState<DecisionType>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);

  // Reply
  const [replyText, setReplyText] = useState("");
  const [replying, setReplying] = useState(false);
  const [localReplies, setLocalReplies] = useState<Reply[]>([]);

  // Summary
  const [summarising, setSummarising] = useState(false);

  function fetchItem(silent = false) {
    fetch(`/api/feedback?projectId=${projectId}`)
      .then(r => r.json())
      .then((d: { items?: FeedbackItem[] }) => {
        const all = d.items ?? [];
        const found = all.find(i => i.id === itemId) ?? null;
        setItem(found);
        if (found) {
          setLocalReplies(found.replies ?? []);
          // Count all top-level comments on the same frame (same node_id)
          const sameFrame = all.filter(i => i.figma_node_id && i.figma_node_id === found.figma_node_id);
          setFrameCommentCount(sameFrame.length);
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

  async function handleMakeDecision() {
    if (!decision || !item) return;
    const prefix = decision === "approve" ? "✅ Approved" : decision === "needs_work" ? "⚠️ Needs Work" : "❓ Asking for clarification";
    const message = note.trim() ? `${prefix}: ${note.trim()}` : prefix;
    setSubmitting(true);
    const res = await fetch(`/api/feedback/${item.id}/reply`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, resolve: decision === "approve" }),
    });
    const data = await res.json() as { ok?: boolean; error?: string };
    if (res.ok) {
      setSubmitMsg("Decision posted to Figma");
      setItem(prev => prev ? { ...prev, status: decision === "approve" ? "resolved" : "open" } : prev);
      setLocalReplies(prev => [...prev, {
        id: `temp-${Date.now()}`, author_name: "You",
        raw_content: message, figma_created_at: new Date().toISOString(),
      }]);
      setActiveTab("resolved");
      setNote(""); setDecision(null);
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
        <p className="text-lead font-medium text-ink">Comment not found</p>
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
            {item.slack_message_ts && item.slack_channel_id && (
              <a
                href={`https://slack.com/app_redirect?channel=${item.slack_channel_id}&message_ts=${item.slack_message_ts}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border text-body text-muted hover:text-ink hover:border-ink/30 transition-colors"
              >
                <MessageSquare size={13} />
                Open Slack Thread
              </a>
            )}
            <button className="text-muted hover:text-ink transition-colors"><Bookmark size={15} /></button>
            <button className="text-muted hover:text-ink transition-colors"><MoreHorizontal size={15} /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="px-6 py-5 space-y-5">

            {/* ── SECTION 1 · Decision Summary Hero ── */}
            <DecisionSummaryHero item={item} />

            {/* ── SECTION 3 · Key Decisions ── */}
            {(isActionable || madeDecisions.length > 0) && (
              <section className="space-y-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted">Key Decisions</p>

                {/* Decisions already made (parsed from resolved replies) */}
                {madeDecisions.length > 0 && (
                  <div className="space-y-2">
                    {madeDecisions.map(({ reply, meta }) => {
                      const Icon = meta.Icon;
                      return (
                        <div key={reply.id} className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 ${meta.cls}`}>
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
                  </div>
                )}

                {/* Decision panel — moved above discussion; handlers unchanged */}
                {isActionable && (
                  <div className="rounded-panel border border-border overflow-hidden">
                    {/* Decision buttons */}
                    <div className="grid grid-cols-3 divide-x divide-border border-b border-border">
                      <button
                        onClick={() => setDecision(d => d === "approve" ? null : "approve")}
                        className={`flex items-center justify-center gap-1.5 py-3 text-body font-medium transition-colors ${
                          decision === "approve" ? "bg-emerald-50 text-emerald-700" : "text-muted hover:text-emerald-600 hover:bg-emerald-50/50"
                        }`}
                      >
                        <CheckCircle2 size={14} /> Approve
                      </button>
                      <button
                        onClick={() => setDecision(d => d === "needs_work" ? null : "needs_work")}
                        className={`flex items-center justify-center gap-1.5 py-3 text-body font-medium transition-colors ${
                          decision === "needs_work" ? "bg-orange-50 text-orange-600" : "text-muted hover:text-orange-500 hover:bg-orange-50/50"
                        }`}
                      >
                        <AlertCircle size={14} /> Needs Work
                      </button>
                      <button
                        onClick={() => setDecision(d => d === "clarify" ? null : "clarify")}
                        className={`flex items-center justify-center gap-1.5 py-3 text-body font-medium transition-colors ${
                          decision === "clarify" ? "bg-blue-50 text-blue-600" : "text-muted hover:text-blue-500 hover:bg-blue-50/50"
                        }`}
                      >
                        <HelpCircle size={14} /> Ask for Clarification
                      </button>
                    </div>

                    {/* Note input */}
                    <div className="px-4 py-3">
                      <textarea
                        value={note}
                        onChange={e => setNote(e.target.value)}
                        rows={2}
                        placeholder="Add a note (optional) — will be included with your decision"
                        className="w-full bg-transparent text-body text-ink placeholder:text-muted outline-none resize-none"
                      />
                    </div>

                    {/* Make Decision CTA */}
                    <div className="px-4 pb-4">
                      {submitMsg && (
                        <p className={`text-caption mb-2 ${submitMsg.startsWith("Decision") ? "text-emerald-600" : "text-red-500"}`}>
                          {submitMsg}
                        </p>
                      )}
                      <button
                        onClick={handleMakeDecision}
                        disabled={!decision || submitting}
                        className="w-full flex items-center justify-center gap-2 py-3 rounded-lg bg-ink text-paper text-body font-semibold hover:opacity-80 disabled:opacity-30 transition-opacity"
                      >
                        <Send size={14} />
                        {submitting ? "Posting decision…" : "Make Decision"}
                      </button>
                      {decision && (
                        <p className="text-caption text-muted text-center mt-2">
                          Decision will be posted to Figma as a reply
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* ── Discussion ── */}
            {/* Original comment */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted mb-3">Original Comment</p>
              <div className="flex items-start gap-3">
                <Avatar name={fc?.author_name} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-body font-semibold text-ink">{fc?.author_name ?? "Unknown"}</span>
                    <span className="text-caption text-muted">{fc?.figma_created_at ? timeAgo(fc.figma_created_at) : ""}</span>
                  </div>
                  <p className="text-lead text-ink leading-relaxed">{fc?.raw_content}</p>
                  {/* Breadcrumb */}
                  <div className="flex items-center gap-1 mt-1.5 text-caption text-muted">
                    <svg width="8" height="11" viewBox="0 0 38 57" fill="none" className="shrink-0 opacity-40">
                      <path d="M19 28.5C19 23.8 22.8 20 27.5 20C32.2 20 36 23.8 36 28.5C36 33.2 32.2 37 27.5 37C22.8 37 19 33.2 19 28.5Z" fill="#1ABCFE"/>
                      <path d="M2 46C2 41.3 5.8 37.5 10.5 37.5H19V46C19 50.7 15.2 54.5 10.5 54.5C5.8 54.5 2 50.7 2 46Z" fill="#0ACF83"/>
                      <path d="M19 2V20H27.5C32.2 20 36 16.2 36 11.5C36 6.8 32.2 3 27.5 3H19V2Z" fill="#FF7262"/>
                      <path d="M2 11.5C2 16.2 5.8 20 10.5 20H19V3H10.5C5.8 3 2 6.8 2 11.5Z" fill="#F24E1E"/>
                      <path d="M2 28.5C2 33.2 5.8 37 10.5 37H19V20H10.5C5.8 20 2 23.8 2 28.5Z" fill="#FF7262"/>
                    </svg>
                    <span>{item.project?.name}</span>
                    {fc?.figma_file?.name && <><span className="opacity-40">/</span><span>{fc.figma_file.name}</span></>}
                    {fc?.page_name && <><span className="opacity-40">/</span><span>{fc.page_name}</span></>}
                  </div>
                </div>
              </div>
            </div>

            {/* Thread replies */}
            <div className="rounded-panel border border-border overflow-hidden">
              {/* Thread header */}
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

              {/* Reply list */}
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

              {/* Action buttons */}
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
              </div>

              {/* Quick reply input */}
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

            {/* Resolved / Archived state banner */}
            {item.status === "resolved" && (
              <div className="flex items-center gap-2 px-4 py-3 rounded-panel border border-emerald-200 bg-emerald-50">
                <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
                <p className="text-body text-emerald-700 font-medium">This comment has been resolved</p>
              </div>
            )}
            {item.status === "archived" && (
              <div className="flex items-center gap-2 px-4 py-3 rounded-panel border border-gray-200 bg-gray-50">
                <CheckCircle2 size={15} className="text-gray-400 shrink-0" />
                <p className="text-body text-gray-500 font-medium">This item is archived</p>
              </div>
            )}

          </div>
        </div>
      </div>

      {/* ── Right: context sidebar ── */}
      <div className="w-80 shrink-0 overflow-y-auto bg-paper border-l border-border hidden lg:block">
        <div className="p-4 space-y-4">
          <DesignContextPreview item={item} frameCommentCount={frameCommentCount} />
          <ActivityLog item={item} />
        </div>
      </div>

    </div>
  );
}
