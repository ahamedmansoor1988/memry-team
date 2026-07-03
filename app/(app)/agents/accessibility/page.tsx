"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Accessibility,
  AlertCircle,
  CheckCircle2,
  Contrast,
  ExternalLink,
  Heading1,
  Keyboard,
  Loader2,
  MousePointerClick,
  Play,
  Share2,
  Tags,
} from "lucide-react";
import { qaScore } from "@/lib/qa-score";
import { AnnotatedScreenshot, ScoreBadge, type Screenshot } from "@/components/qa-report";

interface A11yIssue {
  id: string;
  type: string;
  severity: "high" | "medium" | "low";
  element: string;
  selector?: string;
  details: string;
  metrics?: Record<string, number | string | boolean | null>;
}

interface A11yResult {
  url: string;
  checkedAt: string;
  mode: "browser" | "static_fallback";
  scannerStatus?: ScannerStatus;
  issues: A11yIssue[];
  truncatedTypes?: Array<{ type: string; total: number; shown: number }>;
  screenshot?: Screenshot;
}

type ScannerStatus = "ready" | "not_configured" | "missing_endpoint" | "unreachable";

const CATEGORIES: Array<{ id: string; label: string; icon: typeof Contrast; types: string[] }> = [
  { id: "contrast", label: "Contrast", icon: Contrast, types: ["low_contrast"] },
  { id: "labels", label: "Labels & alt text", icon: Tags, types: ["missing_alt", "unlabeled_control", "input_missing_label"] },
  { id: "headings", label: "Headings", icon: Heading1, types: ["missing_h1", "multiple_h1", "heading_order_skip"] },
  { id: "focus", label: "Focus & ARIA", icon: Keyboard, types: ["missing_focus_style", "invalid_role", "aria_hidden_focusable", "broken_labelledby"] },
  { id: "touch", label: "Touch targets", icon: MousePointerClick, types: ["small_tap_target"] },
];

const TYPE_LABELS: Record<string, string> = {
  low_contrast: "Low contrast",
  missing_alt: "Missing alt text",
  unlabeled_control: "Unlabeled control",
  input_missing_label: "Input without label",
  missing_h1: "Missing H1",
  multiple_h1: "Multiple H1",
  heading_order_skip: "Heading order",
  missing_focus_style: "No focus style",
  invalid_role: "Invalid ARIA role",
  aria_hidden_focusable: "Focusable but hidden",
  broken_labelledby: "Broken aria-labelledby",
  small_tap_target: "Small tap target",
};

const WHY_COPY: Record<string, string> = {
  low_contrast: "Low-vision users may not be able to read this text.",
  missing_alt: "Screen readers announce the file name or nothing at all.",
  unlabeled_control: "Screen reader users hear \"button\" with no idea what it does.",
  input_missing_label: "Users cannot tell what this field is for, and placeholders vanish on typing.",
  missing_h1: "Screen reader users rely on the H1 to know what the page is about.",
  multiple_h1: "Multiple H1s muddy the document outline for assistive tech.",
  heading_order_skip: "Skipped heading levels break outline navigation for screen readers.",
  missing_focus_style: "Keyboard users cannot see which element they are on.",
  invalid_role: "Assistive technology ignores roles it does not recognize.",
  aria_hidden_focusable: "Keyboard reaches this element but screen readers stay silent on it.",
  broken_labelledby: "The referenced label does not exist, so the element has no name.",
  small_tap_target: "Targets under 24px are hard to hit for users with motor impairments.",
};

const SEVERITY_CLASS = {
  high: "border-red-200 bg-red-50 text-red-600",
  medium: "border-amber-200 bg-amber-50 text-amber-700",
  low: "border-blue-200 bg-blue-50 text-blue-600",
};

const SCAN_STEPS = ["Open URL", "Render page", "Run WCAG checks", "Report issues"];

function formatType(type: string) {
  return TYPE_LABELS[type] ?? type.replace(/_/g, " ");
}

function categoryOf(type: string) {
  return CATEGORIES.find(c => c.types.includes(type));
}

function modeLabel(mode: A11yResult["mode"]) {
  return mode === "browser" ? "Browser scan" : "HTML preview";
}

function scannerStatusCopy(status: ScannerStatus | null) {
  if (status === "missing_endpoint") {
    return {
      title: "Browser scanner needs an update",
      text: "The app can reach the scraper service, but it does not have the accessibility endpoint yet. Deploy the scraper service to run real checks.",
    };
  }
  if (status === "unreachable") {
    return {
      title: "Browser scanner unreachable",
      text: "Loupe could not reach the scraper service. HTML preview still works, but contrast, focus, and label checks need the scanner online.",
    };
  }
  return {
    title: "Browser scanner not connected",
    text: "Loupe can only preview simple HTML signals until the scraper service URL is configured.",
  };
}

function value(metrics: A11yIssue["metrics"] | undefined, key: string) {
  return metrics?.[key];
}

function expectedText(issue: A11yIssue) {
  const metrics = issue.metrics;
  switch (issue.type) {
    case "low_contrast":
      return `Contrast ratio should be at least ${value(metrics, "requiredRatio")}:1`;
    case "small_tap_target":
      return `Target should be at least ${value(metrics, "expectedMinWidth")} x ${value(metrics, "expectedMinHeight")}px`;
    default:
      return String(value(metrics, "expected") ?? issue.details);
  }
}

function actualText(issue: A11yIssue) {
  const metrics = issue.metrics;
  switch (issue.type) {
    case "low_contrast":
      return `Measured ${value(metrics, "contrastRatio")}:1 at ${value(metrics, "fontSize")} — "${value(metrics, "sampleText")}"`;
    case "small_tap_target":
      return `Measured ${value(metrics, "width")} x ${value(metrics, "height")}px`;
    default:
      return String(value(metrics, "measured") ?? "—");
  }
}

function locationText(issue: A11yIssue) {
  const x = value(issue.metrics, "x");
  const y = value(issue.metrics, "y");
  if (typeof x === "number" && typeof y === "number") return `Around x:${x}px, y:${y}px`;
  return issue.selector && issue.selector !== "document" ? "Selector" : "Document";
}

function IssueCard({ issue, index }: { issue: A11yIssue; index?: number }) {
  return (
    <div className="rounded-xl border border-black/[0.08] bg-white p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {typeof index === "number" && (
          <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#0f0f0f] px-1 text-[10px] font-bold text-white">{index}</span>
        )}
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize ${SEVERITY_CLASS[issue.severity]}`}>
          {issue.severity}
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[#71717a]">{formatType(issue.type)}</span>
      </div>
      <p className="text-[13px] font-semibold text-[#17171c]">{issue.details}</p>
      {WHY_COPY[issue.type] && (
        <p className="mt-1 text-[12px] leading-relaxed text-[#71717a]">{WHY_COPY[issue.type]}</p>
      )}
      <p className="mt-1 text-[12px] leading-relaxed text-[#4b5563]">
        Element: <span className="font-medium text-[#17171c]">{issue.element}</span>
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <div className="rounded-lg bg-[#fafafa] px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#71717a]">Expected</p>
          <p className="mt-1 text-[11px] leading-snug text-[#17171c]">{expectedText(issue)}</p>
        </div>
        <div className="rounded-lg bg-[#fafafa] px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#71717a]">Measured</p>
          <p className="mt-1 text-[11px] leading-snug text-[#17171c]">{actualText(issue)}</p>
        </div>
        <div className="rounded-lg bg-[#fafafa] px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#71717a]">Where</p>
          <p className="mt-1 text-[11px] leading-snug text-[#17171c]">{locationText(issue)}</p>
        </div>
      </div>
      {issue.selector && issue.selector !== "document" && (
        <p className="mt-3 truncate font-mono text-[10px] text-[#a1a1aa]">{issue.selector}</p>
      )}
    </div>
  );
}

export default function AccessibilityAgentPage() {
  const [url, setUrl] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<A11yResult | null>(null);
  const [browserScannerConnected, setBrowserScannerConnected] = useState<boolean | null>(null);
  const [scannerStatus, setScannerStatus] = useState<ScannerStatus | null>(null);

  const canRun = url.trim().startsWith("http") && !running;

  useEffect(() => {
    fetch("/api/agents/accessibility")
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

  const issuesByCategory = useMemo(() => {
    const issues = result?.issues ?? [];
    return CATEGORIES
      .map(cat => ({ cat, issues: issues.filter(i => cat.types.includes(i.type)) }))
      .filter(g => g.issues.length > 0);
  }, [result]);

  const counts = useMemo(() => {
    const issues = result?.issues ?? [];
    return {
      total: issues.length,
      high: issues.filter(i => i.severity === "high").length,
      medium: issues.filter(i => i.severity === "medium").length,
      low: issues.filter(i => i.severity === "low").length,
    };
  }, [result]);

  // Stable finding numbers, following category display order.
  const issueIndex = useMemo(() => {
    const map = new Map<string, number>();
    let n = 1;
    for (const { issues } of issuesByCategory) for (const issue of issues) map.set(issue.id, n++);
    return map;
  }, [issuesByCategory]);

  const score = useMemo(
    () => (result && result.mode === "browser" ? qaScore(result.issues) : null),
    [result]
  );

  const [shareState, setShareState] = useState<"idle" | "saving" | "copied" | "error">("idle");

  function num(metrics: A11yIssue["metrics"], key: string): number | undefined {
    const v = metrics?.[key];
    return typeof v === "number" ? v : undefined;
  }

  function displayFinding(issue: A11yIssue) {
    return {
      id: issue.id,
      index: issueIndex.get(issue.id) ?? 0,
      severity: issue.severity,
      typeLabel: formatType(issue.type),
      headline: issue.details,
      why: WHY_COPY[issue.type],
      element: issue.element,
      selector: issue.selector,
      expected: expectedText(issue),
      measured: actualText(issue),
      x: num(issue.metrics, "x"),
      y: num(issue.metrics, "y"),
      width: num(issue.metrics, "width"),
      height: num(issue.metrics, "height"),
    };
  }

  async function shareReport() {
    if (!result || score === null) return;
    setShareState("saving");
    try {
      const allFindings = issuesByCategory.flatMap(({ issues }) => issues.map(displayFinding));
      const res = await fetch("/api/agents/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "accessibility",
          report: {
            kind: "accessibility",
            url: result.url,
            checkedAt: result.checkedAt,
            score,
            scoreLabel: "Accessibility QA",
            sections: [{
              id: "page",
              title: "Annotated page — desktop (1440px)",
              screenshot: result.screenshot,
              findings: allFindings,
            }],
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Share failed");
      await navigator.clipboard.writeText(`${window.location.origin}${data.url}`);
      setShareState("copied");
    } catch {
      setShareState("error");
    } finally {
      setTimeout(() => setShareState("idle"), 2500);
    }
  }

  async function run() {
    if (!canRun) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/agents/accessibility", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
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
              <Accessibility size={17} strokeWidth={1.8} />
            </div>
            <div>
              <h1 className="text-[17px] font-semibold">Accessibility QA</h1>
              <p className="mt-0.5 text-[12px] text-[#71717a]">WCAG checks for contrast, labels, headings, focus, ARIA, and tap targets on a live page.</p>
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
              {CATEGORIES.slice(0, 4).map(cat => {
                const Icon = cat.icon;
                return (
                  <div key={cat.id} className="rounded-lg border border-black/[0.06] px-3 py-2.5">
                    <div className="mb-1.5 flex items-center gap-2">
                      <Icon size={13} className="text-[#4b5563]" />
                      <p className="text-[12px] font-semibold text-[#17171c]">{cat.label}</p>
                    </div>
                    <p className="text-[11px] leading-snug text-[#71717a]">
                      {cat.types.map(t => formatType(t)).join(", ")}
                    </p>
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
                  {browserScannerConnected ? "Run accessibility scan" : "Preview HTML"}
                </button>
              </div>
            </div>

            {browserScannerConnected === false && !result && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="text-[12px] font-medium text-amber-800">{scannerStatusCopy(scannerStatus).title}</p>
                <p className="mt-0.5 text-[12px] leading-relaxed text-amber-700">{scannerStatusCopy(scannerStatus).text}</p>
              </div>
            )}

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
                  <p className="text-[13px] font-medium text-emerald-800">No accessibility issues found.</p>
                  <p className="mt-0.5 text-[12px] text-emerald-700">Checked contrast, labels, headings, focus styles, ARIA, and tap targets.</p>
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
                {result.screenshot && (
                  <AnnotatedScreenshot
                    screenshot={result.screenshot}
                    findings={issuesByCategory.flatMap(({ issues }) => issues.map(displayFinding))}
                    caption="Desktop (1440px) — numbered boxes match the findings below."
                  />
                )}
                {issuesByCategory.map(({ cat, issues }) => (
                  <div key={cat.id} className="space-y-2">
                    <p className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-[#71717a]">
                      {cat.label} · {issues.length} issue{issues.length === 1 ? "" : "s"}
                    </p>
                    {issues.map(issue => <IssueCard key={issue.id} issue={issue} index={issueIndex.get(issue.id)} />)}
                  </div>
                ))}
                {result.truncatedTypes && result.truncatedTypes.length > 0 && (
                  <p className="px-1 text-[11px] text-[#71717a]">
                    {result.truncatedTypes.map(t => `${formatType(t.type)}: showing ${t.shown} of ${t.total}`).join(" · ")}
                  </p>
                )}
              </div>
            )}
          </section>

          <aside className="h-fit rounded-xl border border-black/[0.08] bg-[#fafafa] p-4">
            {score !== null && result && (
              <div className="mb-4 space-y-2">
                <ScoreBadge score={score} label="Accessibility QA score" />
                <button
                  onClick={shareReport}
                  disabled={shareState === "saving"}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#0f0f0f] px-3 py-2 text-[12px] font-medium text-white transition-colors hover:bg-[#1f1f23] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {shareState === "saving" ? <Loader2 size={12} className="animate-spin" /> : <Share2 size={12} />}
                  {shareState === "copied" ? "Link copied!" : shareState === "error" ? "Share failed — retry" : "Share report"}
                </button>
                <p className="text-[10px] leading-relaxed text-[#a1a1aa]">Creates a public link with the annotated screenshot anyone can open.</p>
              </div>
            )}
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
                    : "Runs WCAG AA checks on the rendered page."}
              </p>
            </div>
            {result && issuesByCategory.length > 0 && (
              <div className="mt-4 border-t border-black/[0.06] pt-3">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#71717a]">By category</p>
                <div className="space-y-1.5">
                  {issuesByCategory.map(({ cat, issues }) => (
                    <div key={cat.id} className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="truncate text-[#4b5563]">{cat.label}</span>
                      <span className="rounded-full bg-white px-2 py-0.5 font-medium text-[#17171c]">{issues.length}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {!result && (
              <div className="mt-4 border-t border-black/[0.06] pt-3">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#71717a]">Output</p>
                <div className="space-y-2 text-[11px] text-[#71717a]">
                  <p>Each finding names the element, the WCAG expectation, the measured value, and where it appears on the page.</p>
                  <p>Findings are grouped: contrast, labels, headings, focus &amp; ARIA, touch targets.</p>
                </div>
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
