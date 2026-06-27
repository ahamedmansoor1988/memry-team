import Link from "next/link";

export const metadata = {
  title: "Privacy Policy — Loupe",
  description: "Privacy Policy for Loupe design QA tool.",
};

const EFFECTIVE = "27 June 2026";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white font-[family-name:var(--font-sans)]">
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
        <h1 className="text-[32px] font-semibold text-[#0f0f0f] mb-2 font-[family-name:var(--font-serif)]">Privacy Policy</h1>
        <p className="text-[14px] text-[#6b7280] mb-10">We keep this simple and plain-English. We do not sell your data.</p>

        <div className="space-y-8 text-[14px] text-[#374151] leading-relaxed">

          <section className="space-y-3">
            <h2 className="text-[17px] font-semibold text-[#0f0f0f]">1. What data we collect</h2>
            <div className="rounded-xl border border-[#f0f0f0] overflow-hidden">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="bg-[#fafafa] border-b border-[#f0f0f0]">
                    <th className="px-4 py-2.5 text-left font-medium text-[#9a9aa5]">Data</th>
                    <th className="px-4 py-2.5 text-left font-medium text-[#9a9aa5]">Why</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["Email address", "Account creation and login"],
                    ["Figma frame URLs", "To identify which design to compare"],
                    ["Live site URLs", "To identify which page to compare against"],
                    ["Scan results (issues found)", "To show run history and share links"],
                    ["Figma design node data", "Cached to avoid repeated Figma API calls"],
                    ["Live page styles", "Captured by the Chrome extension for comparison"],
                  ].map(([data, why]) => (
                    <tr key={data} className="border-b border-[#f7f7f8] last:border-0">
                      <td className="px-4 py-2.5 font-medium text-[#17171c]">{data}</td>
                      <td className="px-4 py-2.5 text-[#6b7280]">{why}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[#6b7280]">We do <strong className="text-[#0f0f0f]">not</strong> collect your Figma personal access token — it is stored only in your browser&apos;s localStorage and never sent to our servers.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-[17px] font-semibold text-[#0f0f0f]">2. How we use your data</h2>
            <ul className="list-disc pl-5 space-y-1.5 text-[#5b5b66]">
              <li>To provide and improve the Service</li>
              <li>To display your run history and results</li>
              <li>To generate shareable public report links</li>
              <li>To send transactional emails (account, billing)</li>
              <li>To respond to support requests</li>
            </ul>
            <p>We do not use your data for advertising. We do not sell or share your data with third parties except as described below.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-[17px] font-semibold text-[#0f0f0f]">3. Third-party sub-processors</h2>
            <div className="rounded-xl border border-[#f0f0f0] overflow-hidden">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="bg-[#fafafa] border-b border-[#f0f0f0]">
                    <th className="px-4 py-2.5 text-left font-medium text-[#9a9aa5]">Service</th>
                    <th className="px-4 py-2.5 text-left font-medium text-[#9a9aa5]">Purpose</th>
                    <th className="px-4 py-2.5 text-left font-medium text-[#9a9aa5]">Data shared</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["Supabase", "Database & authentication", "Email, scan results, URLs"],
                    ["Vercel", "Hosting", "Request logs"],
                    ["Groq AI", "AI comparison of design vs live", "Matched element pairs (no PII)"],
                    ["Figma", "Design data retrieval", "Your Figma token (browser-direct)"],
                  ].map(([svc, purpose, shared]) => (
                    <tr key={svc} className="border-b border-[#f7f7f8] last:border-0">
                      <td className="px-4 py-2.5 font-medium text-[#17171c]">{svc}</td>
                      <td className="px-4 py-2.5 text-[#6b7280]">{purpose}</td>
                      <td className="px-4 py-2.5 text-[#6b7280]">{shared}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-[17px] font-semibold text-[#0f0f0f]">4. The Chrome extension</h2>
            <p>The Loupe Chrome extension runs only on pages you actively navigate to while using Loupe. It reads computed CSS styles (fonts, colors) from the current tab and sends them to our API solely to perform the design comparison you requested. It does not run in the background, does not track your browsing, and does not collect any data outside of an active comparison session.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-[17px] font-semibold text-[#0f0f0f]">5. Shared report links</h2>
            <p>When you copy a share link from the History page, that link is publicly accessible — anyone with the URL can view the scan results. The link contains only issue data (element names, categories, values) and the live page URL. It does not expose your email, account details, or Figma credentials.</p>
            <p>If you want to revoke access to a shared link, contact us and we will delete the underlying run data.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-[17px] font-semibold text-[#0f0f0f]">6. Data retention</h2>
            <ul className="list-disc pl-5 space-y-1.5 text-[#5b5b66]">
              <li>Free accounts: run history kept for 7 days</li>
              <li>Pro / Team accounts: run history kept indefinitely while your account is active</li>
              <li>On account deletion: all data removed within 30 days</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-[17px] font-semibold text-[#0f0f0f]">7. Your rights</h2>
            <p>You have the right to:</p>
            <ul className="list-disc pl-5 space-y-1.5 text-[#5b5b66]">
              <li>Access the personal data we hold about you</li>
              <li>Request correction of inaccurate data</li>
              <li>Request deletion of your data</li>
              <li>Export your run history</li>
            </ul>
            <p>To exercise these rights, email <a href="mailto:hello@useloupe.io" className="text-[#0f0f0f] underline underline-offset-2">hello@useloupe.io</a>.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-[17px] font-semibold text-[#0f0f0f]">8. Cookies</h2>
            <p>We use only essential cookies required for authentication (session token). We do not use advertising or analytics cookies.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-[17px] font-semibold text-[#0f0f0f]">9. Security</h2>
            <p>Data is stored in Supabase (SOC 2 compliant) and served over HTTPS. We use row-level security so users can only access their own data. Figma tokens never leave your browser.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-[17px] font-semibold text-[#0f0f0f]">10. Changes to this policy</h2>
            <p>If we make material changes we will notify you by email at least 14 days before the changes take effect.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-[17px] font-semibold text-[#0f0f0f]">11. Contact</h2>
            <p>Questions or concerns? Email <a href="mailto:hello@useloupe.io" className="text-[#0f0f0f] underline underline-offset-2">hello@useloupe.io</a> and we will respond within 2 business days.</p>
          </section>

        </div>

        <div className="mt-12 pt-8 border-t border-[#f5f5f7] flex gap-6">
          <Link href="/terms" className="text-[13px] text-[#9a9aa5] hover:text-[#0f0f0f] transition-colors">Terms of Service</Link>
          <Link href="/" className="text-[13px] text-[#9a9aa5] hover:text-[#0f0f0f] transition-colors">← Back to home</Link>
        </div>
      </main>
    </div>
  );
}
