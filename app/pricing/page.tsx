import Link from "next/link";
import { Check, ArrowRight } from "lucide-react";

export const metadata = {
  title: "Pricing — Loupe",
  description: "Simple, transparent pricing for design QA. Free to start.",
};

const PLANS = [
  {
    name: "Free",
    price: "$0",
    period: "forever",
    desc: "For individuals trying it out.",
    cta: "Get started",
    ctaHref: "/login",
    highlight: false,
    features: [
      "10 runs / month",
      "1 project",
      "Font, color & missing element checks",
      "Run history (7 days)",
      "Shareable result links",
      "Chrome extension",
    ],
    missing: [
      "Scheduled runs",
      "Slack notifications",
      "Team seats",
      "Priority support",
    ],
  },
  {
    name: "Pro",
    price: "$19",
    period: "per month",
    desc: "For freelancers and solo designers who ship fast.",
    cta: "Start Pro",
    ctaHref: "/login",
    highlight: true,
    features: [
      "Unlimited runs",
      "5 projects",
      "All checks (fonts, color, spacing, buttons, footer)",
      "Full run history",
      "Shareable result links",
      "Chrome extension",
      "Publish to Figma comments",
      "Priority support",
    ],
    missing: [
      "Team seats",
      "Slack notifications",
      "Scheduled runs",
    ],
  },
  {
    name: "Team",
    price: "$49",
    period: "per month",
    desc: "For design and frontend teams who want zero regressions.",
    cta: "Start Team",
    ctaHref: "/login",
    highlight: false,
    features: [
      "Everything in Pro",
      "5 team seats",
      "Unlimited projects",
      "Scheduled runs (daily / weekly)",
      "Slack notifications",
      "Email digest on new issues",
      "Priority support",
    ],
    missing: [],
  },
];

const FAQ = [
  {
    q: "What counts as a run?",
    a: "A run is one Figma vs Live comparison. Every time you click 'Run comparison' or the extension triggers a scan, that's one run.",
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
  {
    q: "Can I cancel anytime?",
    a: "Yes. No contracts, no commitments. Cancel from your account settings and you won't be charged again.",
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
            <Link href="/login" className="text-[13px] text-[#6b7280] hover:text-[#0f0f0f] transition-colors">Sign in</Link>
            <Link href="/login" className="rounded-lg bg-[#0f0f0f] px-3.5 py-1.5 text-[13px] font-medium text-white hover:bg-[#1a1a1a] transition-colors">
              Get started free
            </Link>
          </div>
        </nav>
      </header>

      {/* Header */}
      <section className="max-w-6xl mx-auto px-6 pt-16 pb-12 text-center">
        <h1 className="text-[52px] font-normal text-[#0f0f0f] leading-tight mb-4 font-[family-name:var(--font-serif)]">
          Pay for what you ship,<br />not what you try
        </h1>
        <p className="text-[17px] text-[#6b7280] max-w-lg mx-auto">
          Start free with no limits on time. Upgrade when your team grows or your projects do.
        </p>
      </section>

      {/* Plans */}
      <section className="max-w-5xl mx-auto px-6 pb-20">
        <div className="grid grid-cols-3 gap-5">
          {PLANS.map(plan => (
            <div
              key={plan.name}
              className={`rounded-2xl border p-6 flex flex-col ${
                plan.highlight
                  ? "border-[#0f0f0f] bg-[#0f0f0f] text-white"
                  : "border-[#f0f0f0] bg-white"
              }`}
            >
              {/* Plan header */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-3">
                  <span className={`text-[13px] font-semibold ${plan.highlight ? "text-white" : "text-[#0f0f0f]"}`}>
                    {plan.name}
                  </span>
                  {plan.highlight && (
                    <span className="rounded-full px-2.5 py-0.5 text-[10px] font-semibold text-white" style={{ background: "linear-gradient(90deg, #a855f7, #ec4899, #f97316)" }}>
                      Most popular
                    </span>
                  )}
                </div>
                <div className="flex items-baseline gap-1 mb-2">
                  <span className={`text-[38px] font-semibold tracking-tight ${plan.highlight ? "text-white" : "text-[#0f0f0f]"}`}>
                    {plan.price}
                  </span>
                  <span className={`text-[13px] ${plan.highlight ? "text-white/50" : "text-[#9a9aa5]"}`}>
                    /{plan.period}
                  </span>
                </div>
                <p className={`text-[13px] leading-relaxed ${plan.highlight ? "text-white/60" : "text-[#6b7280]"}`}>
                  {plan.desc}
                </p>
              </div>

              {/* CTA */}
              <Link
                href={plan.ctaHref}
                className={`flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-medium mb-6 transition-colors ${
                  plan.highlight
                    ? "bg-white text-[#0f0f0f] hover:bg-[#f5f5f5]"
                    : "bg-[#0f0f0f] text-white hover:bg-[#1a1a1a]"
                }`}
              >
                {plan.cta} <ArrowRight size={13} />
              </Link>

              {/* Features */}
              <div className="space-y-2.5 flex-1">
                {plan.features.map(f => (
                  <div key={f} className="flex items-start gap-2.5">
                    <Check size={13} className={`mt-0.5 shrink-0 ${plan.highlight ? "text-emerald-400" : "text-emerald-500"}`} />
                    <span className={`text-[13px] ${plan.highlight ? "text-white/80" : "text-[#5b5b66]"}`}>{f}</span>
                  </div>
                ))}
                {plan.missing.map(f => (
                  <div key={f} className="flex items-start gap-2.5 opacity-30">
                    <div className="mt-0.5 shrink-0 h-[13px] w-[13px] flex items-center justify-center">
                      <div className={`h-px w-2.5 ${plan.highlight ? "bg-white" : "bg-[#9a9aa5]"}`} />
                    </div>
                    <span className={`text-[13px] ${plan.highlight ? "text-white" : "text-[#9a9aa5]"}`}>{f}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Compare at a glance */}
      <section className="border-t border-[#f5f5f7] py-16">
        <div className="max-w-4xl mx-auto px-6">
          <h2 className="text-[24px] font-semibold text-[#0f0f0f] mb-8 text-center">Compare plans</h2>
          <div className="rounded-2xl border border-[#f0f0f0] overflow-hidden">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-[#f0f0f0] bg-[#fafafa]">
                  <th className="px-5 py-3 text-left font-medium text-[#9a9aa5]">Feature</th>
                  <th className="px-5 py-3 text-center font-medium text-[#9a9aa5]">Free</th>
                  <th className="px-5 py-3 text-center font-medium text-[#0f0f0f]">Pro</th>
                  <th className="px-5 py-3 text-center font-medium text-[#9a9aa5]">Team</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["Runs per month",       "10",        "Unlimited",  "Unlimited"],
                  ["Projects",            "1",         "5",          "Unlimited"],
                  ["Run history",         "7 days",    "Full",       "Full"],
                  ["Share links",         "✓",         "✓",          "✓"],
                  ["All check types",     "—",         "✓",          "✓"],
                  ["Figma comments",      "—",         "✓",          "✓"],
                  ["Team seats",          "1",         "1",          "5"],
                  ["Scheduled runs",      "—",         "—",          "✓"],
                  ["Slack notifications", "—",         "—",          "✓"],
                ].map(([feature, free, pro, team], i) => (
                  <tr key={feature} className={`border-b border-[#f7f7f8] last:border-0 ${i % 2 === 0 ? "" : "bg-[#fafafa]/50"}`}>
                    <td className="px-5 py-3 text-[#17171c] font-medium">{feature}</td>
                    <td className="px-5 py-3 text-center text-[#9a9aa5]">{free}</td>
                    <td className="px-5 py-3 text-center text-[#0f0f0f] font-medium">{pro}</td>
                    <td className="px-5 py-3 text-center text-[#9a9aa5]">{team}</td>
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
                <p className="text-[13px] text-[#6b7280] leading-relaxed">{a}</p>
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
            <p className="text-[14px] text-[#9a9aa5] mb-7">No credit card. No setup. Just install the extension and run.</p>
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
            <Link href="/pricing" className="text-[12px] text-[#9a9aa5] hover:text-[#0f0f0f] transition-colors">Pricing</Link>
            <Link href="/terms" className="text-[12px] text-[#9a9aa5] hover:text-[#0f0f0f] transition-colors">Terms</Link>
            <Link href="/privacy" className="text-[12px] text-[#9a9aa5] hover:text-[#0f0f0f] transition-colors">Privacy</Link>
            <Link href="/login" className="text-[12px] text-[#9a9aa5] hover:text-[#0f0f0f] transition-colors">Sign in</Link>
          </div>
          <p className="text-[12px] text-[#c8c8d0]">© 2026 Loupe</p>
        </div>
      </footer>

    </div>
  );
}
