"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Play, Loader2, ChevronRight, AlertCircle, CheckCircle2,
  Trash2, ArrowUp, FileCode2, Globe, KeyRound, Sparkles,
  Check, Send, Bot, RefreshCw, Upload, Database,
} from "lucide-react";

/* ── Types ───────────────────────────────────────────────────────── */
interface ApiCallEntry { method: string; path: string; status: number; ms: number; kb: number | null; retried: boolean; }
interface ApiReport    { totalCalls: number; calls: ApiCallEntry[]; }
interface RunMessage {
  id: string;
  type: "user" | "step" | "figma-log" | "result" | "error";
  text: string;
  table?: DiscrepancyRow[];
  figmaApiReport?: ApiReport;
}
interface DiscrepancyRow { element: string; issue: string; commentId?: string; }
interface ChatMessage { id: string; role: "user" | "assistant"; text: string; }
interface SnapshotMeta {
  id: string; frameName: string; textNodeCount: number;
  colorNodeCount: number; depthUsed: number; syncedAt: string;
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
  const [liveData,       setLiveData]       = useState<any | null>(null);
  const [scrapeStatus,   setScrapeStatus]   = useState<"idle"|"fetching"|"ready">("idle");
  const liveStylesRef = useRef<any[] | null>(null);
  const liveDataRef   = useRef<any | null>(null);
  liveStylesRef.current = liveStyles;
  liveDataRef.current   = liveData;

  // Collaborators — lazy loaded, never automatic
  const [collaborators,       setCollaborators]       = useState<Array<{ id: string; handle: string; img_url: string }>>([]);
  const [collaboratorsLoading, setCollaboratorsLoading] = useState(false);
  const [collaboratorsLoaded,  setCollaboratorsLoaded]  = useState(false);
  const [assignTo,             setAssignTo]             = useState<string>("");

  // Snapshot
  const [snapshot,   setSnapshot]   = useState<SnapshotMeta | null>(null);
  const [syncing,    setSyncing]    = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [lastSnapshotId, setLastSnapshotId] = useState<string | null>(null);

  // Chat
  const [chatMsgs,  setChatMsgs]  = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy,  setChatBusy]  = useState(false);

  const runBottomRef  = useRef<HTMLDivElement>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const scanGuardRef  = useRef(false);
  const setFigmaUrl = useCallback((v: string) => {
    setFigmaUrlRaw(v);
    localStorage.setItem("loupe_figma_url", v);
    setCollaboratorsLoaded(false);
    setCollaborators([]);
    setAssignTo("");
    setSnapshot(null); // reset snapshot status when URL changes
  }, []);
  const setPat = useCallback((v: string) => { setPatRaw(v); localStorage.setItem("loupe_pat", v); }, []);

  // Parse fileKey / nodeId from the current Figma URL
  function parseFigmaUrl(url: string) {
    const fileKeyMatch = url.match(/figma\.com\/(?:file|design)\/([A-Za-z0-9]+)/);
    const nodeIdMatch  = url.match(/node-id=([^&]+)/);
    if (!fileKeyMatch || !nodeIdMatch) return null;
    return { fileKey: fileKeyMatch[1], nodeId: decodeURIComponent(nodeIdMatch[1]).replace("-", ":") };
  }

  // Check Supabase for an existing snapshot on mount / URL change
  const checkSnapshot = useCallback(async (url: string) => {
    const parsed = parseFigmaUrl(url);
    if (!parsed) return;
    // Also check localStorage for cached meta
    const lsKey = `loupe_snap_meta_v1_${parsed.fileKey}_${parsed.nodeId}`;
    const lsMeta = localStorage.getItem(lsKey);
    if (lsMeta) { try { setSnapshot(JSON.parse(lsMeta)); } catch {} }
    // Verify against Supabase
    try {
      const r = await fetch(`/api/figma-sync?fileKey=${parsed.fileKey}&nodeId=${encodeURIComponent(parsed.nodeId)}`);
      const d = await r.json();
      if (d.snapshot) {
        const meta: SnapshotMeta = {
          id:             d.snapshot.id,
          frameName:      d.snapshot.frame_name ?? "Unknown",
          textNodeCount:  d.snapshot.text_node_count ?? 0,
          colorNodeCount: d.snapshot.color_node_count ?? 0,
          depthUsed:      d.snapshot.depth_used ?? 5,
          syncedAt:       d.snapshot.synced_at,
        };
        setSnapshot(meta);
        localStorage.setItem(lsKey, JSON.stringify(meta));
      } else {
        setSnapshot(null);
        localStorage.removeItem(lsKey);
      }
    } catch {}
  }, []);

  function toggleCheck(id: string) {
    setChecks(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  useEffect(() => {
    const savedUrl = localStorage.getItem("loupe_figma_url") ?? "";
    setFigmaUrlRaw(savedUrl);
    setLiveUrlRaw(localStorage.getItem("loupe_live_url") ?? "");
    setPatRaw(localStorage.getItem("loupe_pat")          ?? "");
    if (savedUrl) checkSnapshot(savedUrl);
  }, [checkSnapshot]);

  // Lazy collaborator load — only fires when user explicitly requests it
  const loadCollaborators = useCallback(async () => {
    if (collaboratorsLoading || collaboratorsLoaded) return;
    const m = figmaUrl.match(/figma\.com\/(?:file|design)\/([A-Za-z0-9]+)/);
    if (!m || !pat.trim()) return;
    setCollaboratorsLoading(true);
    try {
      const r = await fetch("/api/figma-collaborators", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileKey: m[1], pat: pat.trim() }),
      });
      const d = await r.json();
      setCollaborators(d.users ?? []);
      setCollaboratorsLoaded(true);
    } catch {}
    setCollaboratorsLoading(false);
  }, [figmaUrl, pat, collaboratorsLoading, collaboratorsLoaded]);

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
          if (d?.data) { setLiveData(d.data); setLiveStyles(d.data.typography ?? []); }
          else if (d?.styles?.length) setLiveStyles(d.styles);
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

  async function syncDesign() {
    const parsed = parseFigmaUrl(figmaUrl);
    if (!parsed || !pat.trim()) { setConfigOpen(true); return; }
    setSyncing(true);
    const t0 = Date.now();
    addRun({ type: "step", text: "Syncing design from Figma — fetching nodes…" });

    // Show elapsed time every 5s so the user knows it's still running
    const ticker = setInterval(() => {
      const secs = Math.round((Date.now() - t0) / 1000);
      addRun({ type: "step", text: `Still syncing… ${secs}s elapsed (Figma may be rate limiting — please wait)` });
    }, 5000);

    try {
      const r = await fetch("/api/figma-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileKey: parsed.fileKey, nodeId: parsed.nodeId, pat: pat.trim() }),
      });
      let d: any;
      try {
        d = await r.json();
      } catch {
        const status = r.status;
        if (status === 504 || status === 502) {
          addRun({ type: "error", text: `Sync timed out (${status}) — your Figma file may be very large. Wait 30 seconds and try again.` });
        } else {
          addRun({ type: "error", text: `Sync failed (${status}) — server returned an unexpected response. Try again.` });
        }
        return;
      }
      if (!r.ok) {
        addRun({ type: "error", text: d?.error ?? `Sync failed (${r.status})` });
        return;
      }
      const meta: SnapshotMeta = {
        id:             d.snapshotId,
        frameName:      d.frameName,
        textNodeCount:  d.textNodeCount,
        colorNodeCount: d.colorNodeCount,
        depthUsed:      d.depthUsed,
        syncedAt:       new Date().toISOString(),
      };
      setSnapshot(meta);
      const lsKey = `loupe_snap_meta_v1_${parsed.fileKey}_${parsed.nodeId}`;
      localStorage.setItem(lsKey, JSON.stringify(meta));
      addRun({ type: "step", text: `Design synced — "${d.frameName}" · ${d.textNodeCount} text nodes · depth=${d.depthUsed} · ${Math.round((Date.now() - t0) / 1000)}s total. Scans will use this snapshot.` });
    } catch (e) {
      addRun({ type: "error", text: `Sync error: ${String(e)}` });
    } finally {
      clearInterval(ticker);
      setSyncing(false);
    }
  }

  async function publishComments() {
    const parsed = parseFigmaUrl(figmaUrl);
    if (!parsed || !pat.trim() || !lastSnapshotId) return;
    setPublishing(true);
    try {
      const r = await fetch("/api/figma-publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          snapshotId: lastSnapshotId,
          fileKey:    parsed.fileKey,
          nodeId:     parsed.nodeId,
          pat:        pat.trim(),
          assignTo:   assignTo || undefined,
        }),
      });
      const d = await r.json();
      if (!r.ok) { addRun({ type: "error", text: d.error ?? "Publish failed" }); return; }
      addRun({ type: "step", text: `Published ${d.posted} comments to Figma. ${d.skipped} already existed.` });
    } catch (e) {
      addRun({ type: "error", text: `Publish error: ${String(e)}` });
    } finally {
      setPublishing(false);
    }
  }

  async function run(forceRefresh = false) {
    if (scanGuardRef.current) return; // prevent concurrent scans
    if (!figmaUrl.trim() || !liveUrl.trim() || !pat.trim()) { setConfigOpen(true); return; }
    if (checks.size === 0) { addRun({ type: "error", text: "Select at least one check." }); return; }

    scanGuardRef.current = true;
    setRunning(true);
    setConfigOpen(false);
    const checkLabels = CHECK_OPTIONS.filter(c => checks.has(c.id)).map(c => c.label).join(", ");
    addRun({ type: "user", text: `Check ${checkLabels} — Figma vs ${liveUrl.trim()}` });

    try {
      const parsed = parseFigmaUrl(figmaUrl);
      if (!parsed) { addRun({ type: "error", text: "Invalid Figma URL." }); setRunning(false); return; }
      const { fileKey, nodeId } = parsed;

      // ── Browser cache (speed only) ───────────────────────────────────────────
      const cacheKey = `loupe_nodes_v2_${fileKey}_${nodeId}`;
      const cached   = localStorage.getItem(cacheKey);
      let figmaNodes: any = null;
      let styleNameMap: Record<string, string> = {};

      // Only use browser cache if no snapshot exists and not force-refreshing
      const hasSnapshot = !forceRefresh && (snapshot !== null);
      if (!hasSnapshot && cached && !forceRefresh) {
        const p = JSON.parse(cached);
        figmaNodes   = p.figmaNodes;
        styleNameMap = p.styleNameMap ?? {};
      }

      // ── If no snapshot and no browser cache: browser pre-fetch from Figma ───
      // (Skipped entirely when a snapshot exists — zero Figma API calls)
      if (!hasSnapshot && !figmaNodes) {
        addRun({ type: "step", text: "No snapshot — fetching from Figma (sync first to avoid this)…" });
        const figmaRes = await fetch(
          `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}&depth=10`,
          { headers: { "X-Figma-Token": pat.trim() } }
        );
        if (figmaRes.status === 429) {
          const retryAfter = figmaRes.headers.get("Retry-After");
          const planTier   = figmaRes.headers.get("X-Figma-Plan-Tier") ?? "unknown";
          const limitType  = figmaRes.headers.get("X-Figma-Rate-Limit-Type") ?? "unknown";
          let waitMsg = "Please wait a moment and try again.";
          if (retryAfter) {
            const secs = parseInt(retryAfter, 10);
            if (secs > 3600) {
              const hours = Math.ceil(secs / 3600);
              waitMsg = `Your Figma API quota is exhausted (plan: ${planTier}, limit type: ${limitType}). Retry-After: ${secs}s (~${hours} hour${hours !== 1 ? "s" : ""}). The quota resets in approximately ${hours} hour${hours !== 1 ? "s" : ""}.`;
            } else if (secs > 60) {
              const mins = Math.ceil(secs / 60);
              waitMsg = `Rate limited (plan: ${planTier}). Please wait ${mins} minute${mins !== 1 ? "s" : ""} (${secs}s) then try again.`;
            } else {
              waitMsg = `Rate limited. Please wait ${secs} seconds then try again.`;
            }
          }
          addRun({ type: "error", text: `Figma returned 429 — ${waitMsg}` });
          setRunning(false);
          return;
        }
        if (!figmaRes.ok) {
          addRun({ type: "error", text: `Figma API error ${figmaRes.status}. Sync design first to avoid Figma API calls.` });
          setRunning(false);
          return;
        }
        figmaNodes = await figmaRes.json();
        try { localStorage.setItem(cacheKey, JSON.stringify({ figmaNodes, styleNameMap })); } catch {}
      }

      const res = await fetch("/api/agents/figma-compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Pass snapshot ID if we have one — compare route reads from Supabase
          snapshotId:   hasSnapshot ? snapshot!.id : null,
          // Browser cache (fallback, only when no snapshot)
          figmaNodes:   hasSnapshot ? null : (forceRefresh ? null : figmaNodes),
          styleNameMap: hasSnapshot ? {} : (forceRefresh ? {} : styleNameMap),
          fileKey, nodeId,
          liveUrl:    liveUrl.trim(),
          liveData:   liveDataRef.current ?? null,
          liveStyles: liveDataRef.current ? null : (liveStylesRef.current ?? []).map((s: any) => ({
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
            if (data.type === "step")      addRun({ type: "step",      text: data.text });
            if (data.type === "error")     addRun({ type: "error",     text: data.text });
            if (data.type === "figma-log") addRun({ type: "figma-log", text: `${data.method} ${data.path} → ${data.status} (${data.durationMs}ms${data.kb != null ? ` · ${data.kb}KB` : ""})${data.retried ? " [retried]" : ""}` });
            if (data.type === "result") {
              addRun({ type: "result", text: data.text, table: data.table, figmaApiReport: data.figmaApiReport });
              if (data.snapshotId) setLastSnapshotId(data.snapshotId);
            }
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
      scanGuardRef.current = false;
    }
  }

  async function sendChat() {
    const text = chatInput.trim();
    if (!text || chatBusy) return;
    setChatInput("");
    setChatBusy(true);
    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: "user", text };
    setChatMsgs(prev => [...prev, userMsg]);

    // Build context from the latest completed scan result
    const latestResult = [...runMsgs].reverse().find(m => m.type === "result");
    const scanContext = {
      figmaUrl: figmaUrl || undefined,
      liveUrl:  liveUrl  || undefined,
      checks:   Array.from(checks),
      discrepancies: latestResult?.table ?? [],
      summary:  latestResult?.text ?? undefined,
    };

    try {
      const res = await fetch("/api/agents/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history: chatMsgs.slice(-10), context: scanContext }),
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
            {/* Snapshot status */}
            {snapshot ? (
              <span className="flex items-center gap-1.5 rounded-full bg-[#e8f6ee] px-2.5 py-1 text-[11px] font-medium text-[#1a9457]">
                <Database size={10} />
                {snapshot.textNodeCount} nodes · depth={snapshot.depthUsed}
              </span>
            ) : (
              <span className="flex items-center gap-1.5 rounded-full bg-[#fff8e6] px-2.5 py-1 text-[11px] font-medium text-[#b07d00]">
                No snapshot
              </span>
            )}
            {/* Sync Design button */}
            {figmaUrl.trim() && pat.trim() && (
              <button onClick={syncDesign} disabled={syncing}
                className="flex items-center gap-1.5 rounded-lg border border-[#e8e8ec] bg-white px-2.5 py-1.5 text-[11px] font-medium text-[#5b5b66] hover:border-[#0f0f0f] hover:text-[#0f0f0f] disabled:opacity-40 transition-all">
                {syncing ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                {syncing ? "Syncing…" : snapshot ? "Re-sync" : "Sync Design"}
              </button>
            )}
            {/* Live styles status */}
            {scrapeStatus === "fetching" && (
              <span className="flex items-center gap-1.5 rounded-full bg-[#f0f0f0] px-2.5 py-1 text-[11px] font-medium text-[#9a9aa5]">
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
                <div className="rounded-xl border border-[#f0f0f0] bg-white px-4 py-3 flex items-center gap-3">
                  <span className="text-[12px] font-medium text-[#5b5b66] shrink-0">Assign QA to</span>
                  {!collaboratorsLoaded ? (
                    <button onClick={loadCollaborators} disabled={collaboratorsLoading || !figmaUrl.trim() || !pat.trim()}
                      className="text-[11px] text-[#9a9aa5] hover:text-[#0f0f0f] disabled:opacity-40 transition-colors">
                      {collaboratorsLoading ? "Loading…" : "Load collaborators"}
                    </button>
                  ) : (
                    <select value={assignTo} onChange={e => setAssignTo(e.target.value)}
                      className="flex-1 rounded-lg border border-[#e8e8ec] bg-white px-2 py-1.5 text-[12px] text-[#17171c] focus:outline-none focus:border-[#0f0f0f]">
                      <option value="">No assignment</option>
                      {collaborators.map(u => (
                        <option key={u.id} value={u.handle}>@{u.handle}</option>
                      ))}
                    </select>
                  )}
                </div>
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
                <div className="flex items-center gap-3 px-1">
                  <span className="text-[12px] font-medium text-[#5b5b66] shrink-0">Assign QA to</span>
                  {!collaboratorsLoaded ? (
                    <button onClick={loadCollaborators} disabled={collaboratorsLoading || !figmaUrl.trim() || !pat.trim()}
                      className="text-[11px] text-[#9a9aa5] hover:text-[#0f0f0f] disabled:opacity-40 transition-colors">
                      {collaboratorsLoading ? "Loading…" : "Load collaborators"}
                    </button>
                  ) : (
                    <select value={assignTo} onChange={e => setAssignTo(e.target.value)}
                      className="flex-1 rounded-lg border border-[#e8e8ec] bg-white px-2 py-1.5 text-[12px] text-[#17171c] focus:outline-none focus:border-[#0f0f0f]">
                      <option value="">No assignment</option>
                      {collaborators.map(u => <option key={u.id} value={u.handle}>@{u.handle}</option>)}
                    </select>
                  )}
                </div>
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
                {lastSnapshotId && (
                  <button onClick={publishComments} disabled={publishing || running}
                    className="flex items-center gap-1.5 rounded-lg border border-[#e8e8ec] px-3 py-1.5 text-[12px] text-[#5b5b66] hover:border-[#0f0f0f] hover:text-[#0f0f0f] disabled:opacity-40 transition-all">
                    {publishing ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
                    {publishing ? "Publishing…" : "Publish to Figma"}
                  </button>
                )}
                <button onClick={() => run(true)} disabled={!canRun}
                  className="flex items-center gap-1.5 rounded-lg border border-[#e8e8ec] px-3 py-1.5 text-[12px] text-[#9a9aa5] hover:border-[#0f0f0f] hover:text-[#0f0f0f] disabled:opacity-40 transition-all">
                  <ArrowUp size={11} />Refresh Design
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
              {(() => {
                const latestResult = [...runMsgs].reverse().find(m => m.type === "result");
                const hasResults = !!latestResult?.table?.length;
                const suggestions = hasResults
                  ? [
                      "Summarize the issues found",
                      "How do I fix the font mismatches?",
                      "Which issues are most critical?",
                    ]
                  : [
                      "What checks does Loupe perform?",
                      "How do I get my Figma node ID?",
                      "Why might colors look different on the live site?",
                    ];
                return (
                  <>
                    <p className="text-[12px] text-[#9a9aa5]">
                      {hasResults ? "Scan complete. Ask about the results." : "Ask anything about design or this tool."}
                    </p>
                    <div className="space-y-1.5 w-full">
                      {suggestions.map(q => (
                        <button key={q} onClick={() => { setChatInput(q); }}
                          className="w-full rounded-lg border border-[#e8e8ec] bg-white px-3 py-2 text-left text-[11px] text-[#5b5b66] hover:border-[#0f0f0f] hover:text-[#0f0f0f] transition-colors">
                          {q}
                        </button>
                      ))}
                    </div>
                  </>
                );
              })()}
            </div>
          )}
          {chatMsgs.map(msg => (
            <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-[12px] leading-relaxed ${
                msg.role === "user"
                  ? "bg-[#0f0f0f] text-white rounded-tr-sm"
                  : "bg-white border border-[#f0f0f0] text-[#17171c] rounded-tl-sm"
              }`}>
                {msg.role === "assistant" ? <MdText text={msg.text} /> : msg.text}
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

/* ── MdText: lightweight markdown renderer ───────────────────────── */
function MdText({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-1">
      {lines.map((line, i) => {
        if (!line.trim()) return <div key={i} className="h-1" />;
        const isBullet   = /^[\-\*\•]\s/.test(line);
        const numMatch   = line.match(/^(\d+)\.\s(.*)/);
        const isNumbered = !!numMatch;
        const marker     = isNumbered ? numMatch![1] + "." : "•";
        const content    = isBullet   ? line.replace(/^[\-\*\•]\s/, "")
                         : isNumbered ? numMatch![2]
                         : line;
        const isList = isBullet || isNumbered;
        return (
          <div key={i} className={isList ? "flex gap-1.5" : ""}>
            {isList && <span className="mt-0.5 shrink-0 text-[#9a9aa5]">{marker}</span>}
            <span className={isList ? "flex-1" : ""}>{renderInline(content)}</span>
          </div>
        );
      })}
    </div>
  );
}

function renderInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let last = 0, m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const raw = m[0];
    if (raw.startsWith("`"))
      parts.push(<code key={key++} className="rounded bg-[#f0f0f0] px-1 font-mono text-[11px] text-[#17171c]">{raw.slice(1, -1)}</code>);
    else
      parts.push(<strong key={key++} className="font-semibold">{raw.slice(2, -2)}</strong>);
    last = m.index + raw.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length === 1 ? parts[0] : <>{parts}</>;
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
  if (msg.type === "figma-log") return (
    <div className="flex items-center gap-2 text-[10px] font-mono text-[#c8c8d0] pl-4">
      <span className="shrink-0">↳</span>{msg.text}
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
      {msg.figmaApiReport && (
        <div className="rounded-2xl border border-[#f0f0f0] overflow-hidden">
          <div className="bg-[#fafafa] px-3 py-2 border-b border-[#f0f0f0] flex items-center gap-2">
            <span className="text-[10px] font-semibold text-[#9a9aa5] uppercase tracking-wide">Figma API calls</span>
            <span className="rounded-full bg-[#e8e8ec] px-1.5 py-0.5 text-[10px] font-medium text-[#5b5b66]">{msg.figmaApiReport.totalCalls} total</span>
          </div>
          <table className="w-full text-[10px] font-mono">
            <thead>
              <tr className="border-b border-[#f7f7f8] text-[#9a9aa5]">
                <th className="px-3 py-1.5 text-left">#</th>
                <th className="px-3 py-1.5 text-left">Method</th>
                <th className="px-3 py-1.5 text-left">Path</th>
                <th className="px-3 py-1.5 text-left">Status</th>
                <th className="px-3 py-1.5 text-left">ms</th>
                <th className="px-3 py-1.5 text-left">KB</th>
              </tr>
            </thead>
            <tbody>
              {msg.figmaApiReport.calls.map((c, i) => (
                <tr key={i} className={`border-b border-[#f7f7f8] last:border-0 ${c.status === 429 ? "bg-red-50" : ""}`}>
                  <td className="px-3 py-1 text-[#c8c8d0]">{i + 1}</td>
                  <td className={`px-3 py-1 font-semibold ${c.method === "POST" ? "text-[#6366f1]" : "text-[#5b5b66]"}`}>{c.method}</td>
                  <td className="px-3 py-1 text-[#5b5b66] max-w-[200px] truncate">{c.path}</td>
                  <td className={`px-3 py-1 font-semibold ${c.status === 429 ? "text-red-500" : c.status < 300 ? "text-emerald-600" : "text-amber-600"}`}>{c.status}{c.retried ? " ↺" : ""}</td>
                  <td className="px-3 py-1 text-[#9a9aa5]">{c.ms}</td>
                  <td className="px-3 py-1 text-[#9a9aa5]">{c.kb ?? "—"}</td>
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
