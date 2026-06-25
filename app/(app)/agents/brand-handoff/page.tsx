"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Play, Loader2, ChevronRight, AlertCircle, CheckCircle2,
  Copy, Check, Palette,
} from "lucide-react";

interface StepMessage { id: string; type: "step" | "error"; text: string; }
interface BrandIssue  { category: string; severity: "high" | "medium" | "low"; issue: string; fix: string; }
interface PaletteColor { hex: string; role: string; usage: string; }
interface TypographyRow { size: number; weight: number; family: string; role: string; css_class: string; }
interface Metrics { fontFamilies: string[]; fontSizes: number[]; fontWeights: number[]; colorCount: number; borderRadii: number[]; }

interface Result {
  frameName: string;
  syncedAt: string;
  metrics: Metrics;
  brandIssues: BrandIssue[];
  palette: PaletteColor[];
  typographyScale: TypographyRow[];
  cssTokens: string;
  handoffSummary: string;
}

function SeverityBadge({ severity }: { severity: BrandIssue["severity"] }) {
  const map = {
    high:   "bg-red-50 text-red-600 border-red-200",
    medium: "bg-amber-50 text-amber-600 border-amber-200",
    low:    "bg-blue-50 text-blue-600 border-blue-200",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold border ${map[severity]}`}>
      {severity}
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <button onClick={copy} className="flex items-center gap-1.5 rounded-lg border border-black/[0.1] bg-white px-3 py-1.5 text-[12px] font-medium text-[#374151] hover:bg-black/[0.03] transition-colors">
      {copied ? <><Check className="h-3.5 w-3.5 text-emerald-500" /> Copied</> : <><Copy className="h-3.5 w-3.5" /> Copy CSS</>}
    </button>
  );
}

function parseFigmaUrl(url: string) {
  const fileKeyMatch = url.match(/figma\.com\/(?:file|design)\/([A-Za-z0-9]+)/);
  const nodeIdMatch  = url.match(/node-id=([^&]+)/);
  if (!fileKeyMatch || !nodeIdMatch) return null;
  return { fileKey: fileKeyMatch[1], nodeId: decodeURIComponent(nodeIdMatch[1]).replace("-", ":") };
}

export default function BrandHandoffPage() {
  const [figmaUrl, setFigmaUrlRaw] = useState("");
  const [running,  setRunning]     = useState(false);
  const [steps,    setSteps]       = useState<StepMessage[]>([]);
  const [result,   setResult]      = useState<Result | null>(null);
  const [tab,      setTab]         = useState<"brand" | "handoff">("brand");

  const guardRef  = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const setFigmaUrl = useCallback((v: string) => {
    setFigmaUrlRaw(v);
    localStorage.setItem("loupe_figma_url", v);
  }, []);

  useEffect(() => {
    setFigmaUrlRaw(localStorage.getItem("loupe_figma_url") ?? "");
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [steps]);

  function addStep(type: "step" | "error", text: string) {
    setSteps(prev => [...prev, { id: crypto.randomUUID(), type, text }]);
  }

  async function run() {
    if (guardRef.current) return;
    const parsed = parseFigmaUrl(figmaUrl.trim());
    if (!parsed) {
      addStep("error", "Paste a valid Figma frame URL (with node-id) to continue.");
      return;
    }

    guardRef.current = true;
    setRunning(true);
    setSteps([]);
    setResult(null);

    try {
      const res = await fetch("/api/agents/brand-handoff", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ fileKey: parsed.fileKey, nodeId: parsed.nodeId }),
      });

      if (!res.ok || !res.body) { addStep("error", `Request failed (${res.status})`); return; }

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let   buffer  = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data:")) continue;
          try {
            const data = JSON.parse(line.slice(5).trim());
            if (data.type === "step")   addStep("step",  data.text);
            if (data.type === "error")  addStep("error", data.text);
            if (data.type === "result") setResult(data as Result);
          } catch {}
        }
      }
    } catch (e) {
      addStep("error", `Connection error: ${String(e)}`);
    } finally {
      setRunning(false);
      guardRef.current = false;
    }
  }

  const highIssues = result?.brandIssues.filter(i => i.severity === "high").length ?? 0;

  return (
    <div className="min-h-screen bg-white text-[#0f0f0f] font-sans">
      <div className="mx-auto max-w-3xl px-6 py-10 space-y-6">

        {/* Header */}
        <div className="flex items-center gap-3 pb-2 border-b border-black/[0.06]">
          <Palette className="h-5 w-5 text-[#0f0f0f]" strokeWidth={1.75} />
          <div>
            <h1 className="text-[15px] font-semibold tracking-tight">Brand &amp; Handoff</h1>
            <p className="text-[12px] text-[#9ca3af] mt-0.5">
              Check brand consistency and generate CSS tokens for dev handoff.
            </p>
          </div>
        </div>

        {/* Config */}
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-[#9ca3af]">Figma Frame URL</label>
            <input
              value={figmaUrl}
              onChange={e => setFigmaUrl(e.target.value)}
              placeholder="https://www.figma.com/design/...?node-id=..."
              className="w-full rounded-xl border border-black/[0.1] bg-white px-3.5 py-2.5 text-sm placeholder:text-[#c4c4cc] focus:outline-none focus:border-black/30 transition-colors"
            />
            <p className="text-[11px] text-[#9ca3af]">Requires a synced snapshot — run "Sync Design" on Figma vs Live first.</p>
          </div>
          <button
            onClick={run}
            disabled={running}
            className="flex items-center gap-2 rounded-xl bg-[#0f0f0f] hover:bg-[#2a2a2a] disabled:opacity-40 px-5 py-2.5 text-sm font-medium text-white transition-colors"
          >
            {running
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Analyzing…</>
              : <><Play className="h-4 w-4" /> Analyze</>
            }
          </button>
        </div>

        {/* Step log */}
        {steps.length > 0 && (
          <div className="rounded-xl border border-black/[0.08] bg-[#fafafa] p-4 space-y-2">
            {steps.map(s => (
              <div key={s.id} className="flex items-start gap-2 text-sm">
                {s.type === "error"
                  ? <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                  : <ChevronRight className="h-4 w-4 text-[#9ca3af] mt-0.5 shrink-0" />
                }
                <span className={s.type === "error" ? "text-red-600" : "text-[#374151]"}>{s.text}</span>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="space-y-5">
            {/* Summary row */}
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="text-[13px] text-[#6b7280]">
                Frame: <span className="font-medium text-[#0f0f0f]">{result.frameName}</span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {highIssues > 0 && (
                  <span className="flex items-center gap-1 text-[12px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1">
                    <AlertCircle className="h-3.5 w-3.5" /> {highIssues} critical
                  </span>
                )}
                <span className="text-[12px] text-[#9ca3af] bg-[#f5f5f5] border border-black/[0.06] rounded-lg px-2.5 py-1">
                  {result.metrics.fontFamilies.length} font{result.metrics.fontFamilies.length !== 1 ? "s" : ""}
                </span>
                <span className="text-[12px] text-[#9ca3af] bg-[#f5f5f5] border border-black/[0.06] rounded-lg px-2.5 py-1">
                  {result.metrics.colorCount} colors
                </span>
                <span className="text-[12px] text-[#9ca3af] bg-[#f5f5f5] border border-black/[0.06] rounded-lg px-2.5 py-1">
                  {result.metrics.fontSizes.length} sizes
                </span>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 border-b border-black/[0.06]">
              {(["brand", "handoff"] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-4 py-2 text-[13px] font-medium border-b-2 -mb-px transition-colors ${
                    tab === t
                      ? "border-[#0f0f0f] text-[#0f0f0f]"
                      : "border-transparent text-[#9ca3af] hover:text-[#6b7280]"
                  }`}
                >
                  {t === "brand" ? "Brand Check" : "Dev Handoff"}
                </button>
              ))}
            </div>

            {/* Brand Check tab */}
            {tab === "brand" && (
              <div className="space-y-5">

                {/* Issues */}
                {result.brandIssues.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-[#9ca3af]">Issues</p>
                    {result.brandIssues.map((issue, i) => (
                      <div key={i} className="rounded-xl border border-black/[0.08] p-4 space-y-1.5">
                        <div className="flex items-center gap-2">
                          <SeverityBadge severity={issue.severity} />
                          <span className="text-[12px] text-[#9ca3af] capitalize">{issue.category}</span>
                        </div>
                        <p className="text-[13px] text-[#0f0f0f] font-medium">{issue.issue}</p>
                        <p className="text-[12px] text-[#6b7280]">Fix: {issue.fix}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-emerald-600 text-sm">
                    <CheckCircle2 className="h-4 w-4" /> No brand issues found.
                  </div>
                )}

                {/* Color palette */}
                {result.palette.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-[#9ca3af]">Color Palette</p>
                    <div className="flex flex-wrap gap-3">
                      {result.palette.map((c, i) => (
                        <div key={i} className="flex items-center gap-2.5 rounded-xl border border-black/[0.08] px-3 py-2.5">
                          <div
                            className="h-7 w-7 rounded-lg border border-black/[0.08] shrink-0"
                            style={{ backgroundColor: c.hex }}
                          />
                          <div>
                            <p className="text-[12px] font-mono font-medium text-[#0f0f0f]">{c.hex}</p>
                            <p className="text-[11px] text-[#9ca3af] capitalize">{c.role} · {c.usage}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Typography scale */}
                {result.typographyScale.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-[#9ca3af]">Typography Scale</p>
                    <div className="rounded-xl border border-black/[0.08] overflow-hidden">
                      <div className="grid grid-cols-[60px_60px_1fr_1fr] gap-3 px-4 py-2.5 bg-[#fafafa] border-b border-black/[0.06] text-[11px] font-semibold uppercase tracking-wide text-[#9ca3af]">
                        <span>Size</span><span>Weight</span><span>Family</span><span>Role</span>
                      </div>
                      {result.typographyScale.map((row, i) => (
                        <div key={i} className="grid grid-cols-[60px_60px_1fr_1fr] gap-3 px-4 py-2.5 border-b border-black/[0.04] last:border-0 text-[13px]">
                          <span className="font-mono text-[#0f0f0f]">{row.size}px</span>
                          <span className="text-[#6b7280]">{row.weight}</span>
                          <span className="text-[#374151] truncate">{row.family}</span>
                          <span className="text-[#9ca3af] capitalize">{row.role}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Dev Handoff tab */}
            {tab === "handoff" && (
              <div className="space-y-5">

                {/* Summary */}
                {result.handoffSummary && (
                  <div className="rounded-xl border border-black/[0.08] bg-[#fafafa] px-4 py-3">
                    <p className="text-[13px] text-[#374151] leading-relaxed">{result.handoffSummary}</p>
                  </div>
                )}

                {/* CSS tokens */}
                {result.cssTokens && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-[#9ca3af]">CSS Custom Properties</p>
                      <CopyButton text={result.cssTokens} />
                    </div>
                    <pre className="rounded-xl border border-black/[0.08] bg-[#0f0f0f] text-[#e2e2e9] p-4 text-[12px] font-mono leading-relaxed overflow-x-auto whitespace-pre-wrap">
                      {result.cssTokens}
                    </pre>
                  </div>
                )}

                {/* Metrics reference */}
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[#9ca3af]">Quick Reference</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl border border-black/[0.08] p-4">
                      <p className="text-[11px] text-[#9ca3af] mb-2">Font families</p>
                      {result.metrics.fontFamilies.map((f, i) => (
                        <p key={i} className="text-[13px] font-medium text-[#0f0f0f]">{f}</p>
                      ))}
                    </div>
                    <div className="rounded-xl border border-black/[0.08] p-4">
                      <p className="text-[11px] text-[#9ca3af] mb-2">Font weights</p>
                      <p className="text-[13px] font-medium text-[#0f0f0f]">{result.metrics.fontWeights.join(", ")}</p>
                    </div>
                    <div className="rounded-xl border border-black/[0.08] p-4">
                      <p className="text-[11px] text-[#9ca3af] mb-2">Font sizes</p>
                      <p className="text-[13px] font-medium text-[#0f0f0f]">{result.metrics.fontSizes.slice(0, 8).join(", ")}px</p>
                    </div>
                    {result.metrics.borderRadii.length > 0 && (
                      <div className="rounded-xl border border-black/[0.08] p-4">
                        <p className="text-[11px] text-[#9ca3af] mb-2">Border radii</p>
                        <p className="text-[13px] font-medium text-[#0f0f0f]">{result.metrics.borderRadii.join(", ")}px</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Empty state */}
        {!running && steps.length === 0 && !result && (
          <div className="flex flex-col items-center justify-center py-20 text-center space-y-3">
            <div className="h-12 w-12 rounded-full bg-black/[0.04] flex items-center justify-center">
              <Palette className="h-5 w-5 text-[#9ca3af]" strokeWidth={1.5} />
            </div>
            <p className="text-sm text-[#9ca3af] max-w-xs leading-relaxed">
              Paste a Figma frame URL and click Analyze. Reads from your existing snapshot — no Figma API calls.
            </p>
          </div>
        )}

      </div>
    </div>
  );
}
