"use client";

import { useState, useEffect } from "react";
import { Eye, EyeOff, Check, KeyRound, Globe, ExternalLink, User, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function SettingsPage() {
  const [pat, setPat] = useState("");
  const [showPat, setShowPat] = useState(false);
  const [patSaved, setPatSaved] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiProvider, setAiProvider] = useState("groq");
  const [aiModel, setAiModel] = useState("");
  const [aiKey, setAiKey] = useState("");
  const [showAiKey, setShowAiKey] = useState(false);
  const [aiSaved, setAiSaved] = useState(false);
  const [email, setEmail] = useState("");

  useEffect(() => {
    // Load PAT from localStorage
    const saved = localStorage.getItem("loupe_pat") ?? "";
    setPat(saved);
    setAiEnabled(localStorage.getItem("loupe_ai_enabled") === "1");
    setAiProvider(localStorage.getItem("loupe_ai_provider") ?? "groq");
    setAiModel(localStorage.getItem("loupe_ai_model") ?? "");
    setAiKey(localStorage.getItem("loupe_ai_key") ?? "");

    // Load user email
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? "");
    });
  }, []);

  function savePat() {
    localStorage.setItem("loupe_pat", pat.trim());
    setPatSaved(true);
    setTimeout(() => setPatSaved(false), 2000);
  }

  function saveAiSettings() {
    localStorage.setItem("loupe_ai_enabled", aiEnabled ? "1" : "0");
    localStorage.setItem("loupe_ai_provider", aiProvider);
    localStorage.setItem("loupe_ai_model", aiModel.trim());
    localStorage.setItem("loupe_ai_key", aiKey.trim());
    setAiSaved(true);
    setTimeout(() => setAiSaved(false), 2000);
  }

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
        </div>

        {/* AI Keys */}
        <div className="rounded-2xl border border-[#f0f0f0] bg-white p-5">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles size={13} className="text-[#71717a]" />
            <p className="text-[11px] font-semibold text-[#71717a] uppercase tracking-widest">AI Keys & Guardrails</p>
          </div>
          <p className="text-[12px] text-[#71717a] mb-4 leading-relaxed">
            AI fallback is optional and off by default. Loupe's core checks use deterministic matching; AI can only run when explicitly enabled.
          </p>

          <label className="mb-4 flex items-start gap-3 rounded-xl border border-[#f0f0f0] bg-[#fafafa] px-4 py-3 cursor-pointer">
            <input
              type="checkbox"
              checked={aiEnabled}
              onChange={e => setAiEnabled(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[#0f0f0f]"
            />
            <span>
              <span className="block text-[13px] font-medium text-[#0f0f0f]">Enable AI fallback</span>
              <span className="block text-[11px] text-[#71717a] leading-relaxed">
                Guardrails block AI from inventing design QA issues. If live capture is missing, Loupe will ask for extension recapture instead of guessing.
              </span>
            </span>
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-[10px] font-semibold text-[#71717a] uppercase tracking-wide mb-1">Provider</label>
              <select
                value={aiProvider}
                onChange={e => setAiProvider(e.target.value)}
                className="w-full border border-[#e8e8ec] rounded-xl px-3 py-2.5 text-[13px] text-[#0f0f0f] bg-white focus:outline-none focus:border-[#0f0f0f]"
              >
                <option value="groq">Groq</option>
                <option value="openai">OpenAI</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-[#71717a] uppercase tracking-wide mb-1">Model</label>
              <input
                value={aiModel}
                onChange={e => setAiModel(e.target.value)}
                placeholder={aiProvider === "openai" ? "gpt-4o-mini" : "llama-3.3-70b-versatile"}
                className="w-full border border-[#e8e8ec] rounded-xl px-3 py-2.5 text-[13px] text-[#0f0f0f] placeholder:text-[#a1a1aa] focus:outline-none focus:border-[#0f0f0f]"
              />
            </div>
          </div>

          <div className="relative mb-3">
            <input
              type={showAiKey ? "text" : "password"}
              value={aiKey}
              onChange={e => setAiKey(e.target.value)}
              placeholder={aiProvider === "openai" ? "sk-..." : "gsk_..."}
              className="w-full border border-[#e8e8ec] rounded-xl px-4 py-2.5 pr-10 text-[13px] text-[#0f0f0f] placeholder:text-[#a1a1aa] focus:outline-none focus:border-[#0f0f0f] transition-colors font-mono"
            />
            <button type="button" onClick={() => setShowAiKey(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#a1a1aa] hover:text-[#3f3f46] transition-colors">
              {showAiKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>

          <button
            onClick={saveAiSettings}
            className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-medium transition-all ${
              aiSaved
                ? "bg-emerald-50 text-emerald-600 border border-emerald-200"
                : "bg-[#0f0f0f] text-white hover:bg-[#1a1a1a]"
            }`}
          >
            {aiSaved ? <><Check size={13} /> Saved</> : "Save AI settings"}
          </button>
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
