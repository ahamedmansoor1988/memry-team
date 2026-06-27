import Link from "next/link";
import { Check, ArrowRight, Zap, Share2, History } from "lucide-react";
import { AnimatedPreview } from "./_components/AnimatedPreview";

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
            <img src="/loupe.svg" alt="Loupe" className="h-7 w-auto" />
          </div>
          <div className="flex items-center gap-6">
            <Link href="/pricing" className="text-[13px] text-[#4b5563] hover:text-[#0f0f0f] transition-colors">Pricing</Link>
            <Link href="/login" className="text-[13px] text-[#4b5563] hover:text-[#0f0f0f] transition-colors">Sign in</Link>
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
          <span className="text-[12px] text-[#3f3f46] font-medium">Free to start — no credit card needed</span>
        </div>

        <h1 className="text-[60px] font-normal text-[#0f0f0f] leading-[1.1] mb-5 max-w-3xl mx-auto font-[family-name:var(--font-serif)]">
          Catch design bugs<br />before they ship
        </h1>
        <p className="text-[18px] text-[#4b5563] leading-relaxed mb-10 max-w-xl mx-auto">
          Compare your Figma frames against the live site in one click. Loupe finds missing elements, wrong fonts, and color mismatches instantly.
        </p>

        <div className="flex items-center justify-center gap-3">
          <Link href="/login" className="flex items-center gap-2 rounded-xl bg-[#0f0f0f] px-6 py-3 text-[14px] font-medium text-white hover:bg-[#1a1a1a] transition-colors">
            Start for free <ArrowRight size={14} />
          </Link>
          <Link href="/pricing" className="flex items-center gap-2 rounded-xl border border-[#e8e8ec] px-6 py-3 text-[14px] font-medium text-[#3f3f46] hover:border-[#0f0f0f] hover:text-[#0f0f0f] transition-colors">
            See pricing
          </Link>
        </div>
      </section>

      {/* App preview mockup */}
      <section className="max-w-5xl mx-auto px-6 pb-20">
        <AnimatedPreview />
      </section>

      {/* What it checks */}
      <section className="border-t border-[#f5f5f7] py-16">
        <div className="max-w-6xl mx-auto px-6 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-[#71717a] mb-3">What Loupe checks</p>
          <h2 className="text-[32px] font-semibold text-[#0f0f0f] mb-10">Every pixel. Every run.</h2>
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
          <p className="text-[11px] font-semibold uppercase tracking-widest text-[#71717a] mb-3 text-center">How it works</p>
          <h2 className="text-[32px] font-semibold text-[#0f0f0f] mb-12 text-center">From Figma to QA in 60 seconds</h2>
          <div className="grid grid-cols-3 gap-10">
            {HOW.map(h => (
              <div key={h.step} className="space-y-3">
                <span className="text-[11px] font-semibold text-[#d0d0d8] font-mono">{h.step}</span>
                <h3 className="text-[17px] font-semibold text-[#0f0f0f] leading-snug">{h.title}</h3>
                <p className="text-[13px] text-[#4b5563] leading-relaxed">{h.desc}</p>
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
                <f.icon size={16} className="text-[#3f3f46]" />
              </div>
              <h3 className="text-[15px] font-semibold text-[#0f0f0f]">{f.title}</h3>
              <p className="text-[13px] text-[#4b5563] leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-[#f5f5f7] py-16">
        <div className="max-w-6xl mx-auto px-6">
          <div className="rounded-2xl bg-[#0f0f0f] px-12 py-14 text-center">
            <h2 className="text-[32px] font-semibold text-white mb-4">Start catching bugs today</h2>
            <p className="text-[15px] text-[#71717a] mb-8 max-w-md mx-auto">Free forever for individuals. No credit card required.</p>
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
            <img src="/loupe.svg" alt="Loupe" className="h-6 w-auto" />
          </div>
          <div className="flex items-center gap-6">
            <Link href="/pricing" className="text-[12px] text-[#71717a] hover:text-[#0f0f0f] transition-colors">Pricing</Link>
            <Link href="/terms" className="text-[12px] text-[#71717a] hover:text-[#0f0f0f] transition-colors">Terms</Link>
            <Link href="/privacy" className="text-[12px] text-[#71717a] hover:text-[#0f0f0f] transition-colors">Privacy</Link>
            <Link href="/login" className="text-[12px] text-[#71717a] hover:text-[#0f0f0f] transition-colors">Sign in</Link>
          </div>
          <p className="text-[12px] text-[#a1a1aa]">© 2026 Loupe</p>
        </div>
      </footer>

    </div>
  );
}
