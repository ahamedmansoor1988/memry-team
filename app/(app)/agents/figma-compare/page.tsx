"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { ScanSearch, Play, Loader2, ChevronRight, Eye, EyeOff, AlertCircle, CheckCircle2, Info, Trash2 } from "lucide-react";

interface Message {
  id: string;
  type: "user" | "step" | "result" | "error" | "info";
  text: string;
  table?: DiscrepancyRow[];
}

interface DiscrepancyRow {
  element: string;
  issue: string;
  commentId?: string;
}

export default function FigmaComparePage() {
  const [figmaUrl,  setFigmaUrlRaw]  = useState("");
  const [liveUrl,   setLiveUrlRaw]   = useState("");
  const [pat,       setPatRaw]       = useState("");
  const [showPat,   setShowPat]      = useState(false);
  const [running,   setRunning]      = useState(false);
  const [retryIn,   setRetryIn]      = useState(0);
  const [liveStyles,    setLiveStyles]    = useState<any[] | null>(null);
  const [liveStylesUrl, setLiveStylesUrl] = useState<string>("");
  const [messages,  setMessages]     = useState<Message[]>([{
    id: "welcome", type: "info",
    text: "Paste a Figma frame URL and a live site URL on the right, then hit **Run** to start the comparison. I'll check every text node for font and color discrepancies and annotate each one directly in Figma.",
  }]);

  const bottomRef = useRef<HTMLDivElement>(null);
  const liveStylesRef = useRef<any[] | null>(null);
  liveStylesRef.current = liveStyles;

  const setFigmaUrl = useCallback((v: string) => { setFigmaUrlRaw(v); localStorage.setItem("loupe_figma_url", v); }, []);
  const setLiveUrl  = useCallback((v: string) => { setLiveUrlRaw(v);  localStorage.setItem("loupe_live_url",  v); }, []);
  const setPat      = useCallback((v: string) => { setPatRaw(v);      localStorage.setItem("loupe_pat",       v); }, []);

  useEffect(() => {
    setFigmaUrlRaw(localStorage.getItem("loupe_figma_url") ?? "");
    setLiveUrlRaw(localStorage.getItem("loupe_live_url")   ?? "");
    setPatRaw(localStorage.getItem("loupe_pat")            ?? "");
  }, []);

  // Poll extension bridge
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
    if (!figmaUrl.trim() || !liveUrl.trim() || !pat.trim()) return;

    setRunning(true);
    addMessage({ type: "user", text: `Compare Figma frame against ${liveUrl.trim()}` });

    try {
      const fileKeyMatch = figmaUrl.match(/figma\.com\/(?:file|design)\/([A-Za-z0-9]+)/);
      const nodeIdMatch  = figmaUrl.match(/node-id=([^&]+)/);
      if (!fileKeyMatch) { addMessage({ type: "error", text: "Invalid Figma URL — could not extract file key." }); return; }
      if (!nodeIdMatch)  { addMessage({ type: "error", text: "Figma URL must include node-id (right-click a frame → Copy link to selection)." }); return; }

      const fileKey = fileKeyMatch[1];
      const nodeId  = decodeURIComponent(nodeIdMatch[1]).replace("-", ":");
      const cacheKey = `loupe_nodes_v2_${fileKey}_${nodeId}`;
      const cached   = localStorage.getItem(cacheKey);

      let figmaNodes: any = null;
      let styleNameMap: Record<string, string> = {};

      if (cached) {
        const parsed = JSON.parse(cached);
        figmaNodes   = parsed.figmaNodes;
        styleNameMap = parsed.styleNameMap ?? {};
        addMessage({ type: "step", text: "Figma nodes loaded from cache." });
      } else {
        addMessage({ type: "step", text: "Fetching Figma data via server…" });
      }

      addMessage({ type: "step", text: "Running AI comparison…" });

      const res = await fetch("/api/agents/figma-compare", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          figmaNodes, styleNameMap, fileKey, nodeId,
          liveUrl:    liveUrl.trim(),
          liveStyles: liveStylesRef.current ?? null,
          pat:        pat.trim(),
        }),
      });

      if (!res.body) throw new Error("No response body");

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        const lines = chunk.split("\n").filter(l => l.startsWith("data: "));
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

  function clearChat() {
    setMessages([{ id: "welcome", type: "info", text: "Paste a Figma frame URL and a live site URL on the right, then hit **Run** to start the comparison. I'll check every text node for font and color discrepancies and annotate each one directly in Figma." }]);
  }

  const canRun = !running && retryIn === 0 && !!figmaUrl.trim() && !!liveUrl.trim() && !!pat.trim();

  return (
    <div className="flex h-screen">
      {/* ── Left: Chat ───────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col border-r border-[#e8e8ec]">
        <div className="flex items-center gap-2.5 border-b border-[#e8e8ec] px-5 py-3.5">
          <ScanSearch size={15} className="text-[#9a9aa5]" />
          <span className="text-[13px] font-medium text-[#17171c]">Figma vs Live</span>
          <span className="ml-auto text-[11px] text-[#9a9aa5]">Design QA agent</span>
          <button onClick={clearChat} title="Clear chat" className="ml-3 flex h-6 w-6 items-center justify-center rounded text-[#9a9aa5] hover:text-[#17171c] hover:bg-[#f1f1f4] transition-colors">
            <Trash2 size={12} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {messages.map(msg => <MessageBubble key={msg.id} msg={msg} />)}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* ── Right: Config ────────────────────────────────────────── */}
      <div className="flex w-[380px] shrink-0 flex-col bg-[#fafafa]">
        <div className="border-b border-[#e8e8ec] px-5 py-3.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#9a9aa5]">Configuration</p>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <Field label="Figma Frame URL" required hint="Must include node-id (e.g. ?node-id=123-456)">
            <input value={figmaUrl} onChange={e => setFigmaUrl(e.target.value)} placeholder="https://figma.com/design/..." className="node-input" />
          </Field>
          <Field label="Live Site URL" required>
            <input value={liveUrl} onChange={e => setLiveUrl(e.target.value)} placeholder="https://yoursite.com/page" className="node-input" />
          </Field>
          <Field label="Figma Personal Access Token" required hint="Needs file_comments:write scope. Stored only in your browser.">
            <div className="relative">
              <input type={showPat ? "text" : "password"} value={pat} onChange={e => setPat(e.target.value)} placeholder="figd_..." className="node-input font-mono pr-9" />
              <button type="button" onClick={() => setShowPat(p => !p)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#9a9aa5] hover:text-[#17171c]">
                {showPat ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
          </Field>

          {/* Extension badge */}
          <div className={`rounded-lg border p-3 flex gap-2.5 ${liveStyles ? "border-[#1a9457]/30 bg-[#e8f6ee]" : "border-[#e8e8ec] bg-white"}`}>
            <Info size={13} className={`mt-0.5 shrink-0 ${liveStyles ? "text-[#1a9457]" : "text-[#9a9aa5]"}`} />
            <div>
              <p className={`text-[12px] leading-[18px] ${liveStyles ? "text-[#1a9457] font-medium" : "text-[#5b5b66]"}`}>
                {liveStyles
                  ? `✓ ${liveStyles.length} computed styles ready from ${liveStylesUrl || "live site"}`
                  : "Open your live site — the Loupe extension will auto-extract styles."}
              </p>
              {liveStyles && (
                <button onClick={() => { setLiveStyles(null); setLiveStylesUrl(""); }} className="text-[11px] text-[#9a9aa5] underline mt-0.5">Clear</button>
              )}
            </div>
          </div>
        </div>

        {/* Run button */}
        <div className="border-t border-[#e8e8ec] p-4">
          <button onClick={run} disabled={!canRun}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#18181b] px-4 py-2.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40">
            {running ? <><Loader2 size={13} className="animate-spin" />Running…</>
              : retryIn > 0 ? <>Rate limited — retry in {retryIn}s</>
              : <><Play size={13} />Run comparison</>}
          </button>
        </div>
      </div>

      <style>{`.node-input { width: 100%; border: 1px solid #e8e8ec; border-radius: 8px; background: white; padding: 6px 10px; font-size: 13px; color: #17171c; outline: none; transition: border-color 0.15s; } .node-input:focus { border-color: #18181b; } .node-input::placeholder { color: #9a9aa5; }`}</style>
    </div>
  );
}

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1 text-[12px] font-medium text-[#17171c]">
        {label}{required && <span className="text-[#d4373e]">*</span>}
      </label>
      {children}
      {hint && <p className="text-[11px] text-[#9a9aa5] leading-[15px]">{hint}</p>}
    </div>
  );
}

function MessageBubble({ msg }: { msg: Message }) {
  if (msg.type === "user") return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-[#18181b] px-4 py-2.5">
        <p className="text-[13px] text-white leading-[20px]">{msg.text}</p>
      </div>
    </div>
  );

  if (msg.type === "step") return (
    <div className="flex items-center gap-2.5 text-[12px] text-[#5b5b66]">
      <ChevronRight size={12} className="text-[#9a9aa5] shrink-0" />
      {msg.text}
    </div>
  );

  if (msg.type === "error") return (
    <div className="flex items-start gap-2.5 rounded-xl border border-[#fdecec] bg-[#fdecec] px-4 py-3">
      <AlertCircle size={13} className="text-[#d4373e] mt-0.5 shrink-0" />
      <p className="text-[13px] text-[#d4373e] leading-[20px]">{msg.text}</p>
    </div>
  );

  if (msg.type === "result") return (
    <div className="space-y-3">
      <div className="flex items-start gap-2.5 rounded-xl border border-[#e8f6ee] bg-[#e8f6ee] px-4 py-3">
        <CheckCircle2 size={13} className="text-[#1a9457] mt-0.5 shrink-0" />
        <p className="text-[13px] text-[#1a9457] leading-[20px]">{msg.text}</p>
      </div>
      {msg.table && msg.table.length > 0 && (
        <div className="rounded-xl border border-[#e8e8ec] overflow-hidden">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-[#e8e8ec] bg-[#f7f7f8]">
                <th className="px-3 py-2 text-left font-medium text-[#9a9aa5]">#</th>
                <th className="px-3 py-2 text-left font-medium text-[#9a9aa5]">Element</th>
                <th className="px-3 py-2 text-left font-medium text-[#9a9aa5]">Issue</th>
                <th className="px-3 py-2 text-left font-medium text-[#9a9aa5]">Comment</th>
              </tr>
            </thead>
            <tbody>
              {msg.table.map((row, i) => (
                <tr key={i} className="border-b border-[#f1f1f4] last:border-0">
                  <td className="px-3 py-2 text-[#9a9aa5]">{i + 1}</td>
                  <td className="px-3 py-2 text-[#17171c] font-medium">{row.element}</td>
                  <td className="px-3 py-2 text-[#5b5b66]">{row.issue}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-[#9a9aa5]">{row.commentId ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex items-start gap-2.5">
      <div className="mt-0.5 h-5 w-5 shrink-0 rounded-full bg-[#f1f1f4] flex items-center justify-center">
        <span className="text-[10px] font-bold text-[#17171c]">L</span>
      </div>
      <div className="flex-1 rounded-2xl rounded-tl-sm border border-[#e8e8ec] bg-white px-4 py-3">
        <p className="text-[13px] text-[#5b5b66] leading-[20px]">{renderMd(msg.text)}</p>
      </div>
    </div>
  );
}

function renderMd(text: string): React.ReactNode {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return parts.map((p, i) => i % 2 === 1 ? <strong key={i} className="font-semibold text-[#17171c]">{p}</strong> : p);
}
