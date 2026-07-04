"use client";

import { use, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ExternalLink, Loader2 } from "lucide-react";
import { AnnotatedScreenshot, FocusedIssueView, ScoreBadge, type Screenshot } from "@/components/qa-report";

export interface DisplayFinding {
  id: string;
  index: number;
  severity: "high" | "medium" | "low";
  typeLabel: string;
  headline: string;
  why?: string;
  element: string;
  selector?: string;
  expected?: string;
  measured?: string;
  viewport?: string;
  section?: string;
  domPath?: string[];
  rootCause?: string;
  fix?: string;
  confidence?: number;
  cssHighlights?: Record<string, string>;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface ReportSection {
  id: string;
  title: string;
  screenshot?: Screenshot;
  findings: DisplayFinding[];
}

export interface ReportPayload {
  kind: "responsive" | "accessibility";
  url: string;
  checkedAt: string;
  score: number;
  scoreLabel: string;
  sections: ReportSection[];
}

const SEVERITY_CLASS = {
  high: "border-red-200 bg-red-50 text-red-600",
  medium: "border-amber-200 bg-amber-50 text-amber-700",
  low: "border-blue-200 bg-blue-50 text-blue-600",
};

export default function ReportPage({ params }: { params: { slug: string } | Promise<{ slug: string }> }) {
  // This Next version passes params as a plain object to client pages;
  // newer versions pass a Promise. use() is only legal on the latter.
  const { slug } = params instanceof Promise ? use(params) : params;
  const [data, setData] = useState<ReportPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/agents/report?slug=${encodeURIComponent(slug)}`)
      .then(async res => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Report not found.");
        setData(body.report as ReportPayload);
      })
      .catch(e => setError(e instanceof Error ? e.message : String(e)));
  }, [slug]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white px-6">
        <div className="text-center">
          <p className="text-[15px] font-semibold text-[#17171c]">Report not found</p>
          <p className="mt-1 text-[13px] text-[#71717a]">{error}</p>
          <Link href="/" className="mt-4 inline-block text-[13px] font-medium text-[#0f0f0f] underline">Go to Loupe</Link>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <Loader2 size={20} className="animate-spin text-[#71717a]" />
      </div>
    );
  }

  const totals = {
    high: data.sections.flatMap(s => s.findings).filter(f => f.severity === "high").length,
    medium: data.sections.flatMap(s => s.findings).filter(f => f.severity === "medium").length,
    low: data.sections.flatMap(s => s.findings).filter(f => f.severity === "low").length,
  };

  return (
    <div className="min-h-screen bg-[#fafafa] text-[#0f0f0f]">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <header className="mb-6 rounded-2xl border border-black/[0.08] bg-white p-6">
          <div className="mb-4 flex items-center justify-between gap-4">
            <Image src="/loupe.svg" alt="Loupe" width={482} height={207} className="h-7 w-auto" />
            <p className="text-[11px] uppercase tracking-widest text-[#71717a]">{data.scoreLabel} report</p>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <a href={data.url} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1.5 text-[15px] font-semibold text-[#17171c] hover:underline">
                <span className="truncate">{data.url}</span>
                <ExternalLink size={13} className="shrink-0" />
              </a>
              <p className="mt-1 text-[12px] text-[#71717a]">
                Scanned {new Date(data.checkedAt).toLocaleString()} · {totals.high} high · {totals.medium} medium · {totals.low} low
              </p>
            </div>
            <ScoreBadge score={data.score} label={data.scoreLabel} />
          </div>
        </header>

        {data.sections.map(section => (
          <section key={section.id} className="mb-6 rounded-2xl border border-black/[0.08] bg-white p-6">
            <h2 className="mb-1 text-[14px] font-semibold text-[#17171c]">{section.title}</h2>
            <p className="mb-4 text-[12px] text-[#71717a]">
              {section.findings.length === 0
                ? "No issues found."
                : `${section.findings.length} finding${section.findings.length === 1 ? "" : "s"} — numbered boxes on the screenshot match the list below.`}
            </p>
            {section.screenshot && (
              <AnnotatedScreenshot
                screenshot={section.screenshot}
                findings={section.findings}
                onBoxClick={id => document.getElementById(`finding-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}
              />
            )}
            {section.findings.length > 0 && (
              <div className="mt-4 space-y-3">
                {section.findings.map(f => (
                  <div key={f.id} id={`finding-${f.id}`} className="scroll-mt-6 rounded-xl border border-black/[0.06] bg-[#fafafa] p-4">
                    <div className="mb-1.5 flex flex-wrap items-center gap-2">
                      <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#0f0f0f] px-1 text-[10px] font-bold text-white">{f.index}</span>
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize ${SEVERITY_CLASS[f.severity]}`}>{f.severity}</span>
                      {f.viewport && (
                        <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-medium capitalize text-[#4b5563]">{f.viewport}</span>
                      )}
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-[#71717a]">{f.typeLabel}</span>
                      {typeof f.confidence === "number" && (
                        <span className="ml-auto rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-[#4b5563]" title="How confident Loupe is in the root-cause analysis">
                          {f.confidence}% confidence
                        </span>
                      )}
                    </div>

                    <p className="text-[13px] font-semibold text-[#17171c]">{f.headline}</p>
                    {f.measured && (
                      <p className="mt-1 text-[12px] leading-relaxed text-[#4b5563]">
                        {f.measured}.{f.expected ? ` Expected: ${f.expected.toLowerCase()}.` : ""}
                      </p>
                    )}
                    {f.why && (
                      <p className="mt-1 text-[12px] leading-relaxed text-[#71717a]">
                        <span className="font-medium text-[#4b5563]">Impact:</span> {f.why}
                      </p>
                    )}

                    {section.screenshot && typeof f.y === "number" && f.y < section.screenshot.height && (
                      <div className="mt-3">
                        <FocusedIssueView screenshot={section.screenshot} finding={f} />
                      </div>
                    )}

                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <div className="rounded-lg bg-white px-3 py-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-[#71717a]">Location</p>
                        <p className="mt-0.5 text-[11px] text-[#17171c]">{f.section ?? "Whole page"}</p>
                        <p className="mt-0.5 text-[11px] text-[#71717a]">{f.element}</p>
                      </div>
                      <div className="rounded-lg bg-white px-3 py-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-[#71717a]">Element</p>
                        {f.domPath && f.domPath.length > 1 ? (
                          <pre className="mt-0.5 overflow-x-auto font-mono text-[10px] leading-relaxed text-[#4b5563]">
                            {f.domPath.map((part, i) => (i === 0 ? part : `${"    ".repeat(i - 1)}└── ${part}`)).join("\n")}
                          </pre>
                        ) : (
                          <p className="mt-0.5 truncate font-mono text-[10px] text-[#4b5563]">{f.selector ?? f.element}</p>
                        )}
                      </div>
                    </div>

                    {f.rootCause && (
                      <div className="mt-2 rounded-lg bg-white px-3 py-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-[#71717a]">Root cause</p>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-[#17171c]">{f.rootCause}</p>
                        {f.cssHighlights && Object.keys(f.cssHighlights).length > 0 && (
                          <pre className="mt-2 overflow-x-auto rounded-md bg-[#fafafa] px-2.5 py-2 font-mono text-[10px] leading-relaxed text-[#4b5563]">
                            {Object.entries(f.cssHighlights).map(([prop, val]) => `${prop}: ${val};`).join("\n")}
                          </pre>
                        )}
                      </div>
                    )}

                    {f.fix && (
                      <div className="mt-2 rounded-lg border border-emerald-100 bg-emerald-50/60 px-3 py-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Suggested fix</p>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-emerald-900">{f.fix}</p>
                      </div>
                    )}

                    {f.selector && f.selector !== "document" && (
                      <p className="mt-2 truncate font-mono text-[10px] text-[#a1a1aa]">{f.selector}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        ))}

        <footer className="pb-6 text-center">
          <p className="text-[12px] text-[#71717a]">
            Generated with <Link href="/" className="font-semibold text-[#0f0f0f] hover:underline">Loupe</Link> — run your own scan free.
          </p>
        </footer>
      </div>
    </div>
  );
}
