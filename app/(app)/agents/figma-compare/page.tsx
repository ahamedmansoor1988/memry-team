"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Play, Loader2, ChevronRight,
  AlertCircle, CheckCircle2, Trash2, ArrowUp,
  FileCode2, Globe, KeyRound, Sparkles, Check,
} from "lucide-react";

interface Message {
  id: string;
  type: "user" | "step" | "result" | "error";
  text: string;
  table?: DiscrepancyRow[];
}

interface DiscrepancyRow {
  element: string;
  issue: string;
  commentId?: string;
}

const CHECK_OPTIONS = [
  { id: "font_family", label: "Font Family" },
  { id: "font_size",   label: "Font Size"   },
  { id: "font_weight", label: "Font Weight" },
  { id: "color",       label: "Color"       },
  { id: "spacing",     label: "Spacing"     },
  { id: "menu",        label: "Menu / Nav"  },
  { id: "footer",      label: "Footer"      },
  { id: "buttons",     label: "Buttons"     },
];

export default function FigmaComparePage() {
  const [figmaUrl,  setFigmaUrlRaw]  = useState("");
  const [liveUrl,   setLiveUrlRaw]   = useState("");
  const [pat,       setPatRaw]       = useState("");
  const [running,   setRunning]      = useState(false);
  const [liveStyles,    setLiveStyles]    = useState<any[] | null>(null);
  const [liveStylesUrl, setLiveStylesUrl] = useState("");
  const [messages,  setMessages]     = useState<Message[]>([]);
  const [configOpen, setConfigOpen]  = useState(false);
  const [checks, setChecks] = useState<Set<string>>(
    new Set(["font_family", "font_size", "font_weight", "color"])
  );

  const bottomRef     = useRef<HTMLDivElement>(null);
  const liveStylesRef = useRef<any[] | null>(null);
  liveStylesRef.current = liveStyles;

  const setFigmaUrl = useCallback((v: string) => { setFigmaUrlRaw(v); localStorage.setItem("loupe_figma_url", v); }, []);
  const setLiveUrl  = useCallback((v: string) => { setLiveUrlRaw(v);  localStorage.setItem("loupe_live_url",  v); }, []);
  const setPat      = useCallback((v: string) => { setPatRaw(v);      localStorage.setItem("loupe_pat",       v); }, []);

  function toggleCheck(id: string) {
    setChecks(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  useEffect(() => {
    setFigmaUrlRaw(localStorage.getItem("loupe_figma_url") ?? "");
    setLiveUrlRaw(localStorage.getItem("loupe_live_url")   ?? "");
    setPatRaw(localStorage.getItem("loupe_pat")            ?? "");
  }, []);

  useEffect(() => {
    let lastTs = 0;
    const id = setInterval(() => {
      try {
        const raw = localStorage.getItem("loupe_bridge_styles");
        if (!raw) return;
        const d = JSON.parse(raw);
        if (!d?.timestamp || d.timestamp === lastTs) return;
        lastTs = d.timestamp;
        setLiveStyles(d.styles ?? []);
        setLiveStylesUrl(d.url ?? "");
        if (d.url) setLiveUrlRaw(d.url);
      } catch {}
    }, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function addMessage(msg: Omit<Message, "id">) {
    setMessages(prev => [...prev, { ...msg, id: crypto.randomUUID() }]);
  }

  async function run() {
    if (!figmaUrl.trim() || !liveUrl.trim() || !pat.trim()) {
      setConfigOpen(true);
      return;
    }
    if (checks.size === 0) {
      addMessage({ type: "error", text: "Select at least one check to run." });
      return;
    }

    setRunning(true);
    setConfigOpen(false);
    const checkLabels = CHECK_OPTIONS.filter(c => checks.has(c.id)).map(c => c.label).join(", ");
    addMessage({ type: "user", text: `Check ${checkLabels} — Figma vs ${liveUrl.trim()}` });

    try {
      const fileKeyMatch = figmaUrl.match(/figma\.com\/(?:file|design)\/([A-Za-z0-9]+)/);
      const nodeIdMatch  = figmaUrl.match(/node-id=([^&]+)/);
      if (!fileKeyMatch) { addMessage({ type: "error", text: "Invalid Figma URL — could not extract file key." }); setRunning(false); return; }
      if (!nodeIdMatch)  { addMessage({ type: "error", text: "Figma URL must include node-id (right-click frame → Copy link to selection)." }); setRunning(false); return; }

      const fileKey  = fileKeyMatch[1];
      const nodeId   = decodeURIComponent(nodeIdMatch[1]).replace("-", ":");
      const cacheKey = `loupe_nodes_v2_${fileKey}_${nodeId}`;
      const cached   = localStorage.getItem(cacheKey);

      let figmaNodes: any = null;
      let styleNameMap: Record<string, string> = {};

      if (cached) {
        const parsed = JSON.parse(cached);
        figmaNodes   = parsed.figmaNodes;
        styleNameMap = parsed.styleNameMap ?? {};
      }

      const res = await fetch("/api/agents/figma-compare", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          figmaNodes, styleNameMap, fileKey, nodeId,
          liveUrl:    liveUrl.trim(),
          liveStyles: liveStylesRef.current ?? null,
          pat:        pat.trim(),
          checks:     Array.from(checks),
        }),
      });

      if (!res.body) throw new Error("No response body");

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const lines = decoder.decode(value).split("\n").filter(l => l.startsWith("data: "));
        for (const line of lines) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === "step")   addMessage({ type: "step",   text: data.text });
            if (data.type === "error")  addMessage({ type: "error",  text: data.text });
            if (data.type === "cache") {
              try { localStorage.setItem(cacheKey, JSON.stringify({ figmaNodes: data.figmaNodes, styleNameMap: data.styleNameMap })); } catch {}
            }
            if (data.type === "result") addMessage({ type: "result", text: data.text, table: data.table });
          } catch {}
        }
      }
    } catch (err) {
      addMessage({ type: "error", text: `Connection error: ${String(err)}` });
    } finally {
      setRunning(false);
    }
  }

  const canRun = !running && !!figmaUrl.trim() && !!liveUrl.trim() && !!pat.trim() && checks.size > 0;

  const ChecklistPanel = () => (
    <div>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#9a9aa5]">What to check</p>
      <div className="flex flex-wrap gap-2">
        {CHECK_OPTIONS.map(opt => {
          const active = checks.has(opt.id);
          return (
            <button key={opt.id} onClick={() => toggleCheck(opt.id)}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-all ${
                active
                  ? "border-[#0f0f0f] bg-[#0f0f0f] text-white"
                  : "border-[#e8e8ec] text-[#9a9aa5] hover:border-[#9a9aa5] hover:text-[#17171c]"
              }`}>
              {active && <Check size={10} />}
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="flex h-screen flex-col bg-white">
      {/* ── Top bar ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b border-[#f0f0f0] px-6 py-3 shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-[#9a9aa5]" />
          <span className="text-[13px] font-medium text-[#17171c]">Figma vs Live</span>
          <span className="rounded-full bg-[#f0f0f0] px-2 py-0.5 text-[10px] font-medium text-[#9a9aa5]">Design QA</span>
        </div>
        <div className="flex items-center gap-2">
          {liveStyles && (
            <span className="flex items-center gap-1.5 rounded-full bg-[#e8f6ee] px-2.5 py-1 text-[11px] font-medium text-[#1a9457]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#1a9457]" />
              {liveStyles.length} styles · {liveStylesUrl ? new URL(liveStylesUrl).hostname : "extension"}
            </span>
          )}
          {messages.length > 0 && (
            <button onClick={() => setMessages([])} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] text-[#9a9aa5] hover:bg-[#f7f7f8] hover:text-[#17171c] transition-colors">
              <Trash2 size={12} />
              Clear
            </button>
          )}
        </div>
      </div>

      {/* ── Chat area ────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-5 px-6 py-12">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0f0f0f]">
              <Sparkles size={20} className="text-white" />
            </div>
            <div className="text-center">
              <p className="text-[16px] font-semibold text-[#17171c]">Figma vs Live comparison</p>
              <p className="mt-1 text-[13px] text-[#9a9aa5]">Compare your Figma design against the live site<br />and find design inconsistencies instantly.</p>
            </div>
            <div className="w-full max-w-lg space-y-3">
              <ConfigCard icon={FileCode2} label="Figma Frame" value={figmaUrl} placeholder="Paste Figma frame URL" onChange={setFigmaUrl} hint="Right-click frame → Copy link to selection" />
              <ConfigCard icon={Globe} label="Live Site" value={liveUrl} placeholder="Paste live site URL" onChange={setLiveUrl}
                badge={liveStyles ? `✓ ${liveStyles.length} styles captured` : undefined} />
              <ConfigCard icon={KeyRound} label="Figma Token" value={pat} placeholder="figd_..." onChange={setPat} secret />
              <div className="rounded-xl border border-[#f0f0f0] bg-white px-4 py-3">
                <ChecklistPanel />
              </div>
              <button onClick={run} disabled={!canRun}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#0f0f0f] px-5 py-2.5 text-[13px] font-medium text-white shadow-sm hover:bg-[#1a1a1a] disabled:opacity-40 transition-all">
                {running ? <><Loader2 size={13} className="animate-spin" />Running…</> : <><Play size={13} />Run comparison</>}
              </button>
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-2xl px-6 py-6 space-y-4">
            {messages.map(msg => <MessageBubble key={msg.id} msg={msg} />)}
            {running && (
              <div className="flex items-center gap-2 text-[12px] text-[#9a9aa5]">
                <Loader2 size={12} className="animate-spin" />Analyzing…
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* ── Bottom bar (after first run) ─────────────────────────── */}
      {messages.length > 0 && (
        <div className="shrink-0 border-t border-[#f0f0f0] bg-white px-6 py-4">
          {configOpen && (
            <div className="mb-3 rounded-xl border border-[#f0f0f0] bg-[#fafafa] p-4 space-y-3">
              <ConfigCard icon={FileCode2} label="Figma Frame" value={figmaUrl} placeholder="Paste Figma frame URL" onChange={setFigmaUrl} hint="Right-click frame → Copy link to selection" />
              <ConfigCard icon={Globe} label="Live Site" value={liveUrl} placeholder="Paste live site URL" onChange={setLiveUrl}
                badge={liveStyles ? `✓ ${liveStyles.length} styles captured` : undefined} />
              <ConfigCard icon={KeyRound} label="Figma Token" value={pat} placeholder="figd_..." onChange={setPat} secret />
              <ChecklistPanel />
            </div>
          )}
          <div className="flex items-center gap-2">
            <button onClick={() => setConfigOpen(o => !o)}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[12px] font-medium transition-colors ${configOpen ? "border-[#0f0f0f] bg-[#0f0f0f] text-white" : "border-[#e8e8ec] text-[#9a9aa5] hover:border-[#0f0f0f] hover:text-[#0f0f0f]"}`}>
              Configure
            </button>
            <div className="flex flex-wrap gap-1.5 mx-2">
              {CHECK_OPTIONS.filter(c => checks.has(c.id)).map(c => (
                <span key={c.id} className="rounded-full bg-[#f0f0f0] px-2 py-0.5 text-[10px] font-medium text-[#5b5b66]">{c.label}</span>
              ))}
            </div>
            <button onClick={run} disabled={!canRun}
              className="ml-auto flex items-center gap-2 rounded-lg bg-[#0f0f0f] px-4 py-2 text-[12px] font-medium text-white hover:bg-[#1a1a1a] disabled:opacity-40 transition-all">
              {running ? <><Loader2 size={12} className="animate-spin" />Running…</> : <><ArrowUp size={12} />Run again</>}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ConfigCard({ icon: Icon, label, value, placeholder, onChange, hint, badge, secret }: {
  icon: any; label: string; value: string; placeholder: string;
  onChange: (v: string) => void; hint?: string; badge?: string; secret?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-[#f0f0f0] bg-white px-4 py-3">
      <Icon size={14} className="mt-0.5 shrink-0 text-[#9a9aa5]" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[11px] font-semibold text-[#9a9aa5] uppercase tracking-wide">{label}</span>
          {badge && <span className="rounded-full bg-[#e8f6ee] px-2 py-0.5 text-[10px] font-medium text-[#1a9457]">{badge}</span>}
        </div>
        <input type={secret ? "password" : "text"} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
          className="w-full bg-transparent text-[13px] text-[#17171c] placeholder:text-[#c8c8d0] outline-none" />
        {hint && <p className="mt-1 text-[10px] text-[#c8c8d0]">{hint}</p>}
      </div>
    </div>
  );
}

function MessageBubble({ msg }: { msg: Message }) {
  if (msg.type === "user") return (
    <div className="flex justify-end">
      <div className="max-w-[75%] rounded-2xl rounded-tr-sm bg-[#0f0f0f] px-4 py-2.5">
        <p className="text-[13px] text-white leading-relaxed">{msg.text}</p>
      </div>
    </div>
  );

  if (msg.type === "step") return (
    <div className="flex items-center gap-2 text-[12px] text-[#b0b0b8]">
      <ChevronRight size={11} className="shrink-0" />{msg.text}
    </div>
  );

  if (msg.type === "error") return (
    <div className="flex items-start gap-3 rounded-2xl border border-red-100 bg-red-50 px-4 py-3">
      <AlertCircle size={14} className="text-red-500 mt-0.5 shrink-0" />
      <p className="text-[13px] text-red-600 leading-relaxed">{msg.text}</p>
    </div>
  );

  if (msg.type === "result") return (
    <div className="space-y-3">
      <div className="flex items-start gap-3 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3">
        <CheckCircle2 size={14} className="text-emerald-600 mt-0.5 shrink-0" />
        <p className="text-[13px] text-emerald-700 leading-relaxed">{msg.text}</p>
      </div>
      {msg.table && msg.table.length > 0 && (
        <div className="rounded-2xl border border-[#f0f0f0] overflow-hidden">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-[#f0f0f0] bg-[#fafafa]">
                <th className="px-4 py-2.5 text-left font-medium text-[#9a9aa5] w-6">#</th>
                <th className="px-4 py-2.5 text-left font-medium text-[#9a9aa5]">Element</th>
                <th className="px-4 py-2.5 text-left font-medium text-[#9a9aa5]">Issue</th>
                <th className="px-4 py-2.5 text-left font-medium text-[#9a9aa5]">Comment</th>
              </tr>
            </thead>
            <tbody>
              {msg.table.map((row, i) => (
                <tr key={i} className="border-b border-[#f7f7f8] last:border-0 hover:bg-[#fafafa]">
                  <td className="px-4 py-2.5 text-[#c8c8d0]">{i + 1}</td>
                  <td className="px-4 py-2.5 font-medium text-[#17171c]">{row.element}</td>
                  <td className="px-4 py-2.5 text-[#5b5b66]">{row.issue}</td>
                  <td className="px-4 py-2.5 font-mono text-[10px] text-[#9a9aa5]">{row.commentId ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  return null;
}
