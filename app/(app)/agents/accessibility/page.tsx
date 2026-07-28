"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Contrast,
  ExternalLink,
  Heading1,
  Keyboard,
  Loader2,
  MousePointerClick,
  Play,
  Share2,
  ShieldCheck,
  Sparkles,
  Tags,
} from "lucide-react";
import { qaScore } from "@/lib/qa-score";
import { AnnotatedScreenshot, FocusedIssueView, ScoreBadge, type Screenshot } from "@/components/qa-report";
import { ScanHelpToggle } from "@/components/scan-help-toggle";
import { BetaTag } from "@/app/(app)/_sidebar";
import { loadCachedScan, saveCachedScan } from "@/lib/scan-cache";
import { isUsableUrl, normalizeUrl } from "@/lib/normalize-url";

const SCAN_CACHE_KEY = "loupe.accessibility.last-scan";

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

// Types come from two sources: axe-core's real WCAG rule IDs (e.g.
// "color-contrast", "image-alt") for everything axe checks, plus our own
// custom checks (missing_focus_style, small_tap_target) for the couple of
// things axe can't see on a rendered page. Anything not listed here still
// shows up — it falls into the catch-all "Other WCAG issues" bucket below.
const CATEGORIES: Array<{ id: string; label: string; icon: typeof Contrast; types: string[] }> = [
  { id: "contrast", label: "Contrast", icon: Contrast, types: ["color-contrast", "color-contrast-enhanced"] },
  {
    id: "labels", label: "Labels & alt text", icon: Tags,
    types: ["image-alt", "input-image-alt", "area-alt", "button-name", "link-name", "label", "select-name", "aria-command-name", "document-title", "frame-title", "html-has-lang", "html-lang-valid"],
  },
  { id: "headings", label: "Headings", icon: Heading1, types: ["page-has-heading-one", "heading-order", "empty-heading"] },
  {
    id: "focus", label: "Focus & ARIA", icon: Keyboard,
    types: [
      "missing_focus_style", "aria-hidden-focus", "focus-order-semantics", "tabindex",
      "aria-allowed-role", "aria-valid-attr-value", "aria-valid-attr", "aria-required-attr",
      "aria-required-children", "aria-required-parent", "aria-roles", "aria-allowed-attr", "duplicate-id-aria",
    ],
  },
  { id: "touch", label: "Touch targets", icon: MousePointerClick, types: ["small_tap_target", "target-size"] },
];

const TYPE_LABELS: Record<string, string> = {
  "color-contrast": "Low contrast",
  "color-contrast-enhanced": "Low contrast (AAA)",
  "image-alt": "Missing alt text",
  "input-image-alt": "Image input missing alt text",
  "area-alt": "Image map area missing alt text",
  "button-name": "Unlabeled button",
  "link-name": "Unlabeled link",
  "label": "Input without label",
  "select-name": "Unlabeled dropdown",
  "html-has-lang": "Missing page language",
  "html-lang-valid": "Invalid page language code",
  "aria-command-name": "Unlabeled ARIA control",
  "document-title": "Missing page title",
  "frame-title": "Untitled iframe",
  "page-has-heading-one": "Missing H1",
  "heading-order": "Heading order",
  "empty-heading": "Empty heading",
  missing_focus_style: "No focus style",
  small_tap_target: "Small tap target",
  "target-size": "Small tap target",
};

const WHY_COPY: Record<string, string> = {
  "color-contrast": "Low-vision users may not be able to read this text.",
  "color-contrast-enhanced": "Below the stricter AAA contrast threshold some users need.",
  "image-alt": "Screen readers announce the file name or nothing at all.",
  "input-image-alt": "Screen reader users get no description of what this image button does.",
  "area-alt": "Screen reader users get no description of this clickable image region.",
  "button-name": "Screen reader users hear \"button\" with no idea what it does.",
  "link-name": "Screen reader users hear \"link\" with no idea where it goes.",
  "label": "Users cannot tell what this field is for, and placeholders vanish on typing.",
  "select-name": "Screen reader users hear a dropdown with no idea what it's choosing between.",
  "html-has-lang": "Screen readers cannot auto-select the right pronunciation and voice without a declared page language.",
  "html-lang-valid": "The declared page language code isn't valid, so assistive tech may mispronounce the content.",
  "aria-command-name": "This ARIA control has no accessible name for assistive tech to announce.",
  "document-title": "Screen reader users and browser tabs show no meaningful page title.",
  "frame-title": "Screen reader users have no idea what this embedded frame contains.",
  "page-has-heading-one": "Screen reader users rely on the H1 to know what the page is about.",
  "heading-order": "Skipped heading levels break outline navigation for screen readers.",
  "empty-heading": "An empty heading gives screen reader users no information at that outline level.",
  missing_focus_style: "Keyboard users cannot see which element they are on.",
  small_tap_target: "Targets under 24px are hard to hit for users with motor impairments.",
  "target-size": "Targets under 24px are hard to hit for users with motor impairments.",
};

const OTHER_CATEGORY: (typeof CATEGORIES)[number] = { id: "other", label: "Other WCAG issues", icon: ShieldCheck, types: [] };

const SEVERITY_CLASS = {
  high: "border-red-200 bg-red-50 text-red-600",
  medium: "border-amber-200 bg-amber-50 text-amber-700",
  low: "border-blue-200 bg-blue-50 text-blue-600",
};

const SEVERITY_ACCENT = {
  high: "border-l-red-500",
  medium: "border-l-amber-500",
  low: "border-l-blue-500",
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

function num(metrics: A11yIssue["metrics"] | undefined, key: string): number | undefined {
  const v = metrics?.[key];
  return typeof v === "number" ? v : undefined;
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

interface AiAnalysis {
  rootCause: string;
  fix: string;
  cssSnippet: string;
  confidence: number;
}

function AiExplainButton({ issue, url }: { issue: A11yIssue; url: string }) {
  const [state, setState] = useState<"idle" | "loading" | "error" | "done">("idle");
  const [analysis, setAnalysis] = useState<AiAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function explain() {
    setState("loading");
    setError(null);
    try {
      const res = await fetch("/api/agents/ai-fix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          finding: {
            type: issue.type,
            element: issue.element,
            selector: issue.selector,
            details: issue.details,
            metrics: issue.metrics,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "AI analysis failed.");
      setAnalysis(data);
      setState("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState("error");
    }
  }

  if (state === "idle") {
    return (
      <button
        onClick={explain}
        className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-black/[0.08] bg-white px-2.5 py-1.5 text-[11px] font-medium text-[#4b5563] transition-colors hover:border-black/20 hover:text-[#0f0f0f]"
      >
        <Sparkles size={12} /> Explain with AI
      </button>
    );
  }
  if (state === "loading") {
    return (
      <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-[#71717a]">
        <Loader2 size={12} className="animate-spin" /> Thinking…
      </p>
    );
  }
  if (state === "error") {
    return (
      <p className="mt-3 text-[11px] text-red-600">
        {error} <button onClick={explain} className="underline">Retry</button>
      </p>
    );
  }
  return (
    <div className="mt-3 rounded-lg border border-purple-100 bg-purple-50/50 px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-purple-700">
        <Sparkles size={11} /> AI analysis · {analysis!.confidence}% confidence
      </p>
      <p className="mt-1.5 text-[12px] leading-relaxed text-[#17171c]">{analysis!.rootCause}</p>
      <p className="mt-1.5 text-[12px] leading-relaxed text-[#3f3f46]">{analysis!.fix}</p>
      {analysis!.cssSnippet && (
        <pre className="mt-2 overflow-x-auto rounded-md bg-[#17171c] px-2.5 py-2 text-[11px] leading-relaxed text-white/90">
          <code>{analysis!.cssSnippet}</code>
        </pre>
      )}
    </div>
  );
}

function IssueCard({ issue, index, screenshot, url }: { issue: A11yIssue; index?: number; screenshot?: Screenshot; url?: string }) {
  return (
    <div className={`rounded-xl border border-l-4 border-black/[0.08] bg-white p-4 shadow-sm ${SEVERITY_ACCENT[issue.severity]}`}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {typeof index === "number" && (
          <span className="flex h-[20px] min-w-[20px] items-center justify-center rounded-full bg-[#0f0f0f] px-1 text-[10px] font-bold text-white">{index}</span>
        )}
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize ${SEVERITY_CLASS[issue.severity]}`}>
          {issue.severity}
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[#71717a]">{formatType(issue.type)}</span>
      </div>
      <p className="text-[14px] font-semibold text-[#17171c]">{issue.details}</p>
      {WHY_COPY[issue.type] && (
        <p className="mt-1 text-[12px] leading-relaxed text-[#71717a]">{WHY_COPY[issue.type]}</p>
      )}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg border border-black/[0.06] bg-[#fafafa] px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#71717a]">Measured</p>
          <p className="mt-1 text-[12px] leading-snug text-[#17171c]">{actualText(issue)}</p>
        </div>
        <div className="rounded-lg border border-black/[0.06] bg-[#fafafa] px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#71717a]">Expected</p>
          <p className="mt-1 text-[12px] leading-snug text-[#17171c]">{expectedText(issue)}</p>
        </div>
      </div>
      <div className="mt-2 rounded-lg border border-black/[0.06] bg-[#fafafa] px-3 py-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[#71717a]">Where to inspect</p>
        <p className="mt-1 text-[11px] leading-snug text-[#17171c]">{locationText(issue)}</p>
        <p className="mt-0.5 truncate font-mono text-[11px] leading-snug text-[#71717a]">{issue.element}</p>
        {issue.selector && issue.selector !== "document" && issue.selector !== issue.element && (
          <p className="mt-1.5 truncate font-mono text-[10px] text-[#a1a1aa]">{issue.selector}</p>
        )}
      </div>
      {typeof value(issue.metrics, "howToFix") === "string" && (
        <details className="mt-2 rounded-lg border border-black/[0.06] bg-[#fafafa] px-3 py-2">
          <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wide text-[#71717a]">How to fix (from axe-core)</summary>
          <p className="mt-1.5 whitespace-pre-line text-[11px] leading-relaxed text-[#3f3f46]">{value(issue.metrics, "howToFix") as string}</p>
        </details>
      )}
      {url && <AiExplainButton issue={issue} url={url} />}
    </div>
  );
}

function ScannerPill({ connected }: { connected: boolean | null }) {
  return (
    <span className="rounded-full bg-white px-2 py-1 font-medium text-[#4b5563]">
      {connected ? "Browser scanner ready" : "HTML preview mode"}
    </span>
  );
}

function CategoryChip({ cat }: { cat: typeof CATEGORIES[number] }) {
  const Icon = cat.icon;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2 py-1">
      <Icon size={12} /> {cat.label}
    </span>
  );
}

function OnboardingPanels() {
  return (
    <div className="mb-5 grid gap-3 lg:grid-cols-[1fr_1fr]">
      <div className="rounded-xl border border-black/[0.08] bg-[#fafafa] p-4">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-[#71717a]">Scan flow</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
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
  );
}

export default function AccessibilityAgentPage() {
  const [url, setUrl] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [result, setResult] = useState<A11yResult | null>(null);
  const [browserScannerConnected, setBrowserScannerConnected] = useState<boolean | null>(null);
  const [scannerStatus, setScannerStatus] = useState<ScannerStatus | null>(null);

  const canRun = isUsableUrl(url) && !running;

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
    const known = new Set(CATEGORIES.flatMap(c => c.types));
    const groups = CATEGORIES
      .map(cat => ({ cat, issues: issues.filter(i => cat.types.includes(i.type)) }))
      .filter(g => g.issues.length > 0);
    const other = issues.filter(i => !known.has(i.type));
    if (other.length > 0) groups.push({ cat: OTHER_CATEGORY, issues: other });
    return groups;
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
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    import("@/lib/supabase/client").then(({ createClient }) =>
      createClient().auth.getUser().then(({ data }) => setSignedIn(Boolean(data.user)))
    ).catch(() => setSignedIn(false));
  }, []);


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

  // Restore the previous scan when the user navigates back to this page.
  useEffect(() => {
    const cached = loadCachedScan<A11yResult>(SCAN_CACHE_KEY);
    if (cached) {
      setUrl(cached.url);
      setResult(cached.result);
    }
  }, []);

  async function run() {
    if (!canRun) return;
    setRunning(true);
    setError(null);
    setErrorCode(null);
    setResult(null);
    try {
      const normalizedUrl = normalizeUrl(url);
      const res = await fetch("/api/agents/accessibility", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: normalizedUrl }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorCode(data.code ?? null);
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }
      setResult(data);
      saveCachedScan(SCAN_CACHE_KEY, normalizedUrl, data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-[#fafafa] text-[#0f0f0f]">
      <header className="border-b border-black/[0.06] bg-white">
        <div className="mx-auto flex h-16 max-w-[1280px] items-center justify-between gap-4 px-8">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#111113] text-white">
              <ShieldCheck size={16} strokeWidth={1.9} />
            </div>
            <div className="min-w-0">
              <h1 className="flex items-center gap-2 truncate text-[19px] font-semibold leading-tight text-[#111113]">Accessibility QA <BetaTag /></h1>
              <p className="mt-0.5 truncate text-[12px] text-[#71717a]">WCAG checks for contrast, labels, headings, focus, ARIA, and tap targets on a live page.</p>
            </div>
          </div>
          {result?.url && (
            <a href={result.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[12px] text-[#71717a] hover:text-[#0f0f0f]">
              Open page <ExternalLink size={12} />
            </a>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-[1280px] px-8 py-6">
        <div className="mb-5 rounded-2xl border border-black/[0.08] bg-white p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
            <div className="min-w-0 flex-1">
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-[#71717a]">Page to test</label>
              <input
                value={url}
                onChange={e => setUrl(e.target.value)}
                onKeyDown={e => e.key === "Enter" && canRun && run()}
                placeholder="https://example.com"
                className="h-12 w-full rounded-xl border border-black/[0.10] bg-white px-4 text-[14px] outline-none transition-colors placeholder:text-[#a1a1aa] focus:border-black/30"
              />
            </div>
            <button
              onClick={run}
              disabled={!canRun}
              className="inline-flex h-12 min-w-[240px] shrink-0 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#a855f7] via-[#ec4899] to-[#f97316] px-6 text-[14px] font-semibold text-white shadow-[0_12px_26px_rgba(236,72,153,0.22)] transition-all hover:brightness-[0.98] disabled:cursor-not-allowed disabled:shadow-none disabled:opacity-40"
            >
              {running ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
              {browserScannerConnected ? "Run accessibility scan" : "Preview HTML"}
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-[#71717a]">
            <ScannerPill connected={browserScannerConnected} />
            {CATEGORIES.slice(0, 5).map(cat => <CategoryChip key={cat.id} cat={cat} />)}
          </div>
        </div>

        <ScanHelpToggle>
          <OnboardingPanels />
        </ScanHelpToggle>

        {result && result.mode === "static_fallback" && (
          <div className="mb-5 flex items-start gap-3 rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-3.5">
            <AlertCircle size={18} className="mt-0.5 shrink-0 text-amber-600" />
            <div className="flex-1">
              <p className="text-[13px] font-semibold text-amber-900">Scan did not complete — this is not a clean result</p>
              <p className="mt-1 text-[12px] leading-relaxed text-amber-800">
                {scannerStatusCopy(result.scannerStatus ?? scannerStatus).text} Any counts below reflect a much weaker HTML-only check, not a real scan — they are not evidence the page is accessible.
              </p>
            </div>
            <button
              onClick={run}
              disabled={running}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-[12px] font-medium text-amber-900 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {running ? <Loader2 size={12} className="animate-spin" /> : null}
              Retry scan
            </button>
          </div>
        )}

        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="space-y-4">
            {browserScannerConnected === false && !result && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="text-[12px] font-medium text-amber-800">{scannerStatusCopy(scannerStatus).title}</p>
                <p className="mt-0.5 text-[12px] leading-relaxed text-amber-700">{scannerStatusCopy(scannerStatus).text}</p>
              </div>
            )}

            {error && (
              <div className="flex items-start gap-3 rounded-xl border border-red-100 bg-red-50 px-4 py-3">
                <AlertCircle size={15} className="mt-0.5 shrink-0 text-red-500" />
                <p className="text-[13px] text-red-600">
                  {error}
                  {errorCode === "insufficient_credits" && (
                    <> <a href="/pricing" className="font-semibold underline underline-offset-2">Buy more credits →</a></>
                  )}
                </p>
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

            {result && counts.total > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[12px] font-semibold text-[#17171c]">Findings</p>
                  <p className="text-[11px] text-[#71717a]">{modeLabel(result.mode)}</p>
                </div>
                {result.screenshot && (
                  <AnnotatedScreenshot
                    screenshot={result.screenshot}
                    findings={issuesByCategory.flatMap(({ issues }) => issues.map(displayFinding))}
                    caption="Desktop (1440px) — numbered boxes match the findings below."
                  />
                )}
                {issuesByCategory.map(({ cat, issues }, groupIndex) => {
                  const Icon = cat.icon;
                  const open = openSections[cat.id] ?? groupIndex === 0;
                  const high = issues.filter(i => i.severity === "high").length;
                  const medium = issues.filter(i => i.severity === "medium").length;
                  return (
                    <div key={cat.id} className="rounded-xl border border-black/[0.08] bg-white shadow-sm">
                      <button
                        onClick={() => setOpenSections(s => ({ ...s, [cat.id]: !open }))}
                        className="flex w-full items-center gap-2.5 px-4 py-3 text-left"
                      >
                        <Icon size={14} className="shrink-0 text-[#4b5563]" />
                        <span className="text-[13px] font-semibold text-[#17171c]">{cat.label}</span>
                        <span className="text-[11px] text-[#71717a]">
                          {issues.length} issue{issues.length === 1 ? "" : "s"}
                        </span>
                        <span className="ml-auto flex items-center gap-1.5">
                          {high > 0 && <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-600">{high} high</span>}
                          {medium > 0 && <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">{medium} medium</span>}
                          <ChevronDown size={14} className={`text-[#71717a] transition-transform ${open ? "rotate-180" : ""}`} />
                        </span>
                      </button>
                      {open && (
                        <div className="space-y-2 border-t border-black/[0.06] p-3">
                          {issues.map(issue => <IssueCard key={issue.id} issue={issue} index={issueIndex.get(issue.id)} screenshot={result.screenshot} url={result.url} />)}
                        </div>
                      )}
                    </div>
                  );
                })}
                {result.truncatedTypes && result.truncatedTypes.length > 0 && (
                  <p className="px-1 text-[11px] text-[#71717a]">
                    {result.truncatedTypes.map(t => `${formatType(t.type)}: showing ${t.shown} of ${t.total}`).join(" · ")}
                  </p>
                )}
              </div>
            )}
          </section>

          <aside className="h-fit rounded-2xl border border-black/[0.08] bg-white p-6">
            {score !== null && result && (
              <div className="mb-4 space-y-2">
                <ScoreBadge score={score} label="Accessibility QA score" />
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
                    : "Creates a public link with the annotated screenshot anyone can open."}
                </p>
              </div>
            )}
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-[#71717a]">Summary</p>
            {result?.mode === "static_fallback" ? (
              <div className="rounded-lg border border-amber-200 bg-white p-3">
                <p className="text-[22px] font-semibold leading-none text-amber-600">—</p>
                <p className="mt-1 text-[11px] text-amber-700">Not scanned — scanner unreachable, see warning above</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-white p-3">
                  <p className="text-[22px] font-semibold leading-none">{counts.total}</p>
                  <p className="mt-1 text-[11px] text-[#71717a]">Issues</p>
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
            )}
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
