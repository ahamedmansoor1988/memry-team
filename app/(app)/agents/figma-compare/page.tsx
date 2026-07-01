"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Play, Loader2, ChevronRight, AlertCircle, CheckCircle2,
  Trash2, ArrowUp, FileCode2, Globe, KeyRound, Sparkles,
  Check, RefreshCw, Upload, Database,
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
interface DiscrepancyRow { element: string; issue: string; category?: string; severity?: string; commentId?: string; }

interface SnapshotMeta {
  id: string; frameName: string; textNodeCount: number;
  colorNodeCount: number; depthUsed: number; syncedAt: string;
}

const CHECK_OPTIONS = [
  { id: "missing_elements", label: "Missing Elements" },
  { id: "font_family",      label: "Font Family"      },
  { id: "font_size",        label: "Font Size"        },
  { id: "font_weight",      label: "Font Weight"      },
  { id: "color",            label: "Color"            },
  { id: "content",          label: "Content"          },
];

const EXTENSION_STYLE_MAX_AGE_MS = 10 * 60 * 1000;
const LOUPE_UI_TEXT = /^(font family|font size|font weight|color|content|missing elements|ai identified|results will appear here|figma vs live|design qa)$/i;

function normalizeUrlForCompare(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return value.trim().replace(/\/$/, "");
  }
}

function hasLoupeUiText(styles: any[]) {
  return styles.some(style => LOUPE_UI_TEXT.test(String(style?.text ?? "").trim()));
}

/* ── Page ────────────────────────────────────────────────────────── */
export default function FigmaComparePage() {
  // Config
  const [figmaUrl, setFigmaUrlRaw] = useState("");
  const [liveUrl,  setLiveUrlRaw]  = useState("");
  const [pat,      setPatRaw]      = useState("");
  const [checks, setChecks] = useState<Set<string>>(
    new Set(["missing_elements", "font_family", "font_size", "font_weight", "color", "content"])
  );
  const [configOpen, setConfigOpen] = useState(false);

  // Execution
  const [running,          setRunning]          = useState(false);
  const [runMsgs,          setRunMsgs]          = useState<RunMessage[]>([]);
  const [currentResult,    setCurrentResult]    = useState<RunMessage | null>(null);

  // Extension bridge
  const [liveStyles,        setLiveStyles]        = useState<any[] | null>(null);
  const [liveData,          setLiveData]          = useState<any | null>(null);
  const [scrapeStatus, setScrapeStatus] = useState<"idle"|"fetching"|"ready">("idle");
  const liveStylesRef = useRef<any[] | null>(null);
  const liveDataRef   = useRef<any | null>(null);
  liveStylesRef.current = liveStyles;
  liveDataRef.current   = liveData;

  // Snapshot
  const [snapshot,   setSnapshot]   = useState<SnapshotMeta | null>(null);
  const [syncing,    setSyncing]    = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [lastSnapshotId, setLastSnapshotId] = useState<string | null>(null);


  const runBottomRef = useRef<HTMLDivElement>(null);
  const scanGuardRef  = useRef(false);
  const setFigmaUrl = useCallback((v: string) => {
    setFigmaUrlRaw(v);
    localStorage.setItem("loupe_figma_url", v);
    setSnapshot(null); // reset snapshot status when URL changes
  }, []);
  const setPat = useCallback((v: string) => { setPatRaw(v); localStorage.setItem("loupe_pat", v); }, []);

  // Parse fileKey / nodeId from the current Figma URL
  function parseFigmaUrl(url: string) {
    const fileKeyMatch = url.match(/figma\.com\/(?:file|design)\/([A-Za-z0-9]+)/);
    const nodeIdMatch  = url.match(/node-id=([^&]+)/);
    if (!fileKeyMatch || !nodeIdMatch) return null;
    return { fileKey: fileKeyMatch[1], nodeId: decodeURIComponent(nodeIdMatch[1]).replace(/-/g, ":") };
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
    const params     = new URLSearchParams(window.location.search);
    const urlFigma   = params.get("figmaUrl");
    const urlLive    = params.get("liveUrl");
    const urlChecks  = params.get("checks");
    const autorun    = params.get("autorun") === "1";

    const savedFigma = urlFigma ?? localStorage.getItem("loupe_figma_url") ?? "";
    const savedLive  = urlLive  ?? localStorage.getItem("loupe_live_url")  ?? "";
    const savedPat   = localStorage.getItem("loupe_pat") ?? "";

    if (urlFigma)  { localStorage.setItem("loupe_figma_url", urlFigma); }
    if (urlLive)   { localStorage.setItem("loupe_live_url",  urlLive);  }
    if (urlChecks) { setChecks(new Set(urlChecks.split(",").filter(Boolean))); }


    setFigmaUrlRaw(savedFigma);
    setLiveUrlRaw(savedLive);
    setPatRaw(savedPat);
    if (savedFigma) checkSnapshot(savedFigma);

    if (autorun && savedFigma && savedLive && savedPat) {
      setTimeout(() => { document.getElementById("loupe-run-btn")?.click(); }, 800);
    }
  }, [checkSnapshot]);


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

  // Poll for styles written back by the extension bridge (if extension is installed)
  useEffect(() => {
    const id = setInterval(() => {
      try {
        const raw = localStorage.getItem("loupe_bridge_styles");
        if (raw) {
          const d = JSON.parse(raw);
          if (d?.data) { setLiveData(d.data); setLiveStyles(d.data.typography ?? []); }
          else if (d?.styles?.length) setLiveStyles(d.styles);
        }
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

  function addRun(msg: Omit<RunMessage, "id">) {
    setRunMsgs(prev => [...prev, { ...msg, id: crypto.randomUUID() }]);
  }

  async function syncDesign(): Promise<SnapshotMeta | null> {
    const parsed = parseFigmaUrl(figmaUrl);
    if (!parsed) { setConfigOpen(true); return null; }
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
        return null;
      }
      if (!r.ok) {
        addRun({ type: "error", text: d?.error ?? `Sync failed (${r.status})` });
        return null;
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
      return meta;
    } catch (e) {
      addRun({ type: "error", text: `Sync error: ${String(e)}` });
      return null;
    } finally {
      clearInterval(ticker);
      setSyncing(false);
    }
  }

  async function publishComments() {
    const parsed = parseFigmaUrl(figmaUrl);
    if (!parsed || !lastSnapshotId) return;
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
    if (!figmaUrl.trim() || !liveUrl.trim()) { setConfigOpen(true); return; }
    if (checks.size === 0) { addRun({ type: "error", text: "Select at least one check." }); return; }

    scanGuardRef.current = true;
    setRunning(true);
    setCurrentResult(null);
    setConfigOpen(false);
    const checkLabels = CHECK_OPTIONS.filter(c => checks.has(c.id)).map(c => c.label).join(", ");
    addRun({ type: "user", text: `Check ${checkLabels} — Figma vs ${liveUrl.trim()}` });

    try {
      const parsed = parseFigmaUrl(figmaUrl);
      if (!parsed) { addRun({ type: "error", text: "Invalid Figma URL." }); setRunning(false); return; }
      const { fileKey, nodeId } = parsed;

      // ── Auto-sync if no snapshot exists ──────────────────────────────────────
      let activeSnapshot = snapshot;
      if (!activeSnapshot && !forceRefresh) {
        addRun({ type: "step", text: "No snapshot found — syncing design from Figma first…" });
        activeSnapshot = await syncDesign();
        if (!activeSnapshot) return;
      }
      if (activeSnapshot && checks.has("content") && activeSnapshot.depthUsed < 10 && !forceRefresh) {
        addRun({ type: "step", text: `Content check needs a deeper Figma snapshot — refreshing depth ${activeSnapshot.depthUsed} snapshot…` });
        activeSnapshot = await syncDesign();
        if (!activeSnapshot) return;
      }

      // ── Browser cache (speed only) ───────────────────────────────────────────
      const cacheKey = `loupe_nodes_v2_${fileKey}_${nodeId}`;
      const cached   = localStorage.getItem(cacheKey);
      let figmaNodes: any = null;
      let styleNameMap: Record<string, string> = {};

      // Only use browser cache if no snapshot exists and not force-refreshing
      const hasSnapshot = !forceRefresh && (activeSnapshot !== null);
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

      // 1. Try extension styles captured from real Chrome (most accurate)
      let effectiveLiveStyles: any[] = [];

      const extRes = await fetch(`/api/extension-styles?url=${encodeURIComponent(liveUrl.trim())}`).catch(() => null);
      if (extRes?.ok) {
        const extData = await extRes.json();
        if (Array.isArray(extData.styles) && extData.styles.length > 0) {
          const capturedAt = extData.captured_at ? Date.parse(extData.captured_at) : 0;
          const isFresh = capturedAt > 0 && Date.now() - capturedAt <= EXTENSION_STYLE_MAX_AGE_MS;
          const sameUrl = normalizeUrlForCompare(extData.url ?? liveUrl.trim()) === normalizeUrlForCompare(liveUrl.trim());
          const polluted = hasLoupeUiText(extData.styles);
          if (!isFresh) {
            addRun({ type: "step", text: "Extension styles are stale — using fallback scraper. Recapture the live page for best accuracy." });
          } else if (!sameUrl) {
            addRun({ type: "step", text: "Extension styles were captured from a different URL — using fallback scraper." });
          } else if (polluted) {
            addRun({ type: "step", text: "Extension styles contain Loupe UI text — recapture from the live site tab." });
          } else {
            effectiveLiveStyles = extData.styles;
            addRun({ type: "step", text: `Extension captured ${effectiveLiveStyles.length} fresh live styles from real Chrome.` });
          }
        }
      }

      // 2. Fall back to Render scraper if no extension styles
      if (effectiveLiveStyles.length === 0) {
        addRun({ type: "step", text: "No extension styles — fetching from Render scraper…" });
        try {
          const scraperRes = await fetch("/api/scrape-styles", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: liveUrl.trim() }),
            signal: AbortSignal.timeout(30_000),
          });
          if (scraperRes.ok) {
            const scraperData = await scraperRes.json();
            effectiveLiveStyles = scraperData.styles ?? [];
            addRun({ type: "step", text: `Scraper returned ${effectiveLiveStyles.length} live styles.` });
          } else {
            addRun({ type: "step", text: "Scraper failed — AI will compare Figma only." });
          }
        } catch {
          addRun({ type: "step", text: "Scraper timed out — AI will compare Figma only." });
        }
      }

      const res = await fetch("/api/agents/figma-compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          snapshotId:   hasSnapshot ? activeSnapshot!.id : null,
          figmaNodes:   hasSnapshot ? null : (forceRefresh ? null : figmaNodes),
          styleNameMap: hasSnapshot ? {} : (forceRefresh ? {} : styleNameMap),
          fileKey, nodeId,
          liveUrl:    liveUrl.trim(),
          liveData:   liveDataRef.current ?? null,
          liveStyles: effectiveLiveStyles,
          pat: pat.trim(),
          checks: Array.from(checks),
          forceRefresh,
        }),
      });

      if (!res.body) throw new Error("No response body");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let pendingChunk = "";
      const handleStreamLine = (line: string) => {
        if (!line.startsWith("data: ")) return;
        try {
          const data = JSON.parse(line.slice(6));
          if (data.type === "step")      addRun({ type: "step",      text: data.text });
          if (data.type === "error")     addRun({ type: "error",     text: data.text });
          if (data.type === "figma-log") addRun({ type: "figma-log", text: `${data.method} ${data.path} → ${data.status} (${data.durationMs}ms${data.kb != null ? ` · ${data.kb}KB` : ""})${data.retried ? " [retried]" : ""}` });
          if (data.type === "result") {
            const msg: RunMessage = { id: crypto.randomUUID(), type: "result", text: data.text, table: data.table, figmaApiReport: data.figmaApiReport };
            setRunMsgs(prev => [...prev, msg]);
            setCurrentResult(msg);
            if (data.snapshotId) setLastSnapshotId(data.snapshotId);
          }
          if (data.type === "cache") {
            try { localStorage.setItem(cacheKey, JSON.stringify({ figmaNodes: data.figmaNodes, styleNameMap: data.styleNameMap })); } catch {}
          }
        } catch {}
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        pendingChunk += decoder.decode(value, { stream: true });
        const lines = pendingChunk.split("\n");
        pendingChunk = lines.pop() ?? "";
        for (const line of lines) handleStreamLine(line);
      }
      pendingChunk += decoder.decode();
      if (pendingChunk) handleStreamLine(pendingChunk);
    } catch (err) {
      addRun({ type: "error", text: `Connection error: ${String(err)}` });
    } finally {
      setRunning(false);
      scanGuardRef.current = false;
    }
  }


  const canRun = !running && !!figmaUrl.trim() && !!liveUrl.trim() && checks.size > 0;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">

      {/* ── CENTER: Execution ──────────────────────────────────────── */}
      <div className="flex flex-1 flex-col min-h-0 min-w-0">
        {/* Top bar */}
        <div className="flex h-[45px] items-center justify-between border-b border-[#f0f0f0] px-5 shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles size={13} className="text-[#71717a]" />
            <span className="text-[13px] font-medium text-[#17171c]">Figma vs Live</span>
            <span className="rounded-full bg-[#f0f0f0] px-2 py-0.5 text-[10px] font-medium text-[#71717a]">Design QA</span>
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
            {/* Live styles status */}
            {scrapeStatus === "fetching" && (
              <span className="flex items-center gap-1.5 rounded-full bg-[#f0f0f0] px-2.5 py-1 text-[11px] font-medium text-[#71717a]">
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
              <button onClick={() => setRunMsgs([])} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] text-[#71717a] hover:bg-[#f7f7f8] hover:text-[#17171c] transition-colors">
                <Trash2 size={12} />Clear
              </button>
            )}
          </div>
        </div>


        {/* Execution area */}
        {runMsgs.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-5 px-6 py-12">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#0f0f0f]">
              <Sparkles size={18} className="text-white" />
            </div>
            <div className="text-center">
              <p className="text-[15px] font-semibold text-[#17171c]">Figma vs Live</p>
              <p className="mt-1 text-[12px] text-[#71717a]">Configure below and run to find design discrepancies.</p>
            </div>
            <div className="w-full max-w-md space-y-2">
              <ConfigCard icon={FileCode2} label="Figma Frame" value={figmaUrl} placeholder="Paste Figma frame URL" onChange={setFigmaUrl} hint="Right-click frame → Copy link to selection" />
              <ConfigCard icon={Globe} label="Live Site" value={liveUrl} placeholder="Paste live site URL" onChange={setLiveUrl} />
              <ConfigCard icon={KeyRound} label="Figma Token" value={pat} placeholder="figd_..." onChange={setPat} secret />
              <div className="rounded-xl border border-[#f0f0f0] bg-white px-4 py-3">
                <ChecklistPanel checks={checks} onToggle={toggleCheck} />
              </div>
              <button id="loupe-run-btn" onClick={() => run(false)} disabled={!canRun}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#0f0f0f] px-5 py-2.5 text-[13px] font-medium text-white disabled:opacity-40 hover:bg-[#1a1a1a] transition-all">
                {running ? <><Loader2 size={13} className="animate-spin" />Running…</> : <><Play size={13} />Run comparison</>}
              </button>
            </div>
          </div>
        ) : (
          /* ── Split screen: log left | results right ── */
          <div className="flex flex-1 overflow-hidden min-h-0">
            {/* Left: execution log */}
            <div className="w-[38%] shrink-0 flex flex-col border-r border-[#f0f0f0] overflow-hidden">
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[#d0d0d8] mb-4 select-none">Steps</p>
                {runMsgs.filter(m => m.type !== "result").map(msg => (
                  <LogLine key={msg.id} msg={msg} />
                ))}
                {running && (
                  <div className="flex items-center gap-2 text-[12px] text-[#c0c0c8]">
                    <Loader2 size={11} className="animate-spin shrink-0" />
                    <span>Analyzing…</span>
                  </div>
                )}
                <div ref={runBottomRef} />
              </div>
            </div>

            {/* Right: results */}
            <div className="flex-1 overflow-y-auto">
              {!currentResult ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 px-8">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#f5f5f7]">
                    <Sparkles size={16} className="text-[#c0c0c8]" />
                  </div>
                  <p className="text-[13px] text-[#b0b0b8] text-center">{running ? "Running comparison…" : "Results will appear here"}</p>
                </div>
              ) : (
                <div className="px-6 py-5">
                  <RunBubble msg={currentResult} />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Bottom bar */}
        {runMsgs.length > 0 && (
          <div className="shrink-0 border-t border-[#f0f0f0] bg-white px-5 py-3">
            {configOpen && (
              <div className="mb-3 rounded-xl border border-[#f0f0f0] bg-[#fafafa] p-3 space-y-2">
                <ConfigCard icon={FileCode2} label="Figma Frame" value={figmaUrl} placeholder="Paste Figma frame URL" onChange={setFigmaUrl} hint="Right-click frame → Copy link to selection" />
                <ConfigCard icon={Globe} label="Live Site" value={liveUrl} placeholder="Paste live site URL" onChange={setLiveUrl} />
                <ChecklistPanel checks={checks} onToggle={toggleCheck} />
              </div>
            )}
            <div className="flex items-center gap-2">
              <button onClick={() => setConfigOpen(o => !o)}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors ${configOpen ? "border-[#0f0f0f] bg-[#0f0f0f] text-white" : "border-[#e8e8ec] text-[#71717a] hover:border-[#0f0f0f] hover:text-[#0f0f0f]"}`}>
                Configure
              </button>
              <div className="flex flex-wrap gap-1 mx-1">
                {CHECK_OPTIONS.filter(c => checks.has(c.id)).map(c => (
                  <span key={c.id} className="rounded-full bg-[#f0f0f0] px-2 py-0.5 text-[10px] text-[#3f3f46]">{c.label}</span>
                ))}
              </div>
              <div className="ml-auto flex items-center gap-2">
                {lastSnapshotId && (
                  <button onClick={publishComments} disabled={publishing || running}
                    className="flex items-center gap-1.5 rounded-lg border border-[#e8e8ec] px-3 py-1.5 text-[12px] text-[#3f3f46] hover:border-[#0f0f0f] hover:text-[#0f0f0f] disabled:opacity-40 transition-all">
                    {publishing ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
                    {publishing ? "Publishing…" : "Publish to Figma"}
                  </button>
                )}
                <button onClick={() => run(true)} disabled={!canRun}
                  className="flex items-center gap-1.5 rounded-lg border border-[#e8e8ec] px-3 py-1.5 text-[12px] text-[#71717a] hover:border-[#0f0f0f] hover:text-[#0f0f0f] disabled:opacity-40 transition-all">
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
            {isList && <span className="mt-0.5 shrink-0 text-[#71717a]">{marker}</span>}
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
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#71717a]">What to check</p>
      <div className="flex flex-wrap gap-1.5">
        {CHECK_OPTIONS.map(opt => {
          const active = checks.has(opt.id);
          return (
            <button key={opt.id} onClick={() => onToggle(opt.id)}
              className={`flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-all ${active ? "border-[#0f0f0f] bg-[#0f0f0f] text-white" : "border-[#e8e8ec] text-[#71717a] hover:border-[#71717a]"}`}>
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
      <Icon size={13} className="mt-0.5 shrink-0 text-[#71717a]" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] font-semibold text-[#71717a] uppercase tracking-wide">{label}</span>
          {badge && <span className="rounded-full bg-[#e8f6ee] px-2 py-0.5 text-[10px] font-medium text-[#1a9457]">{badge}</span>}
        </div>
        <input type={secret ? "password" : "text"} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
          className="w-full bg-transparent text-[12px] text-[#17171c] placeholder:text-[#a1a1aa] outline-none" />
        {hint && <p className="mt-0.5 text-[10px] text-[#a1a1aa]">{hint}</p>}
      </div>
    </div>
  );
}

function IssueDiff({ issue }: { issue: string }) {
  const m = issue.match(/Figma:\s*(.+?)\s*—\s*Live:\s*(.+)/);
  if (!m) return <span className="text-[#3f3f46]">{issue}</span>;
  return (
    <span className="flex items-center gap-1.5 flex-wrap">
      <span className="rounded px-1.5 py-0.5 bg-[#f0f0f0] text-[#17171c] font-mono text-[10px]">{m[1]}</span>
      <span className="text-[#a1a1aa] text-[10px]">→</span>
      <span className="rounded px-1.5 py-0.5 bg-[#fff0f0] text-red-600 font-mono text-[10px]">{m[2]}</span>
    </span>
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
    <div className="flex items-center gap-2 text-[10px] font-mono text-[#a1a1aa] pl-4">
      <span className="shrink-0">↳</span>{msg.text}
    </div>
  );
  if (msg.type === "error") return (
    <div className="flex items-start gap-3 rounded-2xl border border-red-100 bg-red-50 px-4 py-3">
      <AlertCircle size={13} className="text-red-500 mt-0.5 shrink-0" />
      <p className="text-[12px] text-red-600 leading-relaxed">{msg.text}</p>
    </div>
  );
  if (msg.type === "result") {
    const categoryColors: Record<string, { bg: string; text: string; label: string }> = {
      missing_elements: { bg: "#fef2f2", text: "#dc2626", label: "Missing"     },
      font_family:      { bg: "#faf5ff", text: "#9333ea", label: "Font Family" },
      font_size:        { bg: "#eff6ff", text: "#2563eb", label: "Font Size"   },
      font_weight:      { bg: "#fffbeb", text: "#d97706", label: "Font Weight" },
      color:            { bg: "#fdf2f8", text: "#db2777", label: "Color"       },
      content:          { bg: "#f0fdf4", text: "#16a34a", label: "Content"     },
    };

    // Build category summary for banner
    const catCounts: Record<string, number> = {};
    (msg.table ?? []).forEach(r => { const c = r.category ?? "other"; catCounts[c] = (catCounts[c] ?? 0) + 1; });
    const catSummary = Object.entries(catCounts)
      .map(([c, n]) => `${n} ${(categoryColors[c]?.label ?? c).toLowerCase()}`)
      .join(", ");

    return (
      <div className="space-y-3">
        {/* Summary banner */}
        {(() => {
          const hasIssues = (msg.table?.length ?? 0) > 0;
          return (
            <div className={`flex items-center gap-3 rounded-2xl border px-4 py-3 ${
              hasIssues
                ? "border-orange-100 bg-orange-50"
                : "border-emerald-100 bg-emerald-50"
            }`}>
              <CheckCircle2 size={14} className={`shrink-0 ${hasIssues ? "text-orange-500" : "text-emerald-600"}`} />
              <div>
                <p className={`text-[13px] font-semibold ${hasIssues ? "text-orange-800" : "text-emerald-800"}`}>
                  {hasIssues ? `${msg.table!.length} issue${msg.table!.length !== 1 ? "s" : ""} found` : "No issues found"}
                </p>
                {catSummary && <p className={`text-[11px] mt-0.5 ${hasIssues ? "text-orange-600" : "text-emerald-600"}`}>{catSummary}</p>}
              </div>
            </div>
          );
        })()}

        {/* Issues table */}
        {msg.table && msg.table.length > 0 && (
          <div className="rounded-2xl border border-[#f0f0f0] overflow-hidden">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-[#f0f0f0] bg-[#fafafa]">
                  <th className="px-3 py-2.5 text-left font-medium text-[#71717a] w-6">#</th>
                  <th className="px-3 py-2.5 text-left font-medium text-[#71717a]">Element</th>
                  <th className="px-3 py-2.5 text-left font-medium text-[#71717a]">Type</th>
                  <th className="px-3 py-2.5 text-left font-medium text-[#71717a]">Issue</th>
                </tr>
              </thead>
              <tbody>
                {msg.table.map((row, i) => {
                  const cat = categoryColors[row.category ?? ""] ?? { bg: "bg-gray-50", text: "text-gray-500", label: row.category ?? "" };
                  const isHigh = row.severity === "high" || row.category === "missing_elements";
                  return (
                    <tr key={i} style={isHigh ? { backgroundColor: "#fff8f8" } : {}} className="border-b border-[#f7f7f8] last:border-0 hover:bg-[#fafafa]">
                      <td className="px-3 py-2.5 text-[#a1a1aa] text-[11px]">{i + 1}</td>
                      <td className="px-3 py-2.5 font-semibold text-[#17171c]">{row.element}</td>
                      <td className="px-3 py-2.5">
                        <span style={{ backgroundColor: cat.bg, color: cat.text }} className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium">
                          {cat.label || (row.category ?? "").replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="px-3 py-2.5"><IssueDiff issue={row.issue} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }
  return null;
}

function LogLine({ msg }: { msg: RunMessage }) {
  if (msg.type === "user") return (
    <div className="text-[12px] font-medium text-[#17171c] pt-3 pb-1 border-t border-[#f0f0f0] mt-2 first:border-0 first:pt-0 leading-relaxed">
      {msg.text}
    </div>
  );
  if (msg.type === "step") return (
    <div className="flex items-start gap-2 text-[12px] text-[#71717a] leading-relaxed">
      <ChevronRight size={12} className="mt-0.5 shrink-0 text-[#d0d0d8]" />
      <span>{msg.text}</span>
    </div>
  );
  if (msg.type === "figma-log") return (
    <div className="text-[11px] text-[#c0c0c8] pl-5 leading-relaxed">
      {msg.text}
    </div>
  );
  if (msg.type === "error") return (
    <div className="flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-[12px] text-red-500 leading-relaxed">
      <AlertCircle size={12} className="mt-0.5 shrink-0" />
      <span>{msg.text}</span>
    </div>
  );
  return null;
}
