"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ExternalLink,
  FileText,
  Loader2,
  Palette,
  Play,
  Ruler,
  ShieldCheck,
  Type,
  UploadCloud,
  X,
} from "lucide-react";
import { BetaTag } from "@/app/(app)/_sidebar";
import { ScanHelpToggle } from "@/components/scan-help-toggle";

interface BrandFinding {
  id: string;
  kind: "color" | "font" | "spacing" | "logo";
  severity: "high" | "medium" | "low";
  value: string;
  nearestMatch: string | null;
  distance: number | null;
  count: number;
  examples: string[];
}

interface CheckResult {
  frameName: string;
  checkedAt: string;
  brandColors: string[];
  brandFonts: string[];
  brandSpacing: number[];
  brandLogo: { minSizePx: number | null; minClearSpacePx: number | null; approvedColors: string[] } | null;
  colorsChecked: number;
  textNodesChecked: number;
  spacingNodesChecked: number;
  logoNodesFound: number;
  findings: BrandFinding[];
}

const SEVERITY_CLASS = {
  high: "border-red-200 bg-red-50 text-red-600",
  medium: "border-amber-200 bg-amber-50 text-amber-700",
  low: "border-blue-200 bg-blue-50 text-blue-600",
};

const HOW_IT_WORKS = ["Upload brand guide", "Point at a Figma file", "Loupe reads every color & font", "Flags anything off-brand"];

function parseFigmaUrl(url: string) {
  const fileKeyMatch = url.match(/figma\.com\/(?:file|design)\/([A-Za-z0-9]+)/);
  const nodeIdMatch = url.match(/node-id=([^&]+)/);
  if (!fileKeyMatch) return null;
  return {
    fileKey: fileKeyMatch[1],
    nodeId: nodeIdMatch ? decodeURIComponent(nodeIdMatch[1]).replace(/-/g, ":") : null,
  };
}

function OnboardingPanels() {
  return (
    <div className="mb-5 grid gap-3 lg:grid-cols-[1fr_1fr]">
      <div className="rounded-xl border border-black/[0.08] bg-[#fafafa] p-4">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-[#71717a]">How it works</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {HOW_IT_WORKS.map((step, index) => (
            <div key={step} className="rounded-lg bg-white px-3 py-3">
              <div className="mb-2 flex h-5 w-5 items-center justify-center rounded-full bg-[#0f0f0f] text-[10px] font-semibold text-white">{index + 1}</div>
              <p className="text-[11px] font-medium leading-tight text-[#17171c]">{step}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-xl border border-black/[0.08] bg-white p-4">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-[#71717a]">Brand guide format</p>
        <p className="mb-2 text-[12px] leading-relaxed text-[#4b5563]">
          Any markdown file works. Wrap approved hex colors and font names in backticks anywhere in the doc:
        </p>
        <pre className="overflow-x-auto rounded-lg bg-[#fafafa] px-3 py-2 font-mono text-[11px] leading-relaxed text-[#4b5563]">
{`## Colors
- Primary: \`#3366CC\`
- Accent: \`#FF6B35\`

## Typography
- Headings: \`Inter\`
- Body: \`Inter\`

## Spacing
- Grid: \`8px\`, \`16px\`, \`24px\`, \`32px\`

## Logo
- Minimum size: \`24px\`
- Minimum clear space: \`16px\`
- Approved colors: \`#000000\`, \`#FFFFFF\``}
        </pre>
        <p className="mt-2 text-[11px] leading-relaxed text-[#a1a1aa]">Spacing and Logo sections are optional — colors and fonts alone are enough to run a check.</p>
      </div>
    </div>
  );
}

function swatchStyle(hex: string) {
  return /^#[0-9A-Fa-f]{6}$/.test(hex) ? { background: hex } : { background: "#e5e5e5" };
}

const KIND_LABEL: Record<BrandFinding["kind"], string> = {
  color: "Off-brand color",
  font: "Unapproved font",
  spacing: "Off-grid spacing",
  logo: "Logo rule violation",
};

function logoHeadline(finding: BrandFinding): string {
  if (finding.id.startsWith("logo-size-")) return `Logo renders at ${finding.value} — smaller than the minimum`;
  if (finding.id.startsWith("logo-clearspace-")) return `Only ${finding.value} around the logo — below the required minimum`;
  return `Logo uses ${finding.value}, not an approved logo color`;
}

function FindingCard({ finding, index }: { finding: BrandFinding; index: number }) {
  return (
    <div className="rounded-xl border border-black/[0.08] bg-white p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="flex h-[20px] min-w-[20px] items-center justify-center rounded-full bg-[#0f0f0f] px-1 text-[10px] font-bold text-white">{index}</span>
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize ${SEVERITY_CLASS[finding.severity]}`}>{finding.severity}</span>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[#71717a]">{KIND_LABEL[finding.kind]}</span>
        {finding.count > 1 && <span className="ml-auto text-[11px] text-[#a1a1aa]">{finding.count} uses</span>}
      </div>

      {finding.kind === "color" && (
        <div className="flex items-center gap-3">
          <span className="h-8 w-8 shrink-0 rounded-lg border border-black/[0.1]" style={swatchStyle(finding.value)} />
          <div>
            <p className="text-[13px] font-semibold text-[#17171c]">{finding.value} is not in the brand palette</p>
            {finding.nearestMatch && (
              <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-[#4b5563]">
                Closest approved color:
                <span className="inline-flex items-center gap-1 font-mono">
                  <span className="h-3 w-3 rounded-sm border border-black/[0.1]" style={swatchStyle(finding.nearestMatch)} />
                  {finding.nearestMatch}
                </span>
                {typeof finding.distance === "number" && <span className="text-[#a1a1aa]">({finding.distance} away)</span>}
              </p>
            )}
          </div>
        </div>
      )}

      {finding.kind === "font" && (
        <div>
          <p className="text-[13px] font-semibold text-[#17171c]">"{finding.value}" is not an approved font</p>
          {finding.nearestMatch && <p className="mt-0.5 text-[12px] text-[#4b5563]">Brand guide specifies: {finding.nearestMatch}</p>}
        </div>
      )}

      {finding.kind === "spacing" && (
        <div>
          <p className="text-[13px] font-semibold text-[#17171c]">{finding.value} spacing is not on the approved grid</p>
          {finding.nearestMatch && (
            <p className="mt-0.5 text-[12px] text-[#4b5563]">
              Nearest approved value: {finding.nearestMatch}
              {typeof finding.distance === "number" && <span className="text-[#a1a1aa]"> ({finding.distance}px off)</span>}
            </p>
          )}
        </div>
      )}

      {finding.kind === "logo" && (
        <div>
          <p className="text-[13px] font-semibold text-[#17171c]">{logoHeadline(finding)}</p>
          {finding.nearestMatch && (
            <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-[#4b5563]">
              Required: {finding.id.startsWith("logo-color-") ? (
                <span className="inline-flex items-center gap-1 font-mono">
                  <span className="h-3 w-3 rounded-sm border border-black/[0.1]" style={swatchStyle(finding.nearestMatch)} />
                  {finding.nearestMatch}
                </span>
              ) : finding.nearestMatch}
            </p>
          )}
        </div>
      )}

      {finding.examples.length > 0 && (
        <p className="mt-3 truncate text-[11px] text-[#71717a]">
          Found in: {finding.examples.join(", ")}
        </p>
      )}
    </div>
  );
}

export default function BrandConsistencyPage() {
  const [figmaUrl, setFigmaUrl] = useState("");
  const [pat, setPat] = useState("");
  const [brandGuideName, setBrandGuideName] = useState("");
  const [brandGuideText, setBrandGuideText] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CheckResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setPat(localStorage.getItem("loupe_pat") ?? "");
  }, []);

  function onPatChange(v: string) {
    setPat(v);
    localStorage.setItem("loupe_pat", v);
  }

  async function onFile(file: File) {
    const text = await file.text();
    setBrandGuideName(file.name);
    setBrandGuideText(text);
  }

  const parsed = parseFigmaUrl(figmaUrl);
  const canRun = Boolean(parsed && pat.trim() && brandGuideText.trim() && !running);

  async function run() {
    if (!parsed || !canRun) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/agents/brand-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileKey: parsed.fileKey, nodeId: parsed.nodeId, pat: pat.trim(), brandGuide: brandGuideText }),
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

  const colorFindings = result?.findings.filter(f => f.kind === "color") ?? [];
  const fontFindings = result?.findings.filter(f => f.kind === "font") ?? [];
  const spacingFindings = result?.findings.filter(f => f.kind === "spacing") ?? [];
  const logoFindings = result?.findings.filter(f => f.kind === "logo") ?? [];

  return (
    <div className="h-full overflow-y-auto bg-white text-[#0f0f0f]">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="mb-5 flex items-center gap-3 border-b border-black/[0.06] pb-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-black/[0.04]">
            <Palette size={17} strokeWidth={1.8} />
          </div>
          <div>
            <h1 className="flex items-center gap-2 text-[17px] font-semibold">Brand Consistency <BetaTag /></h1>
            <p className="mt-0.5 text-[12px] text-[#71717a]">Upload your brand guide, point at a Figma file, and find colors, fonts, spacing, and logo usage that don't match.</p>
          </div>
        </div>

        <ScanHelpToggle>
          <OnboardingPanels />
        </ScanHelpToggle>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          <section className="space-y-4">
            <div className="rounded-xl border border-black/[0.08] bg-[#fafafa] p-4">
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-[#71717a]">Figma file URL</label>
              <input
                value={figmaUrl}
                onChange={e => setFigmaUrl(e.target.value)}
                placeholder="https://www.figma.com/design/abc123/My-File"
                className="h-10 w-full rounded-lg border border-black/[0.12] bg-white px-3 text-[13px] outline-none transition-colors placeholder:text-[#a1a1aa] focus:border-black/40"
              />
              <p className="mt-1.5 text-[11px] text-[#71717a]">Paste a link to a specific frame, or the whole file to check everything.</p>

              <label className="mb-1.5 mt-3 block text-[11px] font-semibold uppercase tracking-wide text-[#71717a]">Figma personal access token</label>
              <input
                type="password"
                value={pat}
                onChange={e => onPatChange(e.target.value)}
                placeholder="figd_••••••••••••••••"
                className="h-10 w-full rounded-lg border border-black/[0.12] bg-white px-3 font-mono text-[13px] outline-none transition-colors placeholder:text-[#a1a1aa] focus:border-black/40"
              />
              <p className="mt-1.5 flex items-center gap-1 text-[11px] text-[#71717a]">
                Stored only in your browser. <a href="/agents/settings" className="inline-flex items-center gap-0.5 text-[#0f0f0f] underline underline-offset-2">Manage in Settings <ExternalLink size={10} /></a>
              </p>

              <label className="mb-1.5 mt-3 block text-[11px] font-semibold uppercase tracking-wide text-[#71717a]">Brand guide (.md)</label>
              <input ref={fileInputRef} type="file" accept=".md,.markdown,text/markdown,text/plain" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
              {brandGuideName ? (
                <div className="flex items-center gap-2 rounded-lg border border-black/[0.12] bg-white px-3 py-2">
                  <FileText size={14} className="shrink-0 text-[#4b5563]" />
                  <span className="flex-1 truncate text-[13px] text-[#17171c]">{brandGuideName}</span>
                  <button onClick={() => { setBrandGuideName(""); setBrandGuideText(""); }} className="text-[#a1a1aa] hover:text-[#0f0f0f]"><X size={14} /></button>
                </div>
              ) : (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-black/[0.12] bg-white px-3 py-3 text-[13px] text-[#71717a] transition-colors hover:border-black/40 hover:text-[#0f0f0f]"
                >
                  <UploadCloud size={14} /> Click to upload a .md file
                </button>
              )}

              <button
                onClick={run}
                disabled={!canRun}
                className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#0f0f0f] px-4 text-[13px] font-medium text-white transition-colors hover:bg-[#1f1f23] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                Check brand consistency
              </button>
              {figmaUrl && !parsed && <p className="mt-2 text-[11px] text-amber-700">That doesn't look like a Figma file URL.</p>}
            </div>

            {error && (
              <div className="flex items-start gap-3 rounded-xl border border-red-100 bg-red-50 px-4 py-3">
                <AlertCircle size={15} className="mt-0.5 shrink-0 text-red-500" />
                <p className="text-[13px] text-red-600">{error}</p>
              </div>
            )}

            {result && result.findings.length === 0 && (
              <div className="flex items-start gap-3 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3">
                <Palette size={15} className="mt-0.5 shrink-0 text-emerald-600" />
                <div>
                  <p className="text-[13px] font-medium text-emerald-800">Everything matches the brand guide.</p>
                  <p className="mt-0.5 text-[12px] text-emerald-700">
                    Checked {result.textNodesChecked} text layers against {result.brandColors.length} colors and {result.brandFonts.length} fonts
                    {result.brandSpacing.length > 0 && `, ${result.spacingNodesChecked} auto-layout frames against the spacing grid`}
                    {result.brandLogo && result.logoNodesFound > 0 && `, and ${result.logoNodesFound} logo layer${result.logoNodesFound === 1 ? "" : "s"}`}.
                  </p>
                </div>
              </div>
            )}

            {colorFindings.length > 0 && (
              <div className="space-y-2">
                <p className="flex items-center gap-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-[#71717a]">
                  <Palette size={12} /> Colors · {colorFindings.length} off-brand
                </p>
                {colorFindings.map((f, i) => <FindingCard key={f.id} finding={f} index={i + 1} />)}
              </div>
            )}

            {fontFindings.length > 0 && (
              <div className="space-y-2">
                <p className="flex items-center gap-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-[#71717a]">
                  <Type size={12} /> Typography · {fontFindings.length} unapproved
                </p>
                {fontFindings.map((f, i) => <FindingCard key={f.id} finding={f} index={i + 1} />)}
              </div>
            )}

            {spacingFindings.length > 0 && (
              <div className="space-y-2">
                <p className="flex items-center gap-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-[#71717a]">
                  <Ruler size={12} /> Spacing · {spacingFindings.length} off-grid
                </p>
                {spacingFindings.map((f, i) => <FindingCard key={f.id} finding={f} index={i + 1} />)}
              </div>
            )}

            {logoFindings.length > 0 && (
              <div className="space-y-2">
                <p className="flex items-center gap-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-[#71717a]">
                  <ShieldCheck size={12} /> Logo · {logoFindings.length} issue{logoFindings.length === 1 ? "" : "s"}
                </p>
                {logoFindings.map((f, i) => <FindingCard key={f.id} finding={f} index={i + 1} />)}
              </div>
            )}
          </section>

          <aside className="h-fit rounded-xl border border-black/[0.08] bg-[#fafafa] p-4">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-[#71717a]">Summary</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="col-span-2 rounded-lg bg-white p-3">
                <p className="text-[22px] font-semibold leading-none">{result ? result.findings.length : "—"}</p>
                <p className="mt-1 text-[11px] text-[#71717a]">Total off-brand</p>
              </div>
              <div className="rounded-lg bg-white p-3">
                <p className="text-[22px] font-semibold leading-none">{result ? colorFindings.length : "—"}</p>
                <p className="mt-1 text-[11px] text-[#71717a]">Colors</p>
              </div>
              <div className="rounded-lg bg-white p-3">
                <p className="text-[22px] font-semibold leading-none">{result ? fontFindings.length : "—"}</p>
                <p className="mt-1 text-[11px] text-[#71717a]">Fonts</p>
              </div>
              <div className="rounded-lg bg-white p-3">
                <p className="text-[22px] font-semibold leading-none">{result ? spacingFindings.length : "—"}</p>
                <p className="mt-1 text-[11px] text-[#71717a]">Spacing</p>
              </div>
              <div className="rounded-lg bg-white p-3">
                <p className="text-[22px] font-semibold leading-none">{result ? logoFindings.length : "—"}</p>
                <p className="mt-1 text-[11px] text-[#71717a]">Logo</p>
              </div>
            </div>
            <div className="mt-4 border-t border-black/[0.06] pt-3">
              {result ? (
                <>
                  <p className="text-[11px] text-[#71717a]">Frame: {result.frameName}</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-[#71717a]">
                    Brand: {result.brandColors.length} color{result.brandColors.length === 1 ? "" : "s"} · {result.brandFonts.length} font{result.brandFonts.length === 1 ? "" : "s"}
                    {result.brandSpacing.length > 0 && ` · ${result.brandSpacing.length} spacing value${result.brandSpacing.length === 1 ? "" : "s"}`}
                    {result.brandLogo && " · logo rules"}
                  </p>
                </>
              ) : (
                <p className="text-[11px] text-[#71717a]">Checks every text layer's font, every fill/stroke color, auto-layout spacing, and logo sizing/clear-space/color against your brand guide.</p>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
