import Link from "next/link";

export const metadata = {
  title: "Terms of Service — Loupe",
  description: "Terms of Service for Loupe design QA tool.",
};

const EFFECTIVE = "27 June 2026";

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white font-[family-name:var(--font-sans)]">
      {/* Nav */}
      <header className="border-b border-black/[0.06]">
        <nav className="max-w-6xl mx-auto px-6 h-[52px] flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <img src="/loupe.svg" alt="Loupe" className="h-7 w-auto" />
          </Link>
          <div className="flex items-center gap-6">
            <Link href="/pricing" className="text-[13px] text-[#6b7280] hover:text-[#0f0f0f] transition-colors">Pricing</Link>
            <Link href="/login" className="text-[13px] text-[#6b7280] hover:text-[#0f0f0f] transition-colors">Sign in</Link>
          </div>
        </nav>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-16">
        <p className="text-[12px] text-[#9a9aa5] mb-2">Effective {EFFECTIVE}</p>
        <h1 className="text-[32px] font-semibold text-[#0f0f0f] mb-2 font-[family-name:var(--font-serif)]">Terms of Service</h1>
        <p className="text-[14px] text-[#6b7280] mb-10">Please read these terms carefully before using Loupe.</p>

        <div className="prose prose-sm max-w-none space-y-8 text-[14px] text-[#374151] leading-relaxed">

          <section className="space-y-3">
            <h2 className="text-[17px] font-semibold text-[#0f0f0f]">1. Acceptance of terms</h2>
            <p>By accessing or using Loupe ("the Service"), you agree to be bound by these Terms of Service. If you do not agree, do not use the Service.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-[17px] font-semibold text-[#0f0f0f]">2. What Loupe is</h2>
            <p>Loupe is a design QA tool that compares Figma design frames against live websites and surfaces visual discrepancies. It is provided as a web application and Chrome browser extension.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-[17px] font-semibold text-[#0f0f0f]">3. Your account</h2>
            <p>You must provide accurate information when creating an account. You are responsible for all activity that occurs under your account. You must notify us immediately of any unauthorised use.</p>
            <p>You must be at least 16 years old to use the Service.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-[17px] font-semibold text-[#0f0f0f]">4. Acceptable use</h2>
            <p>You agree not to:</p>
            <ul className="list-disc pl-5 space-y-1.5 text-[#5b5b66]">
              <li>Use the Service to scan websites you do not own or have explicit permission to scan</li>
              <li>Attempt to reverse-engineer, copy, or resell the Service</li>
              <li>Use the Service in a way that violates any applicable law or regulation</li>
              <li>Abuse free tier limits through multiple accounts or automated sign-ups</li>
              <li>Interfere with or disrupt the Service or servers connected to it</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-[17px] font-semibold text-[#0f0f0f]">5. Figma credentials</h2>
            <p>To use certain features you provide a Figma personal access token. This token is stored locally in your browser and transmitted only to the Figma API on your behalf. We do not store your Figma token on our servers.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-[17px] font-semibold text-[#0f0f0f]">6. Plans and billing</h2>
            <p>The Free plan is available at no cost subject to usage limits. Paid plans (Pro, Team) are billed monthly. You may cancel at any time and your access continues until the end of the billing period. We do not offer refunds for partial months.</p>
            <p>We reserve the right to change pricing with 30 days' notice to active subscribers.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-[17px] font-semibold text-[#0f0f0f]">7. Intellectual property</h2>
            <p>Loupe and all related trademarks, logos, and software are owned by us. Your data (Figma URLs, scan results, run history) remains yours. You grant us a limited licence to process your data solely to provide the Service.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-[17px] font-semibold text-[#0f0f0f]">8. Third-party services</h2>
            <p>The Service integrates with third-party services including Figma, Groq AI, Supabase, and Vercel. Your use of those services is governed by their respective terms. We are not responsible for the availability or actions of third-party services.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-[17px] font-semibold text-[#0f0f0f]">9. Disclaimers</h2>
            <p>The Service is provided "as is" without warranties of any kind. We do not warrant that the Service will be uninterrupted, error-free, or that design comparison results will be 100% accurate. Design QA results are provided as a guide and should be reviewed by a human before acting on them.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-[17px] font-semibold text-[#0f0f0f]">10. Limitation of liability</h2>
            <p>To the maximum extent permitted by law, Loupe shall not be liable for any indirect, incidental, special, or consequential damages arising from your use of the Service. Our total liability to you shall not exceed the amount you paid us in the 3 months preceding the claim.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-[17px] font-semibold text-[#0f0f0f]">11. Termination</h2>
            <p>We may suspend or terminate your account if you violate these Terms. You may delete your account at any time from your account settings. Upon termination, your data will be deleted within 30 days.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-[17px] font-semibold text-[#0f0f0f]">12. Changes to these terms</h2>
            <p>We may update these Terms from time to time. We will notify you of material changes by email or in-app notice at least 14 days before they take effect. Continued use of the Service constitutes acceptance of the updated terms.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-[17px] font-semibold text-[#0f0f0f]">13. Contact</h2>
            <p>Questions about these Terms? Email us at <a href="mailto:hello@useloupe.io" className="text-[#0f0f0f] underline underline-offset-2">hello@useloupe.io</a>.</p>
          </section>

        </div>

        <div className="mt-12 pt-8 border-t border-[#f5f5f7] flex gap-6">
          <Link href="/privacy" className="text-[13px] text-[#9a9aa5] hover:text-[#0f0f0f] transition-colors">Privacy Policy</Link>
          <Link href="/" className="text-[13px] text-[#9a9aa5] hover:text-[#0f0f0f] transition-colors">← Back to home</Link>
        </div>
      </main>
    </div>
  );
}
