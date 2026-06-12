"use client";
/**
 * Linked-discussion panel (Sprint 35). Shows what Memry connected:
 * the topic this item belongs to, its members across Figma and Slack,
 * suggestion accept/dismiss, and unlink. Renders nothing when the item
 * has no links — the panel only appears when Memry found something.
 */
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Link2, CheckCircle2, X } from "lucide-react";

interface Member {
  link_id: string;
  item_type: string;
  item_id: string;
  status: string;
  title: string;
  source: "figma" | "slack" | "manual";
  meta: string | null;
  created_at: string | null;
  href: string | null;
}

interface TopicData {
  topic: { id: string; title: string; summary: string | null } | null;
  members: Member[];
  my_link: { id: string; status: string; confidence: number } | null;
}

function SourceMark({ source }: { source: string }) {
  if (source === "slack") {
    return (
      <svg width="11" height="11" viewBox="0 0 122.8 122.8" className="shrink-0">
        <path d="M25.8 77.6c0 7.1-5.8 12.9-12.9 12.9S0 84.7 0 77.6s5.8-12.9 12.9-12.9h12.9v12.9zm6.5 0c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9v32.3c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V77.6z" fill="#e01e5a"/>
        <path d="M45.2 25.8c-7.1 0-12.9-5.8-12.9-12.9S38.1 0 45.2 0s12.9 5.8 12.9 12.9v12.9H45.2zm0 6.5c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H12.9C5.8 58.1 0 52.3 0 45.2s5.8-12.9 12.9-12.9h32.3z" fill="#36c5f0"/>
        <path d="M97 45.2c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9-5.8 12.9-12.9 12.9H97V45.2zm-6.5 0c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V12.9C64.7 5.8 70.5 0 77.6 0s12.9 5.8 12.9 12.9v32.3z" fill="#2eb67d"/>
        <path d="M77.6 97c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9-12.9-5.8-12.9-12.9V97h12.9zm0-6.5c-7.1 0-12.9-5.8-12.9-12.9s5.8-12.9 12.9-12.9h32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H77.6z" fill="#ecb22e"/>
      </svg>
    );
  }
  if (source === "figma") {
    return (
      <svg width="9" height="12" viewBox="0 0 38 57" fill="none" className="shrink-0">
        <path d="M19 28.5C19 23.8 22.8 20 27.5 20C32.2 20 36 23.8 36 28.5C36 33.2 32.2 37 27.5 37C22.8 37 19 33.2 19 28.5Z" fill="#1ABCFE"/>
        <path d="M2 46C2 41.3 5.8 37.5 10.5 37.5H19V46C19 50.7 15.2 54.5 10.5 54.5C5.8 54.5 2 50.7 2 46Z" fill="#0ACF83"/>
        <path d="M19 2V20H27.5C32.2 20 36 16.2 36 11.5C36 6.8 32.2 3 27.5 3H19V2Z" fill="#FF7262"/>
        <path d="M2 11.5C2 16.2 5.8 20 10.5 20H19V3H10.5C5.8 3 2 6.8 2 11.5Z" fill="#F24E1E"/>
        <path d="M2 28.5C2 33.2 5.8 37 10.5 37H19V20H10.5C5.8 20 2 23.8 2 28.5Z" fill="#A259FF"/>
      </svg>
    );
  }
  return <CheckCircle2 style={{ width: 11, height: 11, color: "var(--green)" }} className="shrink-0" />;
}

function timeAgo(date: string | null): string {
  if (!date) return "";
  const d = Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
  if (d < 1) return "today";
  if (d < 30) return `${d}d ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

export default function ConnectedContext({ itemType, itemId, heading = "Connected Context" }: {
  itemType: "feedback_item" | "decision";
  itemId: string;
  heading?: string;
}) {
  const [data, setData]   = useState<TopicData | null>(null);
  const [acting, setActing] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/topics/for-item?type=${itemType}&id=${itemId}`)
      .then(r => r.json())
      .then((d: TopicData) => setData(d))
      .catch(() => setData(null));
  }, [itemType, itemId]);

  useEffect(() => { load(); }, [load]);

  async function act(linkId: string, action: "accept" | "dismiss" | "unlink") {
    setActing(true);
    try {
      await fetch(`/api/topics/links/${linkId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (action === "accept") load();
      else setData(null);
    } finally {
      setActing(false);
    }
  }

  if (!data?.topic || !data.my_link) return null;

  const { topic, members, my_link } = data;
  const suggested = my_link.status === "suggested";
  const sources = new Set(members.map(m => m.source));

  return (
    <div className="rounded-panel border bg-paper p-3.5 space-y-2.5"
      style={{ borderColor: suggested ? "color-mix(in oklab, var(--blue) 30%, #ffffff)" : "var(--border)" }}>
      <p className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5"
        style={{ color: suggested ? "var(--blue)" : "var(--text-3)" }}>
        <Link2 size={11} />
        {suggested ? "Possible connection" : heading}
      </p>

      <div>
        <p className="text-body font-semibold text-ink leading-snug">{topic.title}</p>
        <p className="text-[10px] text-muted mt-0.5">
          {suggested
            ? "Memry thinks this belongs to the discussion below."
            : `Memry connected ${members.length} item${members.length !== 1 ? "s" : ""}${sources.size > 1 ? " across tools" : ""} automatically.`}
        </p>
      </div>

      <div className="space-y-1.5">
        {members.map(m => {
          const isSelf = m.item_type === itemType && m.item_id === itemId;
          const row = (
            <span className="flex items-center gap-2 min-w-0">
              <SourceMark source={m.source} />
              <span className={`text-caption truncate ${isSelf ? "text-muted" : "text-ink"}`}>
                {m.title}
              </span>
              {isSelf && <span className="text-[9px] text-muted shrink-0">(this)</span>}
              <span className="font-mono text-[9px] text-muted shrink-0 ml-auto">
                {m.meta ? `${m.meta} · ` : ""}{timeAgo(m.created_at)}
              </span>
            </span>
          );
          return isSelf || !m.href ? (
            <div key={m.link_id}>{row}</div>
          ) : (
            <Link key={m.link_id} href={m.href} className="block hover:bg-[var(--accent-softer)] rounded px-1 -mx-1 transition-colors">
              {row}
            </Link>
          );
        })}
      </div>

      {suggested ? (
        <div className="flex items-center gap-2 pt-0.5">
          <button
            onClick={() => act(my_link.id, "accept")}
            disabled={acting}
            className="text-caption font-medium px-3 py-1 rounded-lg text-white disabled:opacity-40"
            style={{ background: "var(--blue)", border: "none", cursor: "pointer" }}
          >
            Link
          </button>
          <button
            onClick={() => act(my_link.id, "dismiss")}
            disabled={acting}
            className="text-caption text-muted hover:text-ink px-2 py-1 disabled:opacity-40"
            style={{ background: "none", border: "none", cursor: "pointer" }}
          >
            <X size={10} className="inline mr-0.5" />Dismiss
          </button>
        </div>
      ) : (
        <button
          onClick={() => act(my_link.id, "unlink")}
          disabled={acting}
          className="text-[10px] text-muted hover:text-red transition-colors"
          style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}
        >
          Not related? Unlink
        </button>
      )}
    </div>
  );
}
