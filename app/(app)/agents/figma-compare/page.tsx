"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Play, Loader2, ChevronRight, AlertCircle, CheckCircle2,
  Trash2, ArrowUp, FileCode2, Globe, KeyRound, Sparkles,
  Check, Send, Bot,
} from "lucide-react";

/* ── Types ───────────────────────────────────────────────────────── */
interface RunMessage {
  id: string;
  type: "user" | "step" | "result" | "error";
  text: string;
  table?: DiscrepancyRow[];
}
interface DiscrepancyRow { element: string; issue: string; commentId?: string; }
interface ChatMessage { id: string; role: "user" | "assistant"; text: string; }

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

/* ── Page ────────────────────────────────────────────────────────── */
export default function FigmaComparePage() {
  // Config
  const [figmaUrl, setFigmaUrlRaw] = useState("");
  const [liveUrl,  setLiveUrlRaw]  = useState("");
  const [pat,      setPatRaw]      = useState("");
  const [checks, setChecks] = useState<Set<string>>(
    new Set(["font_family", "font_size", "font_weight", "color"])
  );
  const [configOpen, setConfigOpen] = useState(false);

  // Execution
  const [running,   setRunning]   = useState(false);
  const [runMsgs,   setRunMsgs]   = useState<RunMessage[]>([]);

  // Extension bridge
  const [liveStyles,     setLiveStyles]     = useState<any[] | null>(null);
  const [scrapeStatus,   setScrapeStatus]   = useState<"idle"|"fetching"|"ready">("idle");
  const liveStylesRef = useRef<any[] | null>(null);
  liveStylesRef.current = liveStyles;

  // Collaborators
  const [collaborators, setCollaborators] = useState<Array<{ id: string; handle: string; img_url: string }>>([]);
  const [assignTo,      setAssignTo]      = useState<string>("");

  // Chat
  const [chatMsgs,  setChatMsgs]  = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy,  setChatBusy]  = useState(false);

  const runBottomRef  = useRef<HTMLDivElement>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const setFigmaUrl = useCallback((v: string) => { setFigmaUrlRaw(v); localStorage.setItem("loupe_figma_url", v); }, []);
  const setPat      = useCallback((v: string) => { setPatRaw(v);      localStorage.setItem("loupe_pat",       v); }, []);

  function toggleCheck(id: string) {
    setChecks(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  useEffect(() => {
    setFigmaUrlRaw(localStorage.getItem("loupe_figma_url") ?? "");
    setLiveUrlRaw(localStorage.getItem("loupe_live_url")   ?? "");
    setPatRaw(localStorage.getItem("loupe_pat")            ?? "");
  }, []);

  // Fetch collaborators when Figma URL + PAT are ready
  useEffect(() => {
    const fileKeyMatch = figmaUrl.match(/figma\.com\/(?:file|design)\/([A-Za-z0-9]+)/);
    if (!fileKeyMatch || !pat.trim()) { setCollaborators([]); return; }
    const fileKey = fileKeyMatch[1];
    let cancelled = false;
    fetch("/api/figma-collaborators", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileKey, pat: pat.trim() }),
    })
      .then(r => r.json())
      .then(d => { if (!cancelled) setCollaborators(d.users ?? []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [figmaUrl, pat]);

  // When user sets a live URL, ask the extension to scrape it
  const setLiveUrl = useCallback((v: string) => {
    setLiveUrlRaw(v);
    localStorage.setItem("loupe_live_url", v);
    if (v.trim().startsWith("http")) {
      setScrapeStatus("fetching");
      localStorage.setItem("loupe_scrape_request", JSON.stringify({ url: v.trim(), timestamp: Date.now() }));
    } else {
      setScrapeStatus("idle");
    }
  }, []);

  // Poll for styles written back by the extension bridge
  useEffect(() => {
    const id = setInterval(() => {
      try {
        // Sync styles
        const raw = localStorage.getItem("loupe_bridge_styles");
        if (raw) {
          const d = JSON.parse(raw);
          if (d?.styles?.length) setLiveStyles(d.styles);
        }
        // Sync status
        const statusRaw = localStorage.getItem("loupe_scrape_status");
        if (statusRaw) {
          const s = JSON.parse(statusRaw);
          if (s?.status === "ready") setScrapeStatus("ready");
          else if (s?.status === "fetching") setScrapeStatus("fetching");
        }
      } catch {}
    }, 800);
    return () => clearInterval(id);
  }, []);

  useEffect(() => { runBottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [runMsgs]);
  useEffect(() => { chatBottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMsgs]);

  function addRun(msg: Omit<RunMessage, "id">) {
    setRunMsgs(prev => [...prev, { ...msg, id: crypto.randomUUID() }]);
  }

  async function run(forceRefresh = false) {
    if (!figmaUrl.trim() || !liveUrl.trim() || !pat.trim()) { setConfigOpen(true); return; }
    if (checks.size === 0) { addRun({ type: "error", text: "Select at least one check." }); return; }

    setRunning(true);
    setConfigOpen(false);
    const checkLabels = CHECK_OPTIONS.filter(c => checks.has(c.id)).map(c => c.label).join(", ");
    addRun({ type: "user", text: `Check ${checkLabels} — Figma vs ${liveUrl.trim()}` });

    try {
      const fileKeyMatch = figmaUrl.match(/figma\.com\/(?:file|design)\/([A-Za-z0-9]+)/);
      const nodeIdMatch  = figmaUrl.match(/node-id=([^&]+)/);
      if (!fileKeyMatch) { addRun({ type: "error", text: "Invalid Figma URL." }); setRunning(false); return; }
      if (!nodeIdMatch)  { addRun({ type: "error", text: "Figma URL must include node-id." }); setRunning(false); return; }

      const fileKey  = fileKeyMatch[1];
      const nodeId   = decodeURIComponent(nodeIdMatch[1]).replace("-", ":");
      const cacheKey = `loupe_nodes_v2_${fileKey}_${nodeId}`;
      const cached   = localStorage.getItem(cacheKey);
      let figmaNodes: any = null;
      let styleNameMap: Record<string, string> = {};
      if (cached && !forceRefresh) { const p = JSON.parse(cached); figmaNodes = p.figmaNodes; styleNameMap = p.styleNameMap ?? {}; }

      const res = await fetch("/api/agents/figma-compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          figmaNodes: forceRefresh ? null : figmaNodes,
          styleNameMap: forceRefresh ? {} : styleNameMap,
          fileKey, nodeId,
          liveUrl:    liveUrl.trim(),
          liveStyles: (liveStylesRef.current ?? []).map((s: any) => ({
            text: s.text, fontFamily: s.fontFamily,
            fontSize: s.fontSize, fontWeight: s.fontWeight, color: s.color,
          })),
          pat: pat.trim(),
          checks: Array.from(checks),
          assignTo: assignTo || null,
          forceRefresh,
        }),
      });

      if (!res.body) throw new Error("No response body");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const line of decoder.decode(value).split("\n").filter(l => l.startsWith("data: "))) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === "step")   addRun({ type: "step",   text: data.text });
            if (data.type === "error")  addRun({ type: "error",  text: data.text });
            if (data.type === "result") addRun({ type: "result", text: data.text, table: data.table });
            if (data.type === "cache") {
              try { localStorage.setItem(cacheKey, JSON.stringify({ figmaNodes: data.figmaNodes, styleNameMap: data.styleNameMap })); } catch {}
            }
          } catch {}
        }
      }
    } catch (err) {
      addRun({ type: "error", text: `Connection error: ${String(err)}` });
    } finally {
      setRunning(false);
    }
  }

  async function sendChat() {
    const text = chatInput.trim();
    if (!text || chatBusy) return;
    setChatInput("");
    setChatBusy(true);
    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: "user", text };
    setChatMsgs(prev => [...prev, userMsg]);

    try {
      const res = await fetch("/api/agents/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history: chatMsgs.slice(-10) }),
      });
      const data = await res.json();
      setChatMsgs(prev => [...prev, { id: crypto.randomUUID(), role: "assistant", text: data.reply ?? "Sorry, I couldn't respond." }]);
    } catch {
      setChatMsgs(prev => [...prev, { id: crypto.randomUUID(), role: "assistant", text: "Connection error — try again." }]);
    } finally {
      setChatBusy(false);
    }
  }

  const canRun = !running && !!figmaUrl.trim() && !!liveUrl.trim() && !!pat.trim() && checks.size > 0;

  return (
    <div className="flex h-screen overflow-hidden">

      {/* ── CENTER: Execution ──────────────────────────────────────── */}
      <div className="flex flex-1 flex-col border-r border-[#f0f0f0] min-w-0">
        {/* Top bar */}
        <div className="flex items-center justify-between border-b border-[#f0f0f0] px-5 py-3 shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles size={13} className="text-[#9a9aa5]" />
            <span className="text-[13px] font-medium text-[#17171c]">Figma vs Live</span>
            <span className="rounded-full bg-[#f0f0f0] px-2 py-0.5 text-[10px] font-medium text-[#9a9aa5]">Design QA</span>
          </div>
          <div className="flex items-center gap-2">
            {scrapeStatus === "fetching" && (
              <span className="flex items-center gap-1.5 rounded-full bg-[#fff8e6] px-2.5 py-1 text-[11px] font-medium text-[#b07d00]">
                <Loader2 size={10} className="animate-spin" />Fetching styles…
              </span>
            )}
            {scrapeStatus === "ready" && liveStyles && (
              <span className="flex items-center gap-1.5 rounded-full bg-[#e8f6ee] px-2.5 py-1 text-[11px] font-medium text-[#1a9457]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#1a9457]" />
                {liveStyles.length} styles ready
              </span>
            )}
            {runMsgs.length > 0 && (
              <button onClick={() => setRunMsgs([])} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] text-[#9a9aa5] hover:bg-[#f7f7f8] hover:text-[#17171c] transition-colors">
                <Trash2 size={12} />Clear
              </button>
            )}
          </div>
        </div>

        {/* Execution area */}
        <div className="flex-1 overflow-y-auto">
          {runMsgs.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-5 px-6 py-12">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#0f0f0f]">
                <Sparkles size={18} className="text-white" />
              </div>
              <div className="text-center">
                <p className="text-[15px] font-semibold text-[#17171c]">Figma vs Live</p>
                <p className="mt-1 text-[12px] text-[#9a9aa5]">Configure below and run to find design discrepancies.</p>
              </div>
              <div className="w-full max-w-md space-y-2">
                <ConfigCard icon={FileCode2} label="Figma Frame" value={figmaUrl} placeholder="Paste Figma frame URL" onChange={setFigmaUrl} hint="Right-click frame → Copy link to selection" />
                <ConfigCard icon={Globe} label="Live Site" value={liveUrl} placeholder="Paste live site URL" onChange={setLiveUrl} />
                <ConfigCard icon={KeyRound} label="Figma Token" value={pat} placeholder="figd_..." onChange={setPat} secret />
                {collaborators.length > 0 && (
                  <div className="rounded-xl border border-[#f0f0f0] bg-white px-4 py-3 flex items-center gap-3">
                    <span className="text-[12px] font-medium text-[#5b5b66] shrink-0">Assign QA to</span>
                    <select value={assignTo} onChange={e => setAssignTo(e.target.value)}
                      className="flex-1 rounded-lg border border-[#e8e8ec] bg-white px-2 py-1.5 text-[12px] text-[#17171c] focus:outline-none focus:border-[#0f0f0f]">
                      <option value="">No assignment</option>
                      {collaborators.map(u => (
                        <option key={u.id} value={u.handle}>@{u.handle}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="rounded-xl border border-[#f0f0f0] bg-white px-4 py-3">
                  <ChecklistPanel checks={checks} onToggle={toggleCheck} />
                </div>
                <button onClick={() => run(false)} disabled={!canRun}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#0f0f0f] px-5 py-2.5 text-[13px] font-medium text-white disabled:opacity-40 hover:bg-[#1a1a1a] transition-all">
                  {running ? <><Loader2 size={13} className="animate-spin" />Running…</> : <><Play size={13} />Run comparison</>}
                </button>
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-2xl px-5 py-5 space-y-3">
              {runMsgs.map(msg => <RunBubble key={msg.id} msg={msg} />)}
              {running && <div className="flex items-center gap-2 text-[12px] text-[#9a9aa5]"><Loader2 size={12} className="animate-spin" />Analyzing…</div>}
              <div ref={runBottomRef} />
            </div>
          )}
        </div>

        {/* Bottom bar */}
        {runMsgs.length > 0 && (
          <div className="shrink-0 border-t border-[#f0f0f0] bg-white px-5 py-3">
            {configOpen && (
              <div className="mb-3 rounded-xl border border-[#f0f0f0] bg-[#fafafa] p-3 space-y-2">
                <ConfigCard icon={FileCode2} label="Figma Frame" value={figmaUrl} placeholder="Paste Figma frame URL" onChange={setFigmaUrl} hint="Right-click frame → Copy link to selection" />
                <ConfigCard icon={Globe} label="Live Site" value={liveUrl} placeholder="Paste live site URL" onChange={setLiveUrl} />
                <ConfigCard icon={KeyRound} label="Figma Token" value={pat} placeholder="figd_..." onChange={setPat} secret />
                {collaborators.length > 0 && (
                  <div className="flex items-center gap-3 px-1">
                    <span className="text-[12px] font-medium text-[#5b5b66] shrink-0">Assign QA to</span>
                    <select value={assignTo} onChange={e => setAssignTo(e.target.value)}
                      className="flex-1 rounded-lg border border-[#e8e8ec] bg-white px-2 py-1.5 text-[12px] text-[#17171c] focus:outline-none focus:border-[#0f0f0f]">
                      <option value="">No assignment</option>
                      {collaborators.map(u => (
                        <option key={u.id} value={u.handle}>@{u.handle}</option>
                      ))}
                    </select>
                  </div>
                )}
                <ChecklistPanel checks={checks} onToggle={toggleCheck} />
              </div>
            )}
            <div className="flex items-center gap-2">
              <button onClick={() => setConfigOpen(o => !o)}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors ${configOpen ? "border-[#0f0f0f] bg-[#0f0f0f] text-white" : "border-[#e8e8ec] text-[#9a9aa5] hover:border-[#0f0f0f] hover:text-[#0f0f0f]"}`}>
                Configure
              </button>
              <div className="flex flex-wrap gap-1 mx-1">
                {CHECK_OPTIONS.filter(c => checks.has(c.id)).map(c => (
                  <span key={c.id} className="rounded-full bg-[#f0f0f0] px-2 py-0.5 text-[10px] text-[#5b5b66]">{c.label}</span>
                ))}
              </div>
              <div className="ml-auto flex items-center gap-2">
                <button onClick={() => run(true)} disabled={!canRun}
                  className="flex items-center gap-1.5 rounded-lg border border-[#e8e8ec] px-3 py-1.5 text-[12px] text-[#9a9aa5] hover:border-[#0f0f0f] hover:text-[#0f0f0f] disabled:opacity-40 transition-all">
                  <ArrowUp size={11} />Force refresh
                </button>
                <button onClick={() => run(false)} disabled={!canRun}
                  className="flex items-center gap-2 rounded-lg bg-[#0f0f0f] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-[#1a1a1a] disabled:opacity-40 transition-all">
                  {running ? <><Loader2 size={11} className="animate-spin" />Running…</> : <><Play size={11} />Run again</>}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── RIGHT: AI Chat ────────────────────────────────────────── */}
      <div className="flex w-[300px] shrink-0 flex-col bg-[#fafafa]">
        <div className="flex items-center gap-2 border-b border-[#f0f0f0] px-4 py-3 shrink-0">
          <Bot size={13} className="text-[#9a9aa5]" />
          <span className="text-[13px] font-medium text-[#17171c]">Ask AI</span>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
          {chatMsgs.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-2">
              <div className="h-9 w-9 rounded-xl bg-[#0f0f0f] flex items-center justify-center">
                <Bot size={15} className="text-white" />
              </div>
              <p className="text-[12px] text-[#9a9aa5]">Ask anything about design, Figma, or the results.</p>
              <div className="space-y-1.5 w-full">
                {["What is font weight?", "Why does font family matter?", "How to fix color mismatch?"].map(q => (
                  <button key={q} onClick={() => { setChatInput(q); }}
                    className="w-full rounded-lg border border-[#e8e8ec] bg-white px-3 py-2 text-left text-[11px] text-[#5b5b66] hover:border-[#0f0f0f] hover:text-[#0f0f0f] transition-colors">
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}
          {chatMsgs.map(msg => (
            <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-[12px] leading-relaxed ${
                msg.role === "user"
                  ? "bg-[#0f0f0f] text-white rounded-tr-sm"
                  : "bg-white border border-[#f0f0f0] text-[#17171c] rounded-tl-sm"
              }`}>
                {msg.text}
              </div>
            </div>
          ))}
          {chatBusy && (
            <div className="flex justify-start">
              <div className="bg-white border border-[#f0f0f0] rounded-2xl rounded-tl-sm px-3 py-2">
                <Loader2 size={12} className="animate-spin text-[#9a9aa5]" />
              </div>
            </div>
          )}
          <div ref={chatBottomRef} />
        </div>

        <div className="shrink-0 border-t border-[#f0f0f0] p-3">
          <div className="flex items-center gap-2 rounded-xl border border-[#e8e8ec] bg-white px-3 py-2 focus-within:border-[#0f0f0f] transition-colors">
            <input
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendChat()}
              placeholder="Ask a question…"
              className="flex-1 bg-transparent text-[12px] text-[#17171c] placeholder:text-[#c8c8d0] outline-none"
            />
            <button onClick={sendChat} disabled={!chatInput.trim() || chatBusy}
              className="h-6 w-6 flex items-center justify-center rounded-lg bg-[#0f0f0f] disabled:opacity-30 hover:bg-[#1a1a1a] transition-all">
              <Send size={10} className="text-white" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Sub-components ──────────────────────────────────────────────── */
function ChecklistPanel({ checks, onToggle }: { checks: Set<string>; onToggle: (id: string) => void }) {
  return (
    <div>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#9a9aa5]">What to check</p>
      <div className="flex flex-wrap gap-1.5">
        {CHECK_OPTIONS.map(opt => {
          const active = checks.has(opt.id);
          return (
            <button key={opt.id} onClick={() => onToggle(opt.id)}
              className={`flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-all ${active ? "border-[#0f0f0f] bg-[#0f0f0f] text-white" : "border-[#e8e8ec] text-[#9a9aa5] hover:border-[#9a9aa5]"}`}>
              {active && <Check size={9} />}{opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ConfigCard({ icon: Icon, label, value, placeholder, onChange, hint, badge, secret }: {
  icon: any; label: string; value: string; placeholder: string;
  onChange: (v: string) => void; hint?: string; badge?: string; secret?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-[#f0f0f0] bg-white px-4 py-3">
      <Icon size={13} className="mt-0.5 shrink-0 text-[#9a9aa5]" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] font-semibold text-[#9a9aa5] uppercase tracking-wide">{label}</span>
          {badge && <span className="rounded-full bg-[#e8f6ee] px-2 py-0.5 text-[10px] font-medium text-[#1a9457]">{badge}</span>}
        </div>
        <input type={secret ? "password" : "text"} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
          className="w-full bg-transparent text-[12px] text-[#17171c] placeholder:text-[#c8c8d0] outline-none" />
        {hint && <p className="mt-0.5 text-[10px] text-[#c8c8d0]">{hint}</p>}
      </div>
    </div>
  );
}

function RunBubble({ msg }: { msg: RunMessage }) {
  if (msg.type === "user") return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-[#0f0f0f] px-4 py-2.5">
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
      <AlertCircle size={13} className="text-red-500 mt-0.5 shrink-0" />
      <p className="text-[12px] text-red-600 leading-relaxed">{msg.text}</p>
    </div>
  );
  if (msg.type === "result") return (
    <div className="space-y-2">
      <div className="flex items-start gap-3 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3">
        <CheckCircle2 size={13} className="text-emerald-600 mt-0.5 shrink-0" />
        <p className="text-[12px] text-emerald-700 leading-relaxed">{msg.text}</p>
      </div>
      {msg.table && msg.table.length > 0 && (
        <div className="rounded-2xl border border-[#f0f0f0] overflow-hidden">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-[#f0f0f0] bg-[#fafafa]">
                <th className="px-3 py-2 text-left font-medium text-[#9a9aa5] w-5">#</th>
                <th className="px-3 py-2 text-left font-medium text-[#9a9aa5]">Element</th>
                <th className="px-3 py-2 text-left font-medium text-[#9a9aa5]">Issue</th>
                <th className="px-3 py-2 text-left font-medium text-[#9a9aa5]">Comment</th>
              </tr>
            </thead>
            <tbody>
              {msg.table.map((row, i) => (
                <tr key={i} className="border-b border-[#f7f7f8] last:border-0 hover:bg-[#fafafa]">
                  <td className="px-3 py-2 text-[#c8c8d0]">{i + 1}</td>
                  <td className="px-3 py-2 font-medium text-[#17171c]">{row.element}</td>
                  <td className="px-3 py-2 text-[#5b5b66]">{row.issue}</td>
                  <td className="px-3 py-2 font-mono text-[10px] text-[#9a9aa5]">{row.commentId ?? "—"}</td>
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
