"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ExternalLink,
  Loader2,
  MonitorCheck,
  MousePointerClick,
  PanelTop,
  Play,
  Ruler,
  Smartphone,
  Tablet,
  Monitor,
  TextCursorInput,
} from "lucide-react";

type ViewportName = "mobile" | "tablet" | "desktop";

interface ResponsiveIssue {
  id: string;
  viewport: ViewportName | "static";
  type: string;
  severity: "high" | "medium" | "low";
  element: string;
  selector?: string;
  details: string;
  metrics?: Record<string, number | string | boolean | null>;
}

interface ResponsiveResult {
  url: string;
  checkedAt: string;
  mode: "browser" | "static_fallback";
  scannerStatus?: ScannerStatus;
  issues: ResponsiveIssue[];
}

type ScannerStatus = "ready" | "not_configured" | "missing_endpoint" | "unreachable";

const VIEWPORTS: Array<{ id: ViewportName; label: string; icon: typeof Smartphone }> = [
  { id: "mobile", label: "Mobile", icon: Smartphone },
  { id: "tablet", label: "Tablet", icon: Tablet },
  { id: "desktop", label: "Desktop", icon: Monitor },
];

const CHECK_GROUPS = [
  {
    icon: Ruler,
    title: "Fit",
    text: "Page width, oversized sections, and elements drifting outside the viewport.",
  },
  {
    icon: TextCursorInput,
    title: "Text",
    text: "Clipped labels, long URLs, and copy that cannot wrap cleanly.",
  },
  {
    icon: PanelTop,
    title: "Overlays",
    text: "Sticky headers, drawers, and modals that cover or exceed the screen.",
  },
  {
    icon: MousePointerClick,
    title: "Touch",
    text: "Small links and buttons that are hard to tap on mobile.",
  },
];

const SCAN_STEPS = [
  "Open URL",
  "Resize viewports",
  "Measure elements",
  "Report issues",
];

const TYPE_LABELS: Record<string, string> = {
  horizontal_overflow: "Horizontal overflow",
  element_wider_than_viewport: "Too wide",
  element_outside_viewport: "Outside viewport",
  clipped_text: "Clipped text",
  sticky_covering_content: "Sticky overlap",
  oversized_modal: "Oversized modal",
  small_tap_target: "Small target",
  long_unbroken_text: "Long text",
  viewport_meta: "Viewport meta",
  fixed_or_sticky: "Fixed/sticky",
};

function modeLabel(mode: ResponsiveResult["mode"]) {
  return mode === "browser" ? "Browser scan" : "HTML preview";
}

function modeDescription(mode: ResponsiveResult["mode"]) {
  return mode === "browser"
    ? "Loupe opened the page at each selected viewport and measured real element boxes."
    : "The browser scanner is not connected in this local preview. Loupe can only check simple HTML signals here, not actual element positions.";
}

function scannerStatusCopy(status: ScannerStatus | null) {
  if (status === "missing_endpoint") {
    return {
      title: "Browser scanner needs an update",
      text: "The app can reach the scraper service, but that service does not have the responsive scan endpoint yet. Deploy the scraper service to run real viewport measurements.",
    };
  }
  if (status === "unreachable") {
    return {
      title: "Browser scanner unreachable",
      text: "Loupe could not reach the scraper service. HTML preview still works, but mobile, tablet, and desktop measurements need the scanner online.",
    };
  }
  return {
    title: "Browser scanner not connected",
    text: "Loupe can only preview simple HTML signals until the scraper service URL is configured.",
  };
}

const SEVERITY_CLASS = {
  high: "border-red-200 bg-red-50 text-red-600",
  medium: "border-amber-200 bg-amber-50 text-amber-700",
  low: "border-blue-200 bg-blue-50 text-blue-600",
};

function formatType(type: string) {
  return TYPE_LABELS[type] ?? type.replace(/_/g, " ");
}

function metricSummary(metrics?: ResponsiveIssue["metrics"]) {
  if (!metrics) return "";
  return Object.entries(metrics)
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${value}`)
    .join(" · ");
}

export default function ResponsiveAgentPage() {
  const [url, setUrl] = useState("");
  const [selected, setSelected] = useState<Set<ViewportName>>(new Set<ViewportName>(["mobile", "tablet", "desktop"]));
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResponsiveResult | null>(null);
  const [browserScannerConnected, setBrowserScannerConnected] = useState<boolean | null>(null);
  const [scannerStatus, setScannerStatus] = useState<ScannerStatus | null>(null);

  const canRun = url.trim().startsWith("http") && selected.size > 0 && !running;

  const counts = useMemo(() => {
    const issues = result?.issues ?? [];
    return {
      total: issues.length,
      high: issues.filter(i => i.severity === "high").length,
      medium: issues.filter(i => i.severity === "medium").length,
      low: issues.filter(i => i.severity === "low").length,
    };
  }, [result]);

  useEffect(() => {
    fetch("/api/agents/responsive")
      .then(res => res.json())
      .then(data => {
        setBrowserScannerConnected(Boolean(data.browserScannerConnected));
        setScannerStatus(data.scannerStatus ?? "not_configured");
      })
      .catch(() => {
        setBrowserScannerConnected(false);
        setScannerStatus("unreachable");
      });
  }, []);

  const issuesByType = useMemo(() => {
    const grouped = new Map<string, number>();
    for (const issue of result?.issues ?? []) {
      grouped.set(issue.type, (grouped.get(issue.type) ?? 0) + 1);
    }
    return Array.from(grouped.entries()).sort((a, b) => b[1] - a[1]);
  }, [result]);

  function toggleViewport(id: ViewportName) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function run() {
    if (!canRun) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/agents/responsive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), viewports: Array.from(selected) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-white text-[#0f0f0f]">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="mb-5 flex items-center justify-between gap-4 border-b border-black/[0.06] pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-black/[0.04]">
              <MonitorCheck size={17} strokeWidth={1.8} />
            </div>
            <div>
              <h1 className="text-[17px] font-semibold">Responsive Layout Check</h1>
              <p className="mt-0.5 text-[12px] text-[#71717a]">Preview whether a live page survives mobile, tablet, and desktop widths.</p>
            </div>
          </div>
          {result?.url && (
            <a href={result.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[12px] text-[#71717a] hover:text-[#0f0f0f]">
              Open page <ExternalLink size={12} />
            </a>
          )}
        </div>

        <div className="mb-5 grid gap-3 lg:grid-cols-[1fr_1fr]">
          <div className="rounded-xl border border-black/[0.08] bg-[#fafafa] p-4">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-[#71717a]">Scan flow</p>
            <div className="grid grid-cols-4 gap-2">
              {SCAN_STEPS.map((step, index) => (
                <div key={step} className="relative rounded-lg bg-white px-3 py-3">
                  <div className="mb-2 flex h-5 w-5 items-center justify-center rounded-full bg-[#0f0f0f] text-[10px] font-semibold text-white">
                    {index + 1}
                  </div>
                  <p className="text-[11px] font-medium leading-tight text-[#17171c]">{step}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-black/[0.08] bg-white p-4">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-[#71717a]">What gets checked</p>
            <div className="grid grid-cols-2 gap-2">
              {CHECK_GROUPS.map(group => {
                const Icon = group.icon;
                return (
                  <div key={group.title} className="rounded-lg border border-black/[0.06] px-3 py-2.5">
                    <div className="mb-1.5 flex items-center gap-2">
                      <Icon size={13} className="text-[#4b5563]" />
                      <p className="text-[12px] font-semibold text-[#17171c]">{group.title}</p>
                    </div>
                    <p className="text-[11px] leading-snug text-[#71717a]">{group.text}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          <section className="space-y-4">
            <div className="rounded-xl border border-black/[0.08] bg-white p-4">
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-[#71717a]">Live URL</label>
              <div className="flex gap-2">
                <input
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && canRun && run()}
                  placeholder="https://example.com"
                  className="min-w-0 flex-1 rounded-lg border border-black/[0.12] px-3 py-2 text-[13px] outline-none transition-colors placeholder:text-[#a1a1aa] focus:border-black/40"
                />
                <button
                  onClick={run}
                  disabled={!canRun}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#0f0f0f] px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-[#1f1f23] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                  {browserScannerConnected ? "Run browser scan" : "Preview HTML"}
                </button>
              </div>
            </div>

            {browserScannerConnected === false && !result && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="text-[12px] font-medium text-amber-800">{scannerStatusCopy(scannerStatus).title}</p>
                <p className="mt-0.5 text-[12px] leading-relaxed text-amber-700">{scannerStatusCopy(scannerStatus).text}</p>
              </div>
            )}

            <div className="rounded-xl border border-black/[0.08] bg-white p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[#71717a]">Viewports to simulate</p>
                <p className="text-[11px] text-[#a1a1aa]">{selected.size}/3 selected</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                {VIEWPORTS.map(v => {
                  const Icon = v.icon;
                  const active = selected.has(v.id);
                  return (
                    <button
                      key={v.id}
                      onClick={() => toggleViewport(v.id)}
                      className={`flex min-h-[76px] flex-col items-start justify-between rounded-lg border px-3 py-2.5 text-left transition-colors ${
                        active
                          ? "border-[#0f0f0f] bg-[#0f0f0f] text-white"
                          : "border-black/[0.1] text-[#4b5563] hover:border-black/40 hover:text-[#0f0f0f]"
                      }`}
                    >
                      <span className="flex w-full items-center justify-between">
                        <Icon size={15} />
                        {active && <Check size={13} />}
                      </span>
                      <span>
                        <span className="block text-[13px] font-semibold">{v.label}</span>
                        <span className={`block text-[11px] ${active ? "text-white/70" : "text-[#a1a1aa]"}`}>
                          {v.id === "mobile" ? "390px wide" : v.id === "tablet" ? "768px wide" : "1440px wide"}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-3 rounded-xl border border-red-100 bg-red-50 px-4 py-3">
                <AlertCircle size={15} className="mt-0.5 shrink-0 text-red-500" />
                <p className="text-[13px] text-red-600">{error}</p>
              </div>
            )}

            {result && counts.total === 0 && result.mode === "browser" && (
              <div className="flex items-start gap-3 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3">
                <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-600" />
                <div>
                  <p className="text-[13px] font-medium text-emerald-800">No responsive layout issues found.</p>
                  <p className="mt-0.5 text-[12px] text-emerald-700">Checked {Array.from(selected).join(", ")} using {modeLabel(result.mode)}.</p>
                </div>
              </div>
            )}

            {result && counts.total === 0 && result.mode === "static_fallback" && (
              <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <AlertCircle size={15} className="mt-0.5 shrink-0 text-amber-600" />
                <div>
                  <p className="text-[13px] font-medium text-amber-800">{scannerStatusCopy(result.scannerStatus ?? scannerStatus).title}</p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-amber-700">{scannerStatusCopy(result.scannerStatus ?? scannerStatus).text}</p>
                </div>
              </div>
            )}

            {result && counts.total > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[12px] font-semibold text-[#17171c]">Findings</p>
                  <p className="text-[11px] text-[#71717a]">{modeLabel(result.mode)}</p>
                </div>
                {result.mode === "static_fallback" && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                    <p className="text-[12px] font-medium text-amber-800">{scannerStatusCopy(result.scannerStatus ?? scannerStatus).title}</p>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-amber-700">
                      Showing HTML preview hints only. {scannerStatusCopy(result.scannerStatus ?? scannerStatus).text}
                    </p>
                  </div>
                )}
                {result.issues.map(issue => (
                  <div key={issue.id} className="rounded-xl border border-black/[0.08] bg-white p-4">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize ${SEVERITY_CLASS[issue.severity]}`}>
                        {issue.severity}
                      </span>
                      <span className="rounded-full bg-[#f5f5f7] px-2 py-0.5 text-[10px] font-medium capitalize text-[#4b5563]">
                        {issue.viewport === "static" ? "HTML preview" : issue.viewport}
                      </span>
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-[#71717a]">{formatType(issue.type)}</span>
                    </div>
                    <p className="text-[13px] font-medium text-[#17171c]">{issue.element}</p>
                    <p className="mt-1 text-[12px] leading-relaxed text-[#4b5563]">{issue.details}</p>
                    {issue.selector && <p className="mt-2 truncate font-mono text-[10px] text-[#a1a1aa]">{issue.selector}</p>}
                    {metricSummary(issue.metrics) && (
                      <p className="mt-2 text-[11px] text-[#71717a]">{metricSummary(issue.metrics)}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <aside className="h-fit rounded-xl border border-black/[0.08] bg-[#fafafa] p-4">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-[#71717a]">Summary</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-white p-3">
                <p className="text-[22px] font-semibold leading-none">{counts.total}</p>
                <p className="mt-1 text-[11px] text-[#71717a]">{result?.mode === "static_fallback" ? "HTML hints" : "Issues"}</p>
              </div>
              <div className="rounded-lg bg-white p-3">
                <p className="text-[22px] font-semibold leading-none">{counts.high}</p>
                <p className="mt-1 text-[11px] text-[#71717a]">High</p>
              </div>
              <div className="rounded-lg bg-white p-3">
                <p className="text-[22px] font-semibold leading-none">{counts.medium}</p>
                <p className="mt-1 text-[11px] text-[#71717a]">Medium</p>
              </div>
              <div className="rounded-lg bg-white p-3">
                <p className="text-[22px] font-semibold leading-none">{counts.low}</p>
                <p className="mt-1 text-[11px] text-[#71717a]">Low</p>
              </div>
            </div>
            <div className="mt-4 border-t border-black/[0.06] pt-3">
              <p className="text-[11px] text-[#71717a]">
                {result
                  ? `Mode: ${modeLabel(result.mode)}`
                  : browserScannerConnected === false
                    ? "HTML preview only until the browser scanner is connected."
                    : "Checks mobile, tablet, and desktop fit."}
              </p>
              {result && <p className="mt-1.5 text-[11px] leading-relaxed text-[#71717a]">{modeDescription(result.mode)}</p>}
            </div>
            {result && issuesByType.length > 0 && (
              <div className="mt-4 border-t border-black/[0.06] pt-3">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#71717a]">Top issue types</p>
                <div className="space-y-1.5">
                  {issuesByType.slice(0, 5).map(([type, count]) => (
                    <div key={type} className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="truncate text-[#4b5563]">{formatType(type)}</span>
                      <span className="rounded-full bg-white px-2 py-0.5 font-medium text-[#17171c]">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {!result && (
              <div className="mt-4 border-t border-black/[0.06] pt-3">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#71717a]">Output</p>
                <div className="space-y-2 text-[11px] text-[#71717a]">
                  <p>Each finding names the viewport, element, problem, and measured dimensions when available.</p>
                  <p>Browser scan is exact. HTML preview is a lighter local signal.</p>
                </div>
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
