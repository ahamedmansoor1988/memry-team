import Link from "next/link";
import { Check, ArrowRight, ScanSearch, Zap, Share2, History } from "lucide-react";

export const metadata = {
  title: "Loupe — Figma vs Live Design QA",
  description: "Catch design bugs before they ship. Compare your Figma frames against the live site in one click.",
};

const CHECKS = [
  "Missing elements",
  "Font family",
  "Font size",
  "Font weight",
  "Color",
  "Spacing",
];

const HOW = [
  {
    step: "01",
    title: "Install the extension",
    desc: "The Loupe Chrome extension captures real computed styles from any live page — fonts, colors, and layout — exactly as Chrome renders them.",
  },
  {
    step: "02",
    title: "Point it at your Figma frame",
    desc: "Paste your Figma frame URL and personal access token. Loupe caches the design data so you never hit Figma API rate limits again.",
  },
  {
    step: "03",
    title: "Run. Get results instantly.",
    desc: "Loupe compares both sides with AI and surfaces every discrepancy — missing elements, wrong fonts, off colors — in a clean table.",
  },
];

const FEATURES = [
  {
    icon: Zap,
    title: "Zero Figma API calls on re-runs",
    desc: "Loupe caches your design snapshot. Every re-scan is instant with no rate limit risk.",
  },
  {
    icon: Share2,
    title: "Share results with anyone",
    desc: "Every run gets a public link. Send it to your designer or PM — no login required to view.",
  },
  {
    icon: History,
    title: "Full run history",
    desc: "Every comparison is saved. Track regressions and see what changed between runs.",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white font-[family-name:var(--font-sans)]">

      {/* Nav */}
      <header className="border-b border-black/[0.06]">
        <nav className="max-w-6xl mx-auto px-6 h-[52px] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-[#0f0f0f]">
              <span className="text-[11px] font-bold text-white">L</span>
            </div>
            <span className="text-[15px] font-semibold text-[#0f0f0f]">Loupe</span>
          </div>
          <div className="flex items-center gap-6">
            <Link href="/pricing" className="text-[13px] text-[#6b7280] hover:text-[#0f0f0f] transition-colors">Pricing</Link>
            <Link href="/login" className="text-[13px] text-[#6b7280] hover:text-[#0f0f0f] transition-colors">Sign in</Link>
            <Link href="/login" className="rounded-lg bg-[#0f0f0f] px-3.5 py-1.5 text-[13px] font-medium text-white hover:bg-[#1a1a1a] transition-colors">
              Get started free
            </Link>
          </div>
        </nav>
      </header>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 pt-20 pb-16 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-[#f0f0f0] bg-[#fafafa] px-3.5 py-1.5 mb-8">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          <span className="text-[12px] text-[#5b5b66] font-medium">Free to start — no credit card needed</span>
        </div>

        <h1 className="text-[52px] font-semibold tracking-tight text-[#0f0f0f] leading-[1.1] mb-5 max-w-3xl mx-auto">
          Catch design bugs<br />before they ship
        </h1>
        <p className="text-[18px] text-[#6b7280] leading-relaxed mb-10 max-w-xl mx-auto">
          Compare your Figma frames against the live site in one click. Loupe finds missing elements, wrong fonts, and color mismatches instantly.
        </p>

        <div className="flex items-center justify-center gap-3">
          <Link href="/login" className="flex items-center gap-2 rounded-xl bg-[#0f0f0f] px-6 py-3 text-[14px] font-medium text-white hover:bg-[#1a1a1a] transition-colors">
            Start for free <ArrowRight size={14} />
          </Link>
          <Link href="/pricing" className="flex items-center gap-2 rounded-xl border border-[#e8e8ec] px-6 py-3 text-[14px] font-medium text-[#5b5b66] hover:border-[#0f0f0f] hover:text-[#0f0f0f] transition-colors">
            See pricing
          </Link>
        </div>
      </section>

      {/* App preview mockup */}
      <section className="max-w-5xl mx-auto px-6 pb-20">
        <div className="rounded-2xl border border-[#e8e8ec] bg-[#fafafa] overflow-hidden shadow-sm">
          <div className="border-b border-[#f0f0f0] bg-white px-5 h-[45px] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ScanSearch size={13} className="text-[#9a9aa5]" />
              <span className="text-[13px] font-medium text-[#17171c]">Figma vs Live</span>
              <span className="rounded-full bg-[#f0f0f0] px-2 py-0.5 text-[10px] font-medium text-[#9a9aa5]">Design QA</span>
            </div>
            <span className="rounded-full bg-[#e8f6ee] px-2.5 py-1 text-[11px] font-medium text-[#1a9457]">9 nodes · depth=5</span>
          </div>
          <div className="flex min-h-[260px]">
            <div className="w-[38%] border-r border-[#f0f0f0] px-5 py-4 space-y-2">
              <p className="text-[9px] font-semibold uppercase tracking-widest text-[#d0d0d8] mb-3">Steps</p>
              {[
                "Extension captured 112 live styles from real Chrome.",
                "Snapshot loaded — 9 nodes. Zero Figma API calls.",
                "[NO MATCH] figma=\"Solutions\"",
                "[NO MATCH] figma=\"Pricing\"",
                "Sending to Groq AI — checking: missing elements, color…",
                "AI identified 2 discrepancies.",
              ].map((t, i) => (
                <div key={i} className="flex items-start gap-2 text-[11px] text-[#9a9aa5]">
                  <span className="text-[#d0d0d8] shrink-0 mt-0.5">›</span>{t}
                </div>
              ))}
            </div>
            <div className="flex-1 px-5 py-4">
              <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 mb-4 flex items-center gap-3">
                <div className="h-4 w-4 rounded-full border-2 border-emerald-500 flex items-center justify-center shrink-0">
                  <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                </div>
                <div>
                  <p className="text-[13px] font-semibold text-emerald-800">8 issues found</p>
                  <p className="text-[11px] text-emerald-600">6 missing, 2 color</p>
                </div>
              </div>
              <div className="rounded-xl border border-[#f0f0f0] overflow-hidden">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="bg-[#fafafa] border-b border-[#f0f0f0]">
                      <th className="px-3 py-2 text-left text-[#9a9aa5] font-medium">#</th>
                      <th className="px-3 py-2 text-left text-[#9a9aa5] font-medium">Element</th>
                      <th className="px-3 py-2 text-left text-[#9a9aa5] font-medium">Type</th>
                      <th className="px-3 py-2 text-left text-[#9a9aa5] font-medium">Issue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { el: "Solutions", type: "Missing", bg: "#fef2f2", c: "#dc2626", issue: "Missing on live page" },
                      { el: "Pricing",   type: "Missing", bg: "#fef2f2", c: "#dc2626", issue: "Missing on live page" },
                      { el: "Book a demo", type: "Color", bg: "#fdf2f8", c: "#db2777", issue: "Figma: #030407 → #FCFCFD" },
                    ].map((row, i) => (
                      <tr key={i} className="border-b border-[#f7f7f8] last:border-0">
                        <td className="px-3 py-2 text-[#c8c8d0]">{i + 1}</td>
                        <td className="px-3 py-2 font-semibold text-[#17171c]">{row.el}</td>
                        <td className="px-3 py-2">
                          <span style={{ backgroundColor: row.bg, color: row.c }} className="rounded-full px-2 py-0.5 text-[10px] font-medium">{row.type}</span>
                        </td>
                        <td className="px-3 py-2 text-[#5b5b66]">{row.issue}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* What it checks */}
      <section className="border-t border-[#f5f5f7] py-16">
        <div className="max-w-6xl mx-auto px-6 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-[#9a9aa5] mb-3">What Loupe checks</p>
          <h2 className="text-[32px] font-semibold text-[#0f0f0f] tracking-tight mb-10">Every pixel. Every run.</h2>
          <div className="flex flex-wrap justify-center gap-3">
            {CHECKS.map(c => (
              <div key={c} className="flex items-center gap-2 rounded-full border border-[#f0f0f0] bg-white px-4 py-2">
                <Check size={12} className="text-emerald-500" />
                <span className="text-[13px] text-[#17171c] font-medium">{c}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-[#f5f5f7] py-16">
        <div className="max-w-6xl mx-auto px-6">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-[#9a9aa5] mb-3 text-center">How it works</p>
          <h2 className="text-[32px] font-semibold text-[#0f0f0f] tracking-tight mb-12 text-center">From Figma to QA in 60 seconds</h2>
          <div className="grid grid-cols-3 gap-10">
            {HOW.map(h => (
              <div key={h.step} className="space-y-3">
                <span className="text-[11px] font-semibold text-[#d0d0d8] font-mono">{h.step}</span>
                <h3 className="text-[17px] font-semibold text-[#0f0f0f] leading-snug">{h.title}</h3>
                <p className="text-[13px] text-[#6b7280] leading-relaxed">{h.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-t border-[#f5f5f7] py-16">
        <div className="max-w-6xl mx-auto px-6 grid grid-cols-3 gap-6">
          {FEATURES.map(f => (
            <div key={f.title} className="rounded-2xl border border-[#f0f0f0] p-5 space-y-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#f5f5f7]">
                <f.icon size={16} className="text-[#5b5b66]" />
              </div>
              <h3 className="text-[15px] font-semibold text-[#0f0f0f]">{f.title}</h3>
              <p className="text-[13px] text-[#6b7280] leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-[#f5f5f7] py-16">
        <div className="max-w-6xl mx-auto px-6">
          <div className="rounded-2xl bg-[#0f0f0f] px-12 py-14 text-center">
            <h2 className="text-[32px] font-semibold text-white tracking-tight mb-4">Start catching bugs today</h2>
            <p className="text-[15px] text-[#9a9aa5] mb-8 max-w-md mx-auto">Free forever for individuals. No credit card required.</p>
            <Link href="/login" className="inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3 text-[14px] font-semibold text-[#0f0f0f] hover:bg-[#f5f5f5] transition-colors">
              Get started free <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[#f5f5f7] py-8">
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-5 w-5 items-center justify-center rounded bg-[#0f0f0f]">
              <span className="text-[10px] font-bold text-white">L</span>
            </div>
            <span className="text-[13px] font-semibold text-[#0f0f0f]">Loupe</span>
          </div>
          <div className="flex items-center gap-6">
            <Link href="/pricing" className="text-[12px] text-[#9a9aa5] hover:text-[#0f0f0f] transition-colors">Pricing</Link>
            <Link href="/login" className="text-[12px] text-[#9a9aa5] hover:text-[#0f0f0f] transition-colors">Sign in</Link>
          </div>
          <p className="text-[12px] text-[#c8c8d0]">© 2026 Loupe</p>
        </div>
      </footer>

    </div>
  );
}
