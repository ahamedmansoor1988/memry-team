import Link from "next/link";
import { Check, ArrowRight } from "lucide-react";
import { CreditTierPicker } from "./CreditTierPicker";

const FREE_FEATURES = [
  "100 free credits — 14 days to use them",
  "Figma vs Live",
  "Brand Check",
  "Accessibility QA",
  "Responsive Check",
  "Chrome extension",
  "Shareable result links",
];

const PRO_FEATURES = [
  "Scan credits, valid for 3 months — buy more anytime",
  "Figma vs Live",
  "Brand Check",
  "Accessibility QA",
  "Responsive Check",
  "Chrome extension",
  "Publish results to Figma comments",
  "Full run history",
  "Shareable result links",
  "Priority support",
];

const FAQ = [
  {
    q: "What counts as a run?",
    a: "A run is one scan — a Figma vs Live comparison, a Brand Check, an Accessibility scan, or a Responsive Check. Every time you click run or the extension triggers a scan, that's one credit used.",
  },
  {
    q: "What happens after the 14-day free trial?",
    a: "Your account stays open, but scans pause once your 100 free credits or the 14-day window run out, whichever comes first. Buy a credit pack to keep going — nothing you've already run gets deleted.",
  },
  {
    q: "Is this a subscription?",
    a: "No — it's a one-time purchase of a credit pack. There's no auto-renewal and nothing recurring; buy another pack whenever you run low.",
  },
  {
    q: "Do credits expire?",
    a: "Yes. Free trial credits are valid for 14 days from signup. Purchased credit packs are valid for 3 months from the date you buy them. If you have more than one batch, each has its own clock, and the credits closest to expiring are always used first.",
  },
  {
    q: "What if I change my mind?",
    a: "Email hello@useloupe.io within 14 days of buying and we'll refund any credits you haven't spent — no explanation needed. Credits you've already used on scans aren't refundable, since those scans have already run.",
  },
  {
    q: "Do I need a Figma paid plan?",
    a: "No. Loupe works with any Figma account including the free tier. You just need a personal access token, which any Figma account can generate.",
  },
  {
    q: "What is the Chrome extension for?",
    a: "The extension captures real computed styles (fonts, colors) from the live page inside your browser — the only way to get accurate font data including Google Fonts.",
  },
  {
    q: "Can I share results without the recipient logging in?",
    a: "Yes. Every run generates a public shareable link. Anyone with the link can view the results — no account needed.",
  },
];

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-white font-[family-name:var(--font-sans)]">

      {/* Nav */}
      <header className="border-b border-black/[0.06]">
        <nav className="max-w-6xl mx-auto px-6 h-[52px] flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <img src="/loupe.svg" alt="Loupe" className="h-7 w-auto" />
          </Link>
          <div className="flex items-center gap-6">
            <Link href="/pricing" className="text-[13px] text-[#0f0f0f] font-medium">Pricing</Link>
            <Link href="/login" className="text-[13px] text-[#4b5563] hover:text-[#0f0f0f] transition-colors">Sign in</Link>
            <Link href="/login" className="rounded-lg bg-[#0f0f0f] px-3.5 py-1.5 text-[13px] font-medium text-white hover:bg-[#1a1a1a] transition-colors">
              Get started free
            </Link>
          </div>
        </nav>
      </header>

      {/* Header */}
      <section className="max-w-6xl mx-auto px-6 pt-16 pb-10 text-center">
        <h1 className="text-[52px] font-normal text-[#0f0f0f] leading-tight mb-4 font-[family-name:var(--font-serif)]">
          Pay for what you ship,<br />not what you try
        </h1>
        <p className="text-[17px] text-[#4b5563] max-w-lg mx-auto">
          Start with 100 free credits for 14 days. Buy a credit pack — one-time, no subscription — when you need more scans.
        </p>
      </section>

      {/* Plans */}
      <section className="max-w-3xl mx-auto px-6 pb-20">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          {/* Free */}
          <div className="rounded-2xl border border-[#f0f0f0] bg-white p-6 flex flex-col">
            <div className="mb-6">
              <div className="mb-3">
                <span className="text-[13px] font-semibold text-[#0f0f0f]">Free trial</span>
              </div>
              <div className="flex items-baseline gap-1 mb-2">
                <span className="text-[38px] font-semibold tracking-tight text-[#0f0f0f]">$0</span>
                <span className="text-[13px] text-[#71717a]">/ 14 days</span>
              </div>
              <p className="text-[13px] leading-relaxed text-[#4b5563]">
                100 free credits to try every check — no credit card needed.
              </p>
            </div>

            <Link
              href="/login"
              className="flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-medium mb-6 transition-colors bg-[#0f0f0f] text-white hover:bg-[#1a1a1a]"
            >
              Get started <ArrowRight size={13} />
            </Link>

            <div className="space-y-2.5 flex-1">
              {FREE_FEATURES.map(f => (
                <div key={f} className="flex items-start gap-2.5">
                  <Check size={13} className="mt-0.5 shrink-0 text-emerald-500" />
                  <span className="text-[13px] text-[#3f3f46]">{f}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Pro */}
          <div className="rounded-2xl border border-[#0f0f0f] bg-[#0f0f0f] text-white p-6 flex flex-col">
            <div className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[13px] font-semibold text-white">Pro</span>
                <span className="rounded-full px-2.5 py-0.5 text-[10px] font-semibold text-white" style={{ background: "linear-gradient(90deg, #a855f7, #ec4899, #f97316)" }}>
                  Most popular
                </span>
              </div>
            </div>

            <CreditTierPicker />

            <div className="space-y-2.5 flex-1">
              {PRO_FEATURES.map(f => (
                <div key={f} className="flex items-start gap-2.5">
                  <Check size={13} className="mt-0.5 shrink-0 text-emerald-400" />
                  <span className="text-[13px] text-white/80">{f}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Compare at a glance */}
      <section className="border-t border-[#f5f5f7] py-16">
        <div className="max-w-3xl mx-auto px-6">
          <h2 className="text-[24px] font-semibold text-[#0f0f0f] mb-8 text-center">Compare plans</h2>
          <div className="rounded-2xl border border-[#f0f0f0] overflow-x-auto">
            <table className="w-full min-w-[480px] text-[13px]">
              <thead>
                <tr className="border-b border-[#f0f0f0] bg-[#fafafa]">
                  <th className="px-5 py-3 text-left font-medium text-[#71717a]">Feature</th>
                  <th className="px-5 py-3 text-center font-medium text-[#71717a]">Free trial</th>
                  <th className="px-5 py-3 text-center font-medium text-[#0f0f0f]">Pro</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["Runs",                 "100 credits, 14 days", "250–5,000 credit packs"],
                  ["Figma vs Live",        "✓",                   "✓"],
                  ["Brand Check",          "✓",                   "✓"],
                  ["Accessibility QA",     "✓",                   "✓"],
                  ["Responsive Check",     "✓",                   "✓"],
                  ["Chrome extension",     "✓",                   "✓"],
                  ["Share links",          "✓",                   "✓"],
                  ["Run history",          "7 days",              "Full"],
                  ["Publish to Figma comments", "—",              "✓"],
                  ["Priority support",     "—",                   "✓"],
                ].map(([feature, free, pro], i) => (
                  <tr key={feature} className={`border-b border-[#f7f7f8] last:border-0 ${i % 2 === 0 ? "" : "bg-[#fafafa]/50"}`}>
                    <td className="px-5 py-3 text-[#17171c] font-medium">{feature}</td>
                    <td className="px-5 py-3 text-center text-[#71717a]">{free}</td>
                    <td className="px-5 py-3 text-center text-[#0f0f0f] font-medium">{pro}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="border-t border-[#f5f5f7] py-16">
        <div className="max-w-2xl mx-auto px-6">
          <h2 className="text-[24px] font-semibold text-[#0f0f0f] mb-8 text-center">Frequently asked</h2>
          <div className="space-y-6">
            {FAQ.map(({ q, a }) => (
              <div key={q} className="border-b border-[#f5f5f7] pb-6 last:border-0">
                <p className="text-[14px] font-semibold text-[#0f0f0f] mb-2">{q}</p>
                <p className="text-[13px] text-[#4b5563] leading-relaxed">{a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-[#f5f5f7] py-16">
        <div className="max-w-6xl mx-auto px-6">
          <div className="rounded-2xl bg-[#0f0f0f] px-12 py-14 text-center">
            <h2 className="text-[28px] font-semibold text-white mb-3">Start for free today</h2>
            <p className="text-[14px] text-[#71717a] mb-7">No credit card. 100 free credits, 14 days to use them.</p>
            <Link href="/login" className="inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3 text-[13px] font-semibold text-[#0f0f0f] hover:bg-[#f5f5f5] transition-colors">
              Get started free <ArrowRight size={13} />
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[#f5f5f7] py-8">
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <img src="/loupe.svg" alt="Loupe" className="h-6 w-auto" />
          </Link>
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
