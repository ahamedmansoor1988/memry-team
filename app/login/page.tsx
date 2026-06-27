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
    <div className="min-h-screen flex">
      {/* Left — gradient */}
      <div className="hidden lg:flex w-1/2 flex-col items-center justify-center px-12 py-12 text-center" style={{ background: "linear-gradient(135deg, #a855f7 0%, #ec4899 50%, #f97316 100%)" }}>
        {/* White logo */}
        <svg height="44" viewBox="0 0 482 207" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: "auto" }} className="mb-10">
          <path d="M26.2 153.6C18.0667 153.6 11.6667 151.333 7 146.8C2.33333 142.133 0 135.8 0 127.8C0 125.667 3.6 94 10.8 32.8C12.6667 17.0667 17.6667 7.13333 25.8 3C29.5333 0.999999 34 0 39.2 0C56.8 0 65.6 8.13333 65.6 24.4C65.6 25.7333 65.5333 27.1333 65.4 28.6C64.0667 46.4667 52.8667 64.6667 31.8 83.2C31.1333 89.7333 30.4 96.0667 29.6 102.2C28 115.933 27.2 123.533 27.2 125C27.2 131.933 30.2 135.4 36.2 135.4C42.7333 135.4 48.8 131.667 54.4 124.2C60.1333 116.6 64.5333 106.933 67.6 95.2C68.8 95.6 70.4667 96.7333 72.6 98.6C74.7333 100.333 76.2 101.867 77 103.2C74.8667 114.267 70.0667 124.867 62.6 135C58.8667 140.2 54.1333 144.467 48.4 147.8C41.8667 151.667 34.4667 153.6 26.2 153.6ZM34 63.2C46.2667 49.7333 52.4 37.6667 52.4 27C52.4 20.6 50 17.4 45.2 17.4C42.1333 17.6667 40.0667 19.6667 39 23.4C38.0667 27.1333 37.1333 33.2 36.2 41.6C35.4 50 34.8667 55.2 34.6 57.2L34 63.2Z" fill="white"/>
          <path d="M112.933 56C125.199 56 135.399 59.9333 143.533 67.8C151.799 75.6667 155.933 85.2667 155.933 96.6C155.933 113.8 150.866 127.6 140.733 138C130.733 148.267 118.599 153.4 104.333 153.4C90.0661 153.4 78.7328 149.333 70.3328 141.2C62.0661 133.067 57.9328 123 57.9328 111C57.9328 94.2 63.0661 80.8667 73.3328 71C83.7328 61 96.9328 56 112.933 56ZM108.933 72.2C102.666 72.2 97.3995 75.8 93.1328 83C88.8661 90.2 86.5328 99.2667 86.1328 110.2C86.1328 117.933 87.6662 124.333 90.7328 129.4C93.9328 134.467 98.7328 137 105.133 137C111.533 137 116.866 133.467 121.133 126.4C125.533 119.333 127.733 111.267 127.733 102.2C127.733 93.1333 126.199 85.9333 123.133 80.6C120.066 75 115.333 72.2 108.933 72.2Z" fill="white"/>
          <path d="M253.639 58C248.172 101.2 245.439 124.2 245.439 127C245.439 132.333 247.372 135 251.239 135C254.706 135 258.439 132.667 262.439 128C266.572 123.2 269.839 116.067 272.239 106.6C276.639 111.4 279.306 115.133 280.239 117.8C277.172 130.733 272.306 139.867 265.639 145.2C258.972 150.533 252.106 153.2 245.039 153.2C233.439 153.2 225.639 148.733 221.639 139.8C214.706 148.733 205.439 153.2 193.839 153.2C184.239 153.2 176.839 150.8 171.639 146C166.439 141.2 163.839 134.933 163.839 127.2C163.839 125.333 164.172 122.067 164.839 117.4C167.906 92.6 170.239 72.8667 171.839 58.2C175.972 56.7333 179.772 56 183.239 56C186.706 56 189.306 56.1333 191.039 56.4C192.772 56.6667 194.439 57.6667 196.039 59.4C197.639 61.1333 198.439 63.6 198.439 66.8L191.839 117.8C191.572 119.4 191.439 120.867 191.439 122.2C191.439 130.067 195.039 134 202.239 134C208.906 134 214.439 130.733 218.839 124.2C218.839 122.733 218.972 120.4 219.239 117.2L225.839 64C226.772 61.7333 228.772 59.8667 231.839 58.4C234.906 56.8 238.706 56 243.239 56C247.906 56 251.372 56.6667 253.639 58Z" fill="white"/>
          <path d="M287.806 55.8C296.473 55.8 301.54 58 303.006 62.4C309.273 58 317.206 55.8 326.806 55.8C336.406 55.8 344.673 59.7333 351.606 67.6C358.54 75.4667 362.006 84.6667 362.006 95.2C362.006 96.6667 361.94 98.2 361.806 99.8C360.34 117.267 354.473 130.6 344.206 139.8C333.94 148.867 320.54 153.4 304.006 153.4C300.273 153.4 296.206 152.933 291.806 152L285.406 207H259.206C267.74 133.533 273.473 83.6667 276.406 57.4C279.206 56.3333 283.006 55.8 287.806 55.8ZM333.806 96.6C333.806 90.7333 332.473 85.5333 329.806 81C327.14 76.4667 323.006 74.2 317.406 74.2C309.806 74.2 304.006 79.1333 300.006 89C297.34 108.733 295.806 120.2 295.406 123.4C295.273 127.4 296.54 130.4 299.206 132.4C301.873 134.4 305.14 135.4 309.006 135.4C315.806 135.4 321.406 132.333 325.806 126.2C331.14 118.6 333.806 108.733 333.806 96.6Z" fill="white"/>
          <path d="M408.866 107.4C417.132 105.667 423.266 102.333 427.266 97.4C431.399 92.4667 433.466 87.7333 433.466 83.2C433.466 78.5333 432.199 75.4 429.666 73.8C427.266 72.0667 424.599 71.2 421.666 71.2C415.399 71.2 409.866 74.7333 405.066 81.8C400.399 88.7333 398.066 97.0667 398.066 106.8C398.066 116.4 400.332 123.6 404.866 128.4C409.532 133.067 415.266 135.4 422.066 135.4C432.066 135.4 441.666 131.933 450.866 125C460.066 118.067 467.532 109 473.266 97.8C476.199 100.6 478.866 104.067 481.266 108.2C476.866 118.2 469.066 128 457.866 137.6C452.266 142.267 445.599 146.067 437.866 149C430.266 151.933 422.399 153.4 414.266 153.4C400.932 153.4 390.399 149.333 382.666 141.2C374.399 132.4 370.266 121.133 370.266 107.4C370.266 93.6667 375.399 81.6667 385.666 71.4C396.066 61.1333 408.466 56 422.866 56C433.132 56 441.466 58.2667 447.866 62.8C454.266 67.2 457.532 73.2 457.666 80.8C457.666 91.0667 453.532 99.4 445.266 105.8C437.132 112.2 425.932 116.667 411.666 119.2L408.866 107.4Z" fill="white"/>
        </svg>

        <p className="text-white/80 text-[16px] font-medium leading-snug mb-12">
          Catch design bugs before they ship.
        </p>

        <div className="space-y-5 w-full max-w-[300px]">
          {[
            { title: "Figma vs Live", desc: "Compare any Figma frame against the real page — fonts, colors, spacing." },
            { title: "Full run history", desc: "Every comparison is saved. Track regressions and see what changed between runs." },
            { title: "Shareable reports", desc: "Send a link to your team. No login needed to view." },
          ].map(f => (
            <div key={f.title} className="flex items-start gap-3 text-left">
              <div className="mt-0.5 h-4 w-4 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                  <path d="M1.5 4.5l1.5 1.5 3.5-3.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <div>
                <p className="text-white text-[13px] font-semibold leading-none mb-1">{f.title}</p>
                <p className="text-white/55 text-[12px] leading-relaxed">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right — form */}
      <div className="w-full lg:w-1/2 flex flex-col items-center justify-center px-6 py-12 bg-white">
        {/* Mobile logo */}
        <img src="/loupe.svg" alt="Loupe" className="h-6 w-auto mb-10 lg:hidden" />

        <div className="w-full max-w-[340px]">
          <h1 className="text-[32px] font-normal text-[#0f0f0f] mb-1 font-[family-name:var(--font-serif)]">Sign in</h1>
          <p className="text-[14px] text-[#9a9aa5] mb-8">Welcome back — continue with Google.</p>

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
