"use client";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  async function signInWithGoogle() {
    const supabase = createClient();
    const redirectParam = new URLSearchParams(window.location.search).get("redirect");
    const next = redirectParam?.startsWith("/invite/") ? redirectParam : "/agents/figma-compare";
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
  }

  return (
    <div className="min-h-screen bg-white flex">
      {/* Left — branding */}
      <div className="hidden lg:flex w-[480px] shrink-0 flex-col justify-between bg-[#fafafa] border-r border-[#f0f0f0] px-12 py-12">
        <img src="/loupe.svg" alt="Loupe" className="h-7 w-auto self-start" />

        <div>
          <p className="text-[13px] font-medium text-[#9a9aa5] uppercase tracking-widest mb-6">What you get</p>
          <div className="space-y-5">
            {[
              { title: "Figma vs Live", desc: "Compare any Figma frame against the real page — fonts, colors, spacing." },
              { title: "AI-powered analysis", desc: "Groq AI surfaces every discrepancy in seconds, not hours." },
              { title: "Shareable reports", desc: "Send a link to your designer or PM. No login needed to view." },
            ].map(f => (
              <div key={f.title} className="flex items-start gap-3">
                <div className="mt-0.5 h-5 w-5 rounded-full flex items-center justify-center shrink-0" style={{ background: "linear-gradient(135deg, #a855f7, #ec4899, #f97316)" }}>
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M2 5.5l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <div>
                  <p className="text-[13px] font-semibold text-[#0f0f0f]">{f.title}</p>
                  <p className="text-[12px] text-[#9a9aa5] leading-relaxed">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="text-[11px] text-[#c8c8d0]">© 2026 Loupe. All rights reserved.</p>
      </div>

      {/* Right — form */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        {/* Mobile logo */}
        <img src="/loupe.svg" alt="Loupe" className="h-6 w-auto mb-10 lg:hidden" />

        <div className="w-full max-w-[360px]">
          <h1 className="text-[26px] font-semibold text-[#0f0f0f] mb-1 font-[family-name:var(--font-serif)]">Welcome to Loupe</h1>
          <p className="text-[14px] text-[#9a9aa5] mb-8">Sign in to catch design bugs before they ship.</p>

          <button
            onClick={signInWithGoogle}
            className="w-full flex items-center justify-center gap-3 bg-white border border-[#e8e8ec] hover:border-[#0f0f0f] text-[#0f0f0f] font-medium text-[14px] py-3 px-4 rounded-xl transition-colors shadow-sm"
          >
            <svg width="18" height="18" viewBox="0 0 18 18">
              <path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18z"/>
              <path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 0 1-7.18-2.54H1.83v2.07A8 8 0 0 0 8.98 17z"/>
              <path fill="#FBBC05" d="M4.5 10.52a4.8 4.8 0 0 1 0-3.04V5.41H1.83a8 8 0 0 0 0 7.18l2.67-2.07z"/>
              <path fill="#EA4335" d="M8.98 4.18c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 1.83 5.4L4.5 7.49a4.77 4.77 0 0 1 4.48-3.3z"/>
            </svg>
            Continue with Google
          </button>

          <p className="text-[11px] text-[#c8c8d0] text-center mt-6">
            By continuing you agree to our{" "}
            <Link href="/terms" className="underline underline-offset-2 hover:text-[#9a9aa5] transition-colors">Terms</Link>
            {" & "}
            <Link href="/privacy" className="underline underline-offset-2 hover:text-[#9a9aa5] transition-colors">Privacy Policy</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
