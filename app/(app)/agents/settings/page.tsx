"use client";

import { useState, useEffect } from "react";
import { Eye, EyeOff, Check, KeyRound, Globe, ExternalLink, User, Loader2, AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { patExpiryStatus } from "@/lib/pat-expiry";

export default function SettingsPage() {
  const [pat, setPat] = useState("");
  const [showPat, setShowPat] = useState(false);
  const [patSaved, setPatSaved] = useState(false);
  const [patExpiry, setPatExpiry] = useState("");
  const [tokenCheck, setTokenCheck] = useState<"idle" | "checking" | "valid" | "invalid" | "unknown">("idle");
  const [tokenCheckDetail, setTokenCheckDetail] = useState("");
  const [email, setEmail] = useState("");

  useEffect(() => {
    // Load PAT from localStorage
    const saved = localStorage.getItem("loupe_pat") ?? "";
    setPat(saved);
    setPatExpiry(localStorage.getItem("loupe_pat_expiry") ?? "");
    // Load user email
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? "");
    });
  }, []);

  function savePat() {
    localStorage.setItem("loupe_pat", pat.trim());
    if (patExpiry) localStorage.setItem("loupe_pat_expiry", patExpiry);
    else localStorage.removeItem("loupe_pat_expiry");
    setPatSaved(true);
    setTimeout(() => setPatSaved(false), 2000);
  }

  // Figma's API has no endpoint that reveals a token's expiry date, so the
  // best live signal is whether the token still authenticates at all. Runs
  // from the browser — the token never touches Loupe's servers.
  async function testToken() {
    if (!pat.trim()) return;
    setTokenCheck("checking");
    setTokenCheckDetail("");
    try {
      const res = await fetch("https://api.figma.com/v1/me", {
        headers: { "X-Figma-Token": pat.trim() },
      });
      if (res.ok) {
        const me = await res.json();
        setTokenCheck("valid");
        setTokenCheckDetail(me.email ? `Authenticated as ${me.email}` : "Token works.");
      } else {
        setTokenCheck("invalid");
        setTokenCheckDetail(res.status === 403 ? "Figma rejected the token — it is expired or revoked." : `Figma returned ${res.status}.`);
      }
    } catch {
      setTokenCheck("unknown");
      setTokenCheckDetail("Could not reach the Figma API from this browser.");
    }
  }

  const expiry = patExpiryStatus(patExpiry || null);

  return (
    <div className="h-full overflow-y-auto"><div className="max-w-2xl mx-auto px-6 py-10">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-[20px] font-semibold text-[#0f0f0f] mb-1">Settings</h1>
        <p className="text-[13px] text-[#71717a]">Manage your account and Loupe extension setup.</p>
      </div>

      <div className="space-y-4">

        {/* Account */}
        <div className="rounded-2xl border border-[#f0f0f0] bg-white p-5">
          <div className="flex items-center gap-2 mb-4">
            <User size={13} className="text-[#71717a]" />
            <p className="text-[11px] font-semibold text-[#71717a] uppercase tracking-widest">Account</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-full bg-[#f5f5f7] flex items-center justify-center shrink-0">
              <span className="text-[12px] font-semibold text-[#3f3f46]">{email[0]?.toUpperCase()}</span>
            </div>
            <div>
              <p className="text-[13px] font-medium text-[#0f0f0f]">{email || "—"}</p>
              <p className="text-[11px] text-[#71717a]">Signed in with Google</p>
            </div>
          </div>
        </div>

        {/* Figma PAT */}
        <div className="rounded-2xl border border-[#f0f0f0] bg-white p-5">
          <div className="flex items-center gap-2 mb-1">
            <KeyRound size={13} className="text-[#71717a]" />
            <p className="text-[11px] font-semibold text-[#71717a] uppercase tracking-widest">Figma Personal Access Token</p>
          </div>
          <p className="text-[12px] text-[#71717a] mb-2 leading-relaxed">
            Loupe uses your Figma PAT to fetch design frames directly from the Figma API. Without it, comparisons can't run.
          </p>
          <p className="text-[12px] text-[#71717a] mb-4 leading-relaxed">
            The first run fetches and caches your design — subsequent runs are instant with zero Figma API calls. Stored only in your browser, never on our servers.{" "}
            <a href="https://www.figma.com/settings" target="_blank" rel="noopener noreferrer"
              className="text-[#0f0f0f] underline underline-offset-2 hover:opacity-70 inline-flex items-center gap-0.5">
              Generate one in Figma Settings <ExternalLink size={10} />
            </a>
          </p>
          <div className="relative mb-3">
            <input
              type={showPat ? "text" : "password"}
              value={pat}
              onChange={e => setPat(e.target.value)}
              placeholder="figd_••••••••••••••••"
              className="w-full border border-[#e8e8ec] rounded-xl px-4 py-2.5 pr-10 text-[13px] text-[#0f0f0f] placeholder:text-[#a1a1aa] focus:outline-none focus:border-[#0f0f0f] transition-colors font-mono"
            />
            <button type="button" onClick={() => setShowPat(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#a1a1aa] hover:text-[#3f3f46] transition-colors">
              {showPat ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <div className="mb-4">
            <label className="mb-1 block text-[12px] font-medium text-[#3f3f46]">Token expiry date <span className="font-normal text-[#a1a1aa]">(optional — shown by Figma when you create the token)</span></label>
            <input
              type="date"
              value={patExpiry}
              onChange={e => setPatExpiry(e.target.value)}
              className="rounded-xl border border-[#e8e8ec] px-4 py-2 text-[13px] text-[#0f0f0f] transition-colors focus:border-[#0f0f0f] focus:outline-none"
            />
            {expiry.state !== "none" && (
              <p className={`mt-1.5 flex items-center gap-1.5 text-[12px] ${
                expiry.state === "expired" ? "text-red-600" : expiry.state === "expiring" ? "text-amber-600" : "text-emerald-600"
              }`}>
                {expiry.state !== "ok" && <AlertTriangle size={12} />}
                {expiry.message}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={savePat}
              className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-medium transition-all ${
                patSaved
                  ? "bg-emerald-50 text-emerald-600 border border-emerald-200"
                  : "bg-[#0f0f0f] text-white hover:bg-[#1a1a1a]"
              }`}
            >
              {patSaved ? <><Check size={13} /> Saved</> : "Save token"}
            </button>
            <button
              onClick={testToken}
              disabled={!pat.trim() || tokenCheck === "checking"}
              className="flex items-center gap-1.5 rounded-lg border border-[#e8e8ec] px-4 py-2 text-[13px] font-medium text-[#0f0f0f] transition-colors hover:border-[#0f0f0f] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {tokenCheck === "checking" ? <Loader2 size={13} className="animate-spin" /> : null}
              Test token
            </button>
            {tokenCheck !== "idle" && tokenCheck !== "checking" && (
              <p className={`text-[12px] ${tokenCheck === "valid" ? "text-emerald-600" : tokenCheck === "invalid" ? "text-red-600" : "text-amber-600"}`}>
                {tokenCheckDetail}
              </p>
            )}
          </div>
        </div>

        {/* Chrome Extension */}
        <div className="rounded-2xl border border-[#f0f0f0] bg-white p-5">
          <div className="flex items-center gap-2 mb-1">
            <Globe size={13} className="text-[#71717a]" />
            <p className="text-[11px] font-semibold text-[#71717a] uppercase tracking-widest">Chrome Extension</p>
          </div>
          <p className="text-[12px] text-[#71717a] mb-4 leading-relaxed">
            Captures real computed styles from live pages for accurate comparison. Load it manually in Chrome.
          </p>
          <div className="rounded-xl bg-[#fffbeb] border border-[#fde68a] px-4 py-3 mb-4">
            <p className="text-[12px] text-[#92400e] leading-relaxed">
              Not yet reviewed on the Chrome Web Store. Install manually — the extension only activates when you run a Loupe comparison.
            </p>
          </div>
          <div className="text-[12px] text-[#3f3f46] space-y-1.5 mb-4">
            <p>1. Download the extension source from GitHub</p>
            <p>2. Go to <span className="font-mono bg-[#f5f5f7] px-1.5 py-0.5 rounded text-[11px]">chrome://extensions</span></p>
            <p>3. Enable <strong>Developer mode</strong> (top right)</p>
            <p>4. Click <strong>Load unpacked</strong> → select the <span className="font-mono bg-[#f5f5f7] px-1.5 py-0.5 rounded text-[11px]">loupe-extension</span> folder</p>
          </div>
          <a
            href="https://github.com/ahamedmansoor1988/memry-team/tree/main/loupe-extension"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#e8e8ec] px-4 py-2 text-[13px] font-medium text-[#0f0f0f] hover:border-[#0f0f0f] transition-colors"
          >
            <ExternalLink size={12} /> View on GitHub
          </a>
        </div>

      </div>
    </div></div>
  );
}
