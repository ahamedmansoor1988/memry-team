"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
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
  Share2,
  Sparkles,
  TextCursorInput,
} from "lucide-react";
import { qaScore } from "@/lib/qa-score";
import { analyzeLayoutIssue } from "@/lib/layout-analysis";
import { AnnotatedScreenshot, ScoreBadge, type Screenshot } from "@/components/qa-report";

type ViewportName = "mobile" | "tablet" | "desktop";

interface ResponsiveIssue {
  id: string;
  viewport: ViewportName | "static";
  type: string;
  severity: "high" | "medium" | "low";
  element: string;
  selector?: string;
  details: string;
  section?: string;
  domPath?: string[];
  css?: Record<string, string>;
  metrics?: Record<string, number | string | boolean | null>;
}

interface ViewportResultMeta {
  viewport: { name: string; width: number; height: number };
  screenshot?: Screenshot;
}

interface ResponsiveResult {
  url: string;
  checkedAt: string;
  mode: "browser" | "static_fallback";
  scannerStatus?: ScannerStatus;
  issues: ResponsiveIssue[];
  viewportResults?: ViewportResultMeta[];
}

type ScannerStatus = "ready" | "not_configured" | "missing_endpoint" | "unreachable";

const VIEWPORTS: Array<{ id: ViewportName; label: string; icon: typeof Smartphone }> = [
  { id: "mobile", label: "Mobile", icon: Smartphone },
  { id: "tablet", label: "Tablet", icon: Tablet },
  { id: "desktop", label: "Desktop", icon: Monitor },
];

const VIEWPORT_META: Record<ViewportName, { label: string; size: string }> = {
  mobile: { label: "Mobile", size: "390 x 844" },
  tablet: { label: "Tablet", size: "768 x 1024" },
  desktop: { label: "Desktop", size: "1440 x 900" },
};

const CHECK_GROUPS = [
  {
    icon: Ruler,
    title: "Layout",
    text: "Horizontal overflow, elements outside the viewport, fixed-width sections, broken containers, overflowing grids.",
  },
  {
    icon: TextCursorInput,
    title: "Typography",
    text: "Clipped text, truncated labels, long unbreakable strings, text overflow.",
  },
  {
    icon: PanelTop,
    title: "Navigation",
    text: "Sticky headers, mega menus, drawers, modals, and floating elements that cover or exceed the screen.",
  },
  {
    icon: MousePointerClick,
    title: "Mobile UX",
    text: "Touch targets, floating widgets, and overlapping UI — reported separately so they never bury layout issues.",
  },
];

const SCAN_STEPS = [
  "Crawl page",
  "Test every viewport",
  "Detect layout failures",
  "Explain root cause & fixes",
];

const REPORT_INCLUDES = [
  "Annotated screenshots",
  "Exact offending element",
  "Root cause analysis",
  "Suggested CSS fixes",
  "Severity",
  "Affected viewport",
];

const TYPE_LABELS: Record<string, string> = {
  horizontal_overflow: "Horizontal overflow",
  element_wider_than_viewport: "Too wide",
  element_outside_viewport: "Outside viewport",
  clipped_text: "Clipped text",
  sticky_covering_content: "Sticky overlap",
  oversized_modal: "Oversized modal",
  small_tap_target: "Touch warning",
  long_unbroken_text: "Long text",
  viewport_meta: "Viewport meta",
  fixed_or_sticky: "Fixed/sticky",
};

// Tap-size findings are touch usability, not layout breakage — kept out of the main list.
const TOUCH_TYPES = new Set(["small_tap_target"]);

const VIEWPORT_ORDER: Record<string, number> = { mobile: 0, tablet: 1, desktop: 2, static: 3 };

const WHY_COPY: Record<string, string> = {
  horizontal_overflow: "Users see sideways scrolling or clipped content at this width.",
  element_wider_than_viewport: "This element forces the page wider than the screen.",
  element_outside_viewport: "Part of this element is cut off at this width.",
  clipped_text: "Text may be cut off or unreadable at this breakpoint.",
  sticky_covering_content: "The header or drawer can cover page content while scrolling.",
  oversized_modal: "The overlay cannot fit on this screen, so content or controls get cut off.",
  long_unbroken_text: "Unbroken text can force sideways scrolling on narrow screens.",
  small_tap_target: "Small targets are hard to tap accurately. Usability note, not layout breakage.",
  viewport_meta: "Without a viewport meta tag, phones render the page at desktop width.",
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

function value(metrics: ResponsiveIssue["metrics"] | undefined, key: string) {
  return metrics?.[key];
}

function viewportText(issue: ResponsiveIssue) {
  if (issue.viewport === "static") return "HTML preview";
  const meta = VIEWPORT_META[issue.viewport];
  return `${meta.label} (${meta.size})`;
}

function issueHeadline(issue: ResponsiveIssue) {
  switch (issue.type) {
    case "horizontal_overflow":
      return "Page creates horizontal scrolling";
    case "element_wider_than_viewport":
      return "Element is wider than the viewport";
    case "element_outside_viewport":
      return "Element is partly outside the screen";
    case "clipped_text":
      return "Text is clipped inside its container";
    case "sticky_covering_content":
      return "Sticky/fixed area may cover page content";
    case "oversized_modal":
      return "Modal or drawer is larger than the screen";
    case "small_tap_target":
      return "Tap target is smaller than recommended";
    case "long_unbroken_text":
      return "Long text may not wrap on narrow screens";
    default:
      return formatType(issue.type);
  }
}

function expectedText(issue: ResponsiveIssue) {
  const metrics = issue.metrics;
  switch (issue.type) {
    case "horizontal_overflow":
      return `Page width should be <= ${value(metrics, "viewportWidth")}px`;
    case "element_wider_than_viewport":
      return `Element width should be <= ${value(metrics, "expectedMaxWidth")}px`;
    case "element_outside_viewport":
      return `Element bounds should stay between 0 and ${value(metrics, "expectedRightMax")}px`;
    case "clipped_text":
      return `Container should fit at least ${value(metrics, "expectedWidthAtLeast")}px wide and ${value(metrics, "expectedHeightAtLeast")}px tall`;
    case "sticky_covering_content":
      return `Top fixed area should stay below about ${value(metrics, "expectedMaxHeight")}px`;
    case "oversized_modal":
      return `Overlay should fit inside ${value(metrics, "viewportWidth")} x ${value(metrics, "viewportHeight")}px`;
    case "small_tap_target":
      return `Interactive target should be at least ${value(metrics, "expectedMinWidth")} x ${value(metrics, "expectedMinHeight")}px`;
    case "long_unbroken_text":
      return "Text should wrap or truncate without forcing horizontal scroll";
    default:
      return issue.details;
  }
}

function actualText(issue: ResponsiveIssue) {
  const metrics = issue.metrics;
  switch (issue.type) {
    case "horizontal_overflow": {
      const culpritWidth = value(metrics, "width");
      const base = `Measured page width ${value(metrics, "scrollWidth")}px, overflow ${value(metrics, "overflowPx")}px`;
      return typeof culpritWidth === "number" ? `${base} · widest element ${culpritWidth}px wide` : base;
    }
    case "element_wider_than_viewport":
      return `Measured element width ${value(metrics, "width")}px`;
    case "element_outside_viewport":
      return `Measured left ${value(metrics, "left")}px, right ${value(metrics, "right")}px`;
    case "clipped_text":
      return `Visible box ${value(metrics, "clientWidth")} x ${value(metrics, "clientHeight")}px, content needs ${value(metrics, "scrollWidth")} x ${value(metrics, "scrollHeight")}px`;
    case "sticky_covering_content":
      return `Measured height ${value(metrics, "height")}px`;
    case "oversized_modal":
      return `Measured overlay ${value(metrics, "width")} x ${value(metrics, "height")}px`;
    case "small_tap_target":
      return `Measured target ${value(metrics, "width")} x ${value(metrics, "height")}px`;
    case "long_unbroken_text":
      return `Unbroken text length ${value(metrics, "length")} characters`;
    default:
      return metricSummary(metrics);
  }
}

function locationText(issue: ResponsiveIssue) {
  if (issue.section) return issue.section;
  return issue.selector && issue.selector !== "document" ? "See selector below" : "Whole page";
}

function DomPathTree({ path }: { path: string[] }) {
  return (
    <pre className="overflow-x-auto font-mono text-[10px] leading-relaxed text-[#4b5563]">
      {path.map((part, i) => (i === 0 ? part : `${"    ".repeat(i - 1)}└── ${part}`)).join("\n")}
    </pre>
  );
}

function groupHeading(viewport: string) {
  if (viewport === "static") return "HTML preview";
  const meta = VIEWPORT_META[viewport as ViewportName];
  return meta ? `${meta.label} (${meta.size})` : viewport;
}

interface AiAnalysisResult {
  rootCause: string;
  fix: string;
  cssSnippet: string;
  confidence: number;
  cached?: boolean;
}

function IssueCard({ issue, index, aiEnabled, pageUrl }: { issue: ResponsiveIssue; index?: number; aiEnabled?: boolean; pageUrl?: string }) {
  const analysis = analyzeLayoutIssue(issue.type, issue.css, issue.metrics);
  const cssEntries = Object.entries(analysis.cssHighlights);
  const [ai, setAi] = useState<AiAnalysisResult | null>(null);
  const [aiState, setAiState] = useState<"idle" | "loading" | "error">("idle");
  const [aiError, setAiError] = useState<string | null>(null);

  async function runAi() {
    setAiState("loading");
    setAiError(null);
    try {
      const res = await fetch("/api/agents/ai-fix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: pageUrl,
          finding: {
            type: issue.type,
            viewport: issue.viewport,
            element: issue.element,
            selector: issue.selector,
            section: issue.section,
            domPath: issue.domPath,
            css: issue.css,
            metrics: issue.metrics,
            details: issue.details,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "AI analysis failed");
      setAi(data);
      setAiState("idle");
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e));
      setAiState("error");
    }
  }
  return (
    <div className="rounded-xl border border-black/[0.08] bg-white p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {typeof index === "number" && (
          <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#0f0f0f] px-1 text-[10px] font-bold text-white">{index}</span>
        )}
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize ${SEVERITY_CLASS[issue.severity]}`}>
          {issue.severity}
        </span>
        <span className="rounded-full bg-[#f5f5f7] px-2 py-0.5 text-[10px] font-medium capitalize text-[#4b5563]">
          {viewportText(issue)}
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[#71717a]">{formatType(issue.type)}</span>
        <span className="ml-auto rounded-full bg-[#f5f5f7] px-2 py-0.5 text-[10px] font-medium text-[#4b5563]" title="How confident Loupe is in the root-cause analysis">
          {analysis.confidence}% confidence
        </span>
      </div>

      <p className="text-[13px] font-semibold text-[#17171c]">{issueHeadline(issue)}</p>
      <p className="mt-1 text-[12px] leading-relaxed text-[#4b5563]">{actualText(issue)}. Expected: {expectedText(issue).toLowerCase()}.</p>
      {WHY_COPY[issue.type] && (
        <p className="mt-1.5 text-[12px] leading-relaxed text-[#71717a]">
          <span className="font-medium text-[#4b5563]">Impact:</span> {WHY_COPY[issue.type]}
        </p>
      )}

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg bg-[#fafafa] px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#71717a]">Location</p>
          <p className="mt-1 text-[11px] leading-snug text-[#17171c]">{locationText(issue)}</p>
          <p className="mt-0.5 text-[11px] leading-snug text-[#71717a]">{issue.element}</p>
        </div>
        <div className="rounded-lg bg-[#fafafa] px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#71717a]">Element</p>
          {issue.domPath && issue.domPath.length > 1 ? (
            <div className="mt-1"><DomPathTree path={issue.domPath} /></div>
          ) : (
            <p className="mt-1 truncate font-mono text-[10px] text-[#4b5563]">{issue.selector}</p>
          )}
        </div>
      </div>

      <div className="mt-2 rounded-lg bg-[#fafafa] px-3 py-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[#71717a]">Root cause</p>
        <p className="mt-1 text-[11px] leading-relaxed text-[#17171c]">{analysis.rootCause}</p>
        {cssEntries.length > 0 && (
          <pre className="mt-2 overflow-x-auto rounded-md bg-white px-2.5 py-2 font-mono text-[10px] leading-relaxed text-[#4b5563]">
            {cssEntries.map(([prop, val]) => `${prop}: ${val};`).join("\n")}
          </pre>
        )}
      </div>

      <div className="mt-2 rounded-lg border border-emerald-100 bg-emerald-50/60 px-3 py-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Suggested fix</p>
        <p className="mt-1 text-[11px] leading-relaxed text-emerald-900">{analysis.fix}</p>
      </div>

      {ai ? (
        <div className="mt-2 rounded-lg border border-black/[0.1] bg-white px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#17171c]">
              <Sparkles size={11} /> AI analysis
            </p>
            <span className="text-[10px] text-[#a1a1aa]">{ai.confidence}% confidence{ai.cached ? " · cached" : ""}</span>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-[#17171c]">{ai.rootCause}</p>
          <p className="mt-1.5 text-[11px] leading-relaxed text-[#4b5563]">{ai.fix}</p>
          {ai.cssSnippet && (
            <pre className="mt-2 overflow-x-auto rounded-md bg-[#fafafa] px-2.5 py-2 font-mono text-[10px] leading-relaxed text-[#4b5563]">{ai.cssSnippet}</pre>
          )}
        </div>
      ) : aiEnabled && (
        <div className="mt-2">
          <button
            onClick={runAi}
            disabled={aiState === "loading"}
            className="inline-flex items-center gap-1.5 rounded-lg border border-black/[0.12] px-2.5 py-1.5 text-[11px] font-medium text-[#17171c] transition-colors hover:border-black/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {aiState === "loading" ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
            {aiState === "loading" ? "Analyzing…" : "AI analysis"}
          </button>
          {aiError && <p className="mt-1 text-[10px] text-red-600">{aiError}</p>}
        </div>
      )}

      {issue.selector && issue.selector !== "document" && (
        <p className="mt-3 truncate font-mono text-[10px] text-[#a1a1aa]">{issue.selector}</p>
      )}
    </div>
  );
}

export default function ResponsiveAgentPage() {
  const [url, setUrl] = useState("");
  const ALL_VIEWPORTS: ViewportName[] = ["mobile", "tablet", "desktop"];
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResponsiveResult | null>(null);
  const [browserScannerConnected, setBrowserScannerConnected] = useState<boolean | null>(null);
  const [scannerStatus, setScannerStatus] = useState<ScannerStatus | null>(null);
  const [showTouch, setShowTouch] = useState(false);

  const canRun = url.trim().startsWith("http") && !running;

  const { layoutIssues, touchIssues, layoutByViewport } = useMemo(() => {
    const issues = result?.issues ?? [];
    const layout = issues.filter(i => !TOUCH_TYPES.has(i.type));
    const touch = issues.filter(i => TOUCH_TYPES.has(i.type));
    const grouped = new Map<string, ResponsiveIssue[]>();
    for (const issue of layout) {
      const list = grouped.get(issue.viewport) ?? [];
      list.push(issue);
      grouped.set(issue.viewport, list);
    }
    const byViewport = Array.from(grouped.entries())
      .sort((a, b) => (VIEWPORT_ORDER[a[0]] ?? 9) - (VIEWPORT_ORDER[b[0]] ?? 9));
    return { layoutIssues: layout, touchIssues: touch, layoutByViewport: byViewport };
  }, [result]);

  const counts = useMemo(() => ({
    total: (result?.issues ?? []).length,
    layout: layoutIssues.length,
    touch: touchIssues.length,
    high: layoutIssues.filter(i => i.severity === "high").length,
    medium: layoutIssues.filter(i => i.severity === "medium").length,
  }), [result, layoutIssues, touchIssues]);

  // Stable finding numbers, in display order: layout groups first, touch last.
  const issueIndex = useMemo(() => {
    const map = new Map<string, number>();
    let n = 1;
    for (const [, issues] of layoutByViewport) for (const issue of issues) map.set(issue.id, n++);
    for (const issue of touchIssues) map.set(issue.id, n++);
    return map;
  }, [layoutByViewport, touchIssues]);

  const score = useMemo(
    () => (result && result.mode === "browser" ? qaScore(result.issues) : null),
    [result]
  );

  const [shareState, setShareState] = useState<"idle" | "saving" | "copied" | "error">("idle");
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    import("@/lib/supabase/client").then(({ createClient }) =>
      createClient().auth.getUser().then(({ data }) => setSignedIn(Boolean(data.user)))
    ).catch(() => setSignedIn(false));
  }, []);

  function num(metrics: ResponsiveIssue["metrics"], key: string): number | undefined {
    const v = metrics?.[key];
    return typeof v === "number" ? v : undefined;
  }

  function displayFinding(issue: ResponsiveIssue) {
    const analysis = analyzeLayoutIssue(issue.type, issue.css, issue.metrics);
    return {
      id: issue.id,
      index: issueIndex.get(issue.id) ?? 0,
      severity: issue.severity,
      typeLabel: formatType(issue.type),
      headline: issueHeadline(issue),
      why: WHY_COPY[issue.type],
      element: issue.element,
      selector: issue.selector,
      expected: expectedText(issue),
      measured: actualText(issue),
      viewport: issue.viewport,
      section: issue.section,
      domPath: issue.domPath,
      rootCause: analysis.rootCause,
      fix: analysis.fix,
      confidence: analysis.confidence,
      cssHighlights: analysis.cssHighlights,
      x: num(issue.metrics, "x"),
      y: num(issue.metrics, "y"),
      width: num(issue.metrics, "width"),
      height: num(issue.metrics, "height"),
    };
  }

  function screenshotFor(viewport: string) {
    return result?.viewportResults?.find(v => v.viewport?.name === viewport)?.screenshot;
  }

  async function shareReport() {
    if (!result || score === null) return;
    setShareState("saving");
    try {
      const sections = layoutByViewport.map(([viewport, issues]) => ({
        id: viewport,
        title: groupHeading(viewport),
        screenshot: screenshotFor(viewport),
        findings: issues.map(displayFinding),
      }));
      for (const v of result.viewportResults ?? []) {
        if (!sections.some(s => s.id === v.viewport.name)) {
          sections.push({ id: v.viewport.name, title: groupHeading(v.viewport.name), screenshot: v.screenshot, findings: [] });
        }
      }
      sections.sort((a, b) => (VIEWPORT_ORDER[a.id] ?? 9) - (VIEWPORT_ORDER[b.id] ?? 9));
      if (touchIssues.length > 0) {
        sections.push({ id: "touch", title: `Touch warnings (${touchIssues.length})`, screenshot: undefined, findings: touchIssues.map(displayFinding) });
      }
      const res = await fetch("/api/agents/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "responsive",
          report: { kind: "responsive", url: result.url, checkedAt: result.checkedAt, score, scoreLabel: "Layout QA", sections },
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


  async function run() {
    if (!canRun) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/agents/responsive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), viewports: ALL_VIEWPORTS }),
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
              <h1 className="text-[17px] font-semibold">Layout QA</h1>
              <p className="mt-0.5 text-[12px] text-[#71717a]">Automatically inspect your website for layout issues across mobile, tablet, and desktop viewports.</p>
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
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-[#71717a]">How Layout QA works</p>
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
            <div className="mt-3 border-t border-black/[0.06] pt-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#71717a]">Report includes</p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                {REPORT_INCLUDES.map(item => (
                  <p key={item} className="flex items-center gap-1.5 text-[11px] text-[#4b5563]">
                    <Check size={11} className="shrink-0 text-[#0f0f0f]" /> {item}
                  </p>
                ))}
              </div>
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
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-[#71717a]">Viewports tested</p>
              <div className="grid gap-2 sm:grid-cols-3">
                {VIEWPORTS.map(v => {
                  const Icon = v.icon;
                  return (
                    <div key={v.id} className="flex min-h-[76px] flex-col items-start justify-between rounded-lg border border-black/[0.1] px-3 py-2.5 text-[#4b5563]">
                      <Icon size={15} />
                      <span>
                        <span className="block text-[13px] font-semibold text-[#17171c]">{v.label}</span>
                        <span className="block text-[11px] text-[#a1a1aa]">
                          {v.id === "mobile" ? "390px wide" : v.id === "tablet" ? "768px wide" : "1440px wide"}
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
              <p className="mt-2 text-[11px] text-[#a1a1aa]">Every scan automatically checks all three.</p>
            </div>

            {error && (
              <div className="flex items-start gap-3 rounded-xl border border-red-100 bg-red-50 px-4 py-3">
                <AlertCircle size={15} className="mt-0.5 shrink-0 text-red-500" />
                <p className="text-[13px] text-red-600">{error}</p>
              </div>
            )}

            {result && counts.layout === 0 && result.mode === "browser" && (
              <div className="flex items-start gap-3 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3">
                <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-600" />
                <div>
                  <p className="text-[13px] font-medium text-emerald-800">No layout issues found.</p>
                  <p className="mt-0.5 text-[12px] text-emerald-700">
                    Checked mobile, tablet, and desktop using {modeLabel(result.mode)}.
                    {counts.touch > 0 && ` ${counts.touch} touch warning${counts.touch === 1 ? "" : "s"} listed below.`}
                  </p>
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
                {layoutByViewport.map(([viewport, issues]) => {
                  const shot = screenshotFor(viewport);
                  return (
                    <div key={viewport} className="space-y-2">
                      <p className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-[#71717a]">
                        {groupHeading(viewport)} · {issues.length} issue{issues.length === 1 ? "" : "s"}
                      </p>
                      {shot && (
                        <AnnotatedScreenshot
                          screenshot={shot}
                          findings={issues.map(displayFinding)}
                          caption={`${groupHeading(viewport)} — numbered boxes match the findings below.`}
                        />
                      )}
                      {issues.map(issue => <IssueCard key={issue.id} issue={issue} index={issueIndex.get(issue.id)} aiEnabled={signedIn === true} pageUrl={result?.url} />)}
                    </div>
                  );
                })}

                {touchIssues.length > 0 && (
                  <div className="rounded-xl border border-black/[0.08] bg-[#fafafa]">
                    <button
                      onClick={() => setShowTouch(s => !s)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                    >
                      <span>
                        <span className="block text-[12px] font-semibold text-[#17171c]">
                          Touch warnings ({touchIssues.length})
                        </span>
                        <span className="mt-0.5 block text-[11px] text-[#71717a]">
                          Tap-size usability notes. These do not break the layout.
                        </span>
                      </span>
                      <ChevronDown
                        size={15}
                        className={`shrink-0 text-[#71717a] transition-transform ${showTouch ? "rotate-180" : ""}`}
                      />
                    </button>
                    {showTouch && (
                      <div className="space-y-2 px-3 pb-3">
                        {touchIssues.map(issue => <IssueCard key={issue.id} issue={issue} aiEnabled={signedIn === true} pageUrl={result?.url} />)}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>

          <aside className="h-fit rounded-xl border border-black/[0.08] bg-[#fafafa] p-4">
            {score !== null && result && (
              <div className="mb-4 space-y-2">
                <ScoreBadge score={score} label="Layout QA score" />
                {signedIn === false ? (
                  <a
                    href="/login"
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#0f0f0f] px-3 py-2 text-[12px] font-medium text-white transition-colors hover:bg-[#1f1f23]"
                  >
                    <Share2 size={12} /> Sign in to share report
                  </a>
                ) : (
                  <button
                    onClick={shareReport}
                    disabled={shareState === "saving" || signedIn === null}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#0f0f0f] px-3 py-2 text-[12px] font-medium text-white transition-colors hover:bg-[#1f1f23] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {shareState === "saving" ? <Loader2 size={12} className="animate-spin" /> : <Share2 size={12} />}
                    {shareState === "copied" ? "Link copied!" : shareState === "error" ? "Share failed — retry" : "Share report"}
                  </button>
                )}
                <p className="text-[10px] leading-relaxed text-[#a1a1aa]">
                  {signedIn === false
                    ? "Sharing is free — sign in with Google to create a public report link."
                    : "Creates a public link with screenshots and findings anyone can open."}
                </p>
              </div>
            )}
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-[#71717a]">Summary</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-white p-3">
                <p className="text-[22px] font-semibold leading-none">{counts.layout}</p>
                <p className="mt-1 text-[11px] text-[#71717a]">{result?.mode === "static_fallback" ? "HTML hints" : "Layout issues"}</p>
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
                <p className="text-[22px] font-semibold leading-none">{counts.touch}</p>
                <p className="mt-1 text-[11px] text-[#71717a]">Touch warnings</p>
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
