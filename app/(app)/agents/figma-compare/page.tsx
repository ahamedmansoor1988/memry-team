"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Eye, EyeOff, Play, Loader2, CheckCircle2, AlertCircle,
  Globe, KeyRound, ScanSearch, FileCode2, Zap,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

interface DiscrepancyRow {
  element: string;
  issue: string;
  commentId?: string;
}

type RunStatus = "idle" | "running" | "done" | "error";

interface SharedState {
  figmaUrl: string;
  setFigmaUrl: (v: string) => void;
  liveUrl: string;
  setLiveUrl: (v: string) => void;
  pat: string;
  setPat: (v: string) => void;
  liveStyles: any[] | null;
  liveStylesUrl: string;
  status: RunStatus;
  log: string[];
  results: DiscrepancyRow[];
  resultText: string;
  run: () => void;
}

// ── Utility ──────────────────────────────────────────────────────────────────

function extractStyleIds(node: any, ids: Set<string> = new Set()): string[] {
  if (!node) return [];
  if (node.styles?.text) ids.add(node.styles.text);
  if (node.styles?.fill) ids.add(node.styles.fill);
  for (const child of node.children ?? []) extractStyleIds(child, ids);
  return Array.from(ids);
}

// ── Node: Figma File ─────────────────────────────────────────────────────────

function FigmaFileNode({ data }: NodeProps) {
  const s = data.shared as SharedState;
  const fileKey = s.figmaUrl.match(/figma\.com\/(?:file|design)\/([A-Za-z0-9]+)/)?.[1];
  const nodeId  = s.figmaUrl.match(/node-id=([^&]+)/)?.[1];
  const valid   = !!(fileKey && nodeId);

  return (
    <div className="node-card w-[280px]">
      <div className="node-header">
        <FileCode2 size={13} className="text-[#6366f1]" />
        <span>Figma Frame</span>
      </div>
      <div className="node-body">
        <input
          value={s.figmaUrl}
          onChange={e => s.setFigmaUrl(e.target.value)}
          placeholder="https://figma.com/design/..."
          className="node-input"
        />
        {s.figmaUrl && (
          <div className={`node-pill ${valid ? "pill-green" : "pill-red"}`}>
            {valid ? `${fileKey} · node ${nodeId}` : "Missing node-id — right-click frame → Copy link"}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Right} className="!bg-[#6366f1] !w-2.5 !h-2.5 !border-2 !border-white" />
    </div>
  );
}

// ── Node: Live Site ───────────────────────────────────────────────────────────

function LiveSiteNode({ data }: NodeProps) {
  const s = data.shared as SharedState;

  return (
    <div className="node-card w-[280px]">
      <div className="node-header">
        <Globe size={13} className="text-[#0ea5e9]" />
        <span>Live Site</span>
      </div>
      <div className="node-body">
        <input
          value={s.liveUrl}
          onChange={e => s.setLiveUrl(e.target.value)}
          placeholder="https://yoursite.com/page"
          className="node-input"
        />
        {s.liveStyles ? (
          <div className="node-pill pill-green">
            ✓ {s.liveStyles.length} computed styles · {s.liveStylesUrl ? new URL(s.liveStylesUrl).hostname : "extension"}
            <button
              onClick={() => { /* cleared via shared */ (data.clearStyles as () => void)(); }}
              className="ml-auto text-[10px] underline opacity-60 hover:opacity-100"
            >
              Clear
            </button>
          </div>
        ) : (
          <div className="node-pill pill-gray">
            Open live site + Loupe extension auto-extracts styles
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Right} className="!bg-[#0ea5e9] !w-2.5 !h-2.5 !border-2 !border-white" />
    </div>
  );
}

// ── Node: PAT ────────────────────────────────────────────────────────────────

function PATNode({ data }: NodeProps) {
  const s = data.shared as SharedState;
  const [show, setShow] = useState(false);

  return (
    <div className="node-card w-[280px]">
      <div className="node-header">
        <KeyRound size={13} className="text-[#f59e0b]" />
        <span>Figma Token</span>
      </div>
      <div className="node-body">
        <div className="relative">
          <input
            type={show ? "text" : "password"}
            value={s.pat}
            onChange={e => s.setPat(e.target.value)}
            placeholder="figd_..."
            className="node-input font-mono pr-8"
          />
          <button
            type="button"
            onClick={() => setShow(p => !p)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#9a9aa5] hover:text-[#17171c]"
          >
            {show ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
        </div>
        <p className="text-[10px] text-[#9a9aa5] leading-[14px]">
          Needs file_comments:write scope. Stored only in your browser.
        </p>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-[#f59e0b] !w-2.5 !h-2.5 !border-2 !border-white" />
    </div>
  );
}

// ── Node: Compare (trigger) ───────────────────────────────────────────────────

function CompareNode({ data }: NodeProps) {
  const s = data.shared as SharedState;
  const canRun = !!(s.figmaUrl.trim() && s.liveUrl.trim() && s.pat.trim());
  const running = s.status === "running";

  return (
    <div className="node-card w-[220px]">
      <Handle type="target" position={Position.Left} className="!bg-[#18181b] !w-2.5 !h-2.5 !border-2 !border-white" />
      <div className="node-header">
        <ScanSearch size={13} className="text-[#18181b]" />
        <span>Compare</span>
        {s.status === "done"  && <CheckCircle2 size={12} className="ml-auto text-[#1a9457]" />}
        {s.status === "error" && <AlertCircle  size={12} className="ml-auto text-[#d4373e]" />}
      </div>
      <div className="node-body gap-2">
        {s.log.length > 0 && (
          <div className="rounded-md bg-[#f7f7f8] border border-[#e8e8ec] p-2 max-h-[120px] overflow-y-auto space-y-1">
            {s.log.map((l, i) => (
              <p key={i} className="text-[10px] text-[#5b5b66] leading-[14px]">{l}</p>
            ))}
          </div>
        )}
        <button
          onClick={s.run}
          disabled={!canRun || running}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#18181b] px-3 py-2 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-35"
        >
          {running ? (
            <><Loader2 size={11} className="animate-spin" />Running…</>
          ) : (
            <><Play size={11} />Run comparison</>
          )}
        </button>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-[#18181b] !w-2.5 !h-2.5 !border-2 !border-white" />
    </div>
  );
}

// ── Node: Results ─────────────────────────────────────────────────────────────

function ResultsNode({ data }: NodeProps) {
  const s = data.shared as SharedState;

  if (s.status === "idle") {
    return (
      <div className="node-card w-[380px] opacity-40">
        <Handle type="target" position={Position.Left} className="!bg-[#18181b] !w-2.5 !h-2.5 !border-2 !border-white" />
        <div className="node-header">
          <Zap size={13} className="text-[#9a9aa5]" />
          <span className="text-[#9a9aa5]">Results</span>
        </div>
        <div className="node-body">
          <p className="text-[11px] text-[#9a9aa5]">Results will appear here after comparison.</p>
        </div>
      </div>
    );
  }

  if (s.status === "running") {
    return (
      <div className="node-card w-[380px]">
        <Handle type="target" position={Position.Left} className="!bg-[#18181b] !w-2.5 !h-2.5 !border-2 !border-white" />
        <div className="node-header">
          <Loader2 size={13} className="animate-spin text-[#9a9aa5]" />
          <span>Results</span>
        </div>
        <div className="node-body">
          <p className="text-[11px] text-[#9a9aa5]">Analyzing…</p>
        </div>
      </div>
    );
  }

  if (s.status === "error") {
    const err = s.log[s.log.length - 1] ?? "An error occurred.";
    return (
      <div className="node-card w-[380px]">
        <Handle type="target" position={Position.Left} className="!bg-[#18181b] !w-2.5 !h-2.5 !border-2 !border-white" />
        <div className="node-header">
          <AlertCircle size={13} className="text-[#d4373e]" />
          <span>Error</span>
        </div>
        <div className="node-body">
          <p className="text-[11px] text-[#d4373e] leading-[16px]">{err}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="node-card w-[420px]">
      <Handle type="target" position={Position.Left} className="!bg-[#18181b] !w-2.5 !h-2.5 !border-2 !border-white" />
      <div className="node-header">
        <CheckCircle2 size={13} className="text-[#1a9457]" />
        <span>Results</span>
        <span className="ml-auto text-[10px] text-[#9a9aa5]">{s.results.length} discrepancies</span>
      </div>
      <div className="node-body">
        <p className="text-[11px] text-[#1a9457] leading-[15px]">{s.resultText}</p>
        {s.results.length > 0 && (
          <div className="rounded-lg border border-[#e8e8ec] overflow-hidden mt-1">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-[#e8e8ec] bg-[#f7f7f8]">
                  <th className="px-2.5 py-1.5 text-left font-medium text-[#9a9aa5]">Element</th>
                  <th className="px-2.5 py-1.5 text-left font-medium text-[#9a9aa5]">Issue</th>
                  <th className="px-2.5 py-1.5 text-left font-medium text-[#9a9aa5]">Comment</th>
                </tr>
              </thead>
              <tbody>
                {s.results.map((row, i) => (
                  <tr key={i} className="border-b border-[#f1f1f4] last:border-0">
                    <td className="px-2.5 py-1.5 text-[#17171c] font-medium max-w-[120px] truncate">{row.element}</td>
                    <td className="px-2.5 py-1.5 text-[#5b5b66] max-w-[160px]">{row.issue}</td>
                    <td className="px-2.5 py-1.5 font-mono text-[10px] text-[#9a9aa5]">{row.commentId ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Node type map ─────────────────────────────────────────────────────────────

const nodeTypes = {
  figmaFile: FigmaFileNode,
  liveSite:  LiveSiteNode,
  pat:       PATNode,
  compare:   CompareNode,
  results:   ResultsNode,
};

// ── Initial graph layout ──────────────────────────────────────────────────────

const INIT_NODES = [
  { id: "figma",   type: "figmaFile", position: { x: 60,  y: 60  }, data: {} },
  { id: "live",    type: "liveSite",  position: { x: 60,  y: 230 }, data: {} },
  { id: "pat",     type: "pat",       position: { x: 60,  y: 400 }, data: {} },
  { id: "compare", type: "compare",   position: { x: 420, y: 200 }, data: {} },
  { id: "results", type: "results",   position: { x: 720, y: 140 }, data: {} },
];

const INIT_EDGES = [
  { id: "e1", source: "figma",   target: "compare", animated: false, style: { stroke: "#6366f1", strokeWidth: 1.5 } },
  { id: "e2", source: "live",    target: "compare", animated: false, style: { stroke: "#0ea5e9", strokeWidth: 1.5 } },
  { id: "e3", source: "pat",     target: "compare", animated: false, style: { stroke: "#f59e0b", strokeWidth: 1.5 } },
  { id: "e4", source: "compare", target: "results", animated: false, style: { stroke: "#18181b", strokeWidth: 1.5 } },
];

// ── Canvas ────────────────────────────────────────────────────────────────────

function Canvas() {
  const [figmaUrl,     setFigmaUrlRaw]  = useState("");
  const [liveUrl,      setLiveUrlRaw]   = useState("");
  const [pat,          setPatRaw]       = useState("");
  const [liveStyles,   setLiveStyles]   = useState<any[] | null>(null);
  const [liveStylesUrl,setLiveStylesUrl]= useState("");
  const [status,       setStatus]       = useState<RunStatus>("idle");
  const [log,          setLog]          = useState<string[]>([]);
  const [results,      setResults]      = useState<DiscrepancyRow[]>([]);
  const [resultText,   setResultText]   = useState("");

  const liveStylesRef = useRef<any[] | null>(null);
  liveStylesRef.current = liveStyles;

  // Persist to localStorage
  const setFigmaUrl = useCallback((v: string) => {
    setFigmaUrlRaw(v); localStorage.setItem("loupe_figma_url", v);
  }, []);
  const setLiveUrl = useCallback((v: string) => {
    setLiveUrlRaw(v); localStorage.setItem("loupe_live_url", v);
  }, []);
  const setPat = useCallback((v: string) => {
    setPatRaw(v); localStorage.setItem("loupe_pat", v);
  }, []);

  // Load persisted values after hydration
  useEffect(() => {
    setFigmaUrlRaw(localStorage.getItem("loupe_figma_url") ?? "");
    setLiveUrlRaw(localStorage.getItem("loupe_live_url") ?? "");
    setPatRaw(localStorage.getItem("loupe_pat") ?? "");
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

  const addLog = useCallback((line: string) => {
    setLog(prev => [...prev, line]);
  }, []);

  const run = useCallback(async () => {
    const figmaUrlVal = localStorage.getItem("loupe_figma_url") ?? "";
    const liveUrlVal  = localStorage.getItem("loupe_live_url") ?? "";
    const patVal      = localStorage.getItem("loupe_pat") ?? "";

    if (!figmaUrlVal.trim() || !liveUrlVal.trim() || !patVal.trim()) return;

    setStatus("running");
    setLog([]);
    setResults([]);
    setResultText("");

    try {
      const fileKeyMatch = figmaUrlVal.match(/figma\.com\/(?:file|design)\/([A-Za-z0-9]+)/);
      const nodeIdMatch  = figmaUrlVal.match(/node-id=([^&]+)/);
      if (!fileKeyMatch) { addLog("Invalid Figma URL — could not extract file key."); setStatus("error"); return; }
      if (!nodeIdMatch)  { addLog("Figma URL must include node-id (right-click a frame → Copy link to selection)."); setStatus("error"); return; }

      const fileKey = fileKeyMatch[1];
      const nodeId  = decodeURIComponent(nodeIdMatch[1]).replace("-", ":");

      const cacheKey = `loupe_nodes_${fileKey}_${nodeId}`;
      const cached   = localStorage.getItem(cacheKey);
      let figmaNodes: any;
      let styleNameMap: Record<string, string> = {};

      if (cached) {
        const parsed = JSON.parse(cached);
        figmaNodes   = parsed.figmaNodes;
        styleNameMap = parsed.styleNameMap ?? {};
        addLog("Figma nodes loaded from cache.");
      } else {
        addLog("Fetching Figma node tree…");
        const figmaRes = await fetch(
          `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}&depth=10`,
          { headers: { "X-Figma-Token": patVal.trim() } },
        );
        if (!figmaRes.ok) {
          const txt = await figmaRes.text();
          addLog(`Figma API error ${figmaRes.status}: ${txt.slice(0, 200)}`);
          setStatus("error");
          return;
        }
        figmaNodes = await figmaRes.json();

        const rootDoc  = figmaNodes?.nodes?.[nodeId]?.document;
        const styleIds = extractStyleIds(rootDoc);
        if (styleIds.length) {
          addLog(`Resolving ${styleIds.length} named styles…`);
          const stylesRes = await fetch(
            `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${styleIds.map(encodeURIComponent).join(",")}`,
            { headers: { "X-Figma-Token": patVal.trim() } },
          );
          if (stylesRes.ok) {
            const stylesData = await stylesRes.json() as { nodes: Record<string, { document: any }> };
            for (const [id, node] of Object.entries(stylesData.nodes ?? {})) {
              if ((node as any)?.document?.name) styleNameMap[id] = (node as any).document.name;
            }
          }
        }
        localStorage.setItem(cacheKey, JSON.stringify({ figmaNodes, styleNameMap }));
        addLog("Figma nodes fetched and cached.");
      }

      addLog("Running AI comparison…");

      const res = await fetch("/api/agents/figma-compare", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          figmaNodes, styleNameMap, fileKey, nodeId,
          liveUrl:    liveUrlVal.trim(),
          liveStyles: liveStylesRef.current ?? null,
          pat:        patVal.trim(),
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
            if (data.type === "step")  addLog(data.text);
            if (data.type === "error") { addLog(data.text); setStatus("error"); }
            if (data.type === "result") {
              setResultText(data.text);
              setResults(data.table ?? []);
              setStatus("done");
            }
          } catch {}
        }
      }

      setStatus(prev => prev === "running" ? "done" : prev);
    } catch (err) {
      addLog(`Connection error: ${String(err)}`);
      setStatus("error");
    }
  }, [addLog]);

  const clearStyles = useCallback(() => {
    setLiveStyles(null);
    setLiveStylesUrl("");
  }, []);

  const shared: SharedState = {
    figmaUrl, setFigmaUrl,
    liveUrl,  setLiveUrl,
    pat,      setPat,
    liveStyles, liveStylesUrl,
    status, log, results, resultText,
    run,
  };

  const [nodes, , onNodesChange] = useNodesState(
    INIT_NODES.map(n => ({
      ...n,
      data: { shared, clearStyles },
    }))
  );
  const [edges, , onEdgesChange] = useEdgesState(INIT_EDGES);

  // Keep node data fresh without recreating nodes
  const updatedNodes = nodes.map(n => ({
    ...n,
    data: { shared, clearStyles },
  }));

  return (
    <div className="h-screen w-full bg-[#fafafa]">
      <style>{`
        .node-card {
          background: white;
          border: 1px solid #e8e8ec;
          border-radius: 12px;
          box-shadow: 0 1px 4px rgba(0,0,0,0.06), 0 0 0 0 transparent;
          transition: box-shadow 0.15s;
          overflow: hidden;
        }
        .node-card:hover {
          box-shadow: 0 4px 16px rgba(0,0,0,0.08);
        }
        .node-header {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 12px;
          border-bottom: 1px solid #f1f1f4;
          font-size: 11px;
          font-weight: 600;
          color: #17171c;
          letter-spacing: 0.01em;
          background: #fafafa;
        }
        .node-body {
          padding: 10px 12px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .node-input {
          width: 100%;
          border: 1px solid #e8e8ec;
          border-radius: 8px;
          background: #fafafa;
          padding: 6px 10px;
          font-size: 11px;
          color: #17171c;
          outline: none;
          transition: border-color 0.15s;
        }
        .node-input:focus {
          border-color: #18181b;
          background: white;
        }
        .node-input::placeholder { color: #9a9aa5; }
        .node-pill {
          display: flex;
          align-items: center;
          gap: 4px;
          border-radius: 6px;
          padding: 4px 8px;
          font-size: 10px;
          line-height: 14px;
        }
        .pill-green { background: #e8f6ee; color: #1a9457; border: 1px solid #1a945730; }
        .pill-red   { background: #fdf2f2; color: #d4373e; border: 1px solid #d4373e30; }
        .pill-gray  { background: #f7f7f8; color: #5b5b66; border: 1px solid #e8e8ec; }
        .react-flow__node { cursor: default; }
        .react-flow__handle { cursor: crosshair; }
        .react-flow__edge-path { cursor: default; }
      `}</style>
      <ReactFlow
        nodes={updatedNodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.4}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#e8e8ec" gap={20} size={1} />
      </ReactFlow>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function FigmaComparePage() {
  return (
    <ReactFlowProvider>
      <Canvas />
    </ReactFlowProvider>
  );
}
