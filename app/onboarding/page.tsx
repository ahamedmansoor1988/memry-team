"use client";

import { useState } from "react";
import { Eye, EyeOff, ArrowRight, Check, ExternalLink, AlertTriangle, Globe } from "lucide-react";

type Step = 0 | 1 | 2 | 3 | 4;

const STEPS = [
  { label: "Your name" },
  { label: "Your role" },
  { label: "How you work" },
  { label: "How you found us" },
  { label: "Connect tools" },
];

const ROLES = ["Product Designer", "UI/UX Designer", "Frontend Developer", "Product Manager", "Design Lead", "Other"];
const WORK_TYPES = ["Solo / Freelancer", "Part of a team"];
const SOURCES = ["Twitter / X", "Friend or colleague", "Google search", "Product Hunt", "Designer community", "Other"];

export default function OnboardingPage() {
  const [step, setStep] = useState<Step>(0);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [workType, setWorkType] = useState("");
  const [source, setSource] = useState("");
  const [pat, setPat] = useState("");
  const [showPat, setShowPat] = useState(false);
  const [extensionAgreed, setExtensionAgreed] = useState(false);

  function next() { setStep(s => (s + 1) as Step); }
  function back() { setStep(s => (s - 1) as Step); }

  function finish() {
    if (pat.trim()) localStorage.setItem("loupe_pat", pat.trim());
    window.location.href = "/agents/figma-compare";
  }

  return (
    <div className="min-h-screen bg-white flex font-[family-name:var(--font-sans)]">
      {/* Left sidebar — timeline */}
      <div className="hidden md:flex w-[260px] shrink-0 flex-col border-r border-[#f0f0f0] px-8 py-10">
        {/* Logo */}
        <div className="flex items-center gap-2 mb-12">
          <img src="/loupe.svg" alt="Loupe" className="h-7 w-auto" />
        </div>

        {/* Steps */}
        <div className="flex flex-col gap-0">
          {STEPS.map((s, i) => {
            const done = i < step;
            const active = i === step;
            return (
              <div key={i} className="flex items-start gap-3">
                <div className="flex flex-col items-center">
                  <div className={`h-6 w-6 rounded-full flex items-center justify-center shrink-0 text-[11px] font-semibold transition-all ${
                    done ? "bg-[#0f0f0f] text-white" : active ? "border-2 border-[#0f0f0f] text-[#0f0f0f]" : "border border-[#e0e0e6] text-[#c0c0c8]"
                  }`}>
                    {done ? <Check size={11} strokeWidth={2.5} /> : i + 1}
                  </div>
                  {i < STEPS.length - 1 && (
                    <div className={`w-px h-8 mt-1 ${done ? "bg-[#0f0f0f]" : "bg-[#f0f0f0]"}`} />
                  )}
                </div>
                <div className="pt-0.5 pb-8">
                  <p className={`text-[13px] font-medium leading-none ${active ? "text-[#0f0f0f]" : done ? "text-[#9a9aa5]" : "text-[#c8c8d0]"}`}>
                    {s.label}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right — content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">

          {/* Mobile step indicator */}
          <div className="flex items-center gap-1.5 mb-8 md:hidden">
            {STEPS.map((_, i) => (
              <div key={i} className={`h-1 flex-1 rounded-full transition-all ${i <= step ? "bg-[#0f0f0f]" : "bg-[#f0f0f0]"}`} />
            ))}
          </div>

          {/* Step 0 — Name */}
          {step === 0 && (
            <div>
              <p className="text-[12px] font-medium text-[#9a9aa5] uppercase tracking-widest mb-3">Step 1 of 5</p>
              <h1 className="text-[36px] font-normal text-[#0f0f0f] mb-1 font-[family-name:var(--font-serif)]">What's your name?</h1>
              <p className="text-[14px] text-[#9a9aa5] mb-8">We'll use this to personalise your experience.</p>
              <input
                autoFocus
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && name.trim() && next()}
                placeholder="Alex Morgan"
                className="w-full border border-[#e8e8ec] rounded-xl px-4 py-3 text-[14px] text-[#0f0f0f] placeholder:text-[#c8c8d0] focus:outline-none focus:border-[#0f0f0f] transition-colors mb-6"
              />
              <button
                onClick={next}
                disabled={!name.trim()}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#0f0f0f] px-4 py-3 text-[13px] font-semibold text-white hover:bg-[#1a1a1a] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                Continue <ArrowRight size={14} />
              </button>
            </div>
          )}

          {/* Step 1 — Role */}
          {step === 1 && (
            <div>
              <p className="text-[12px] font-medium text-[#9a9aa5] uppercase tracking-widest mb-3">Step 2 of 5</p>
              <h1 className="text-[36px] font-normal text-[#0f0f0f] mb-1 font-[family-name:var(--font-serif)]">What's your role?</h1>
              <p className="text-[14px] text-[#9a9aa5] mb-8">This helps us tailor Loupe to how you work.</p>
              <div className="grid grid-cols-2 gap-2 mb-6">
                {ROLES.map(r => (
                  <button
                    key={r}
                    onClick={() => setRole(r)}
                    className={`text-left px-4 py-3 rounded-xl border text-[13px] font-medium transition-all ${
                      role === r ? "border-[#0f0f0f] bg-[#0f0f0f] text-white" : "border-[#e8e8ec] text-[#5b5b66] hover:border-[#0f0f0f] hover:text-[#0f0f0f]"
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <div className="flex gap-3">
                <button onClick={back} className="flex-1 rounded-xl border border-[#e8e8ec] px-4 py-3 text-[13px] font-medium text-[#9a9aa5] hover:border-[#0f0f0f] hover:text-[#0f0f0f] transition-colors">Back</button>
                <button onClick={next} disabled={!role} className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-[#0f0f0f] px-4 py-3 text-[13px] font-semibold text-white hover:bg-[#1a1a1a] disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                  Continue <ArrowRight size={14} />
                </button>
              </div>
            </div>
          )}

          {/* Step 2 — Team or Freelancer */}
          {step === 2 && (
            <div>
              <p className="text-[12px] font-medium text-[#9a9aa5] uppercase tracking-widest mb-3">Step 3 of 5</p>
              <h1 className="text-[36px] font-normal text-[#0f0f0f] mb-1 font-[family-name:var(--font-serif)]">How do you work?</h1>
              <p className="text-[14px] text-[#9a9aa5] mb-8">We'll show you the most relevant features.</p>
              <div className="flex flex-col gap-3 mb-6">
                {WORK_TYPES.map(w => (
                  <button
                    key={w}
                    onClick={() => setWorkType(w)}
                    className={`text-left px-5 py-4 rounded-xl border text-[14px] font-medium transition-all ${
                      workType === w ? "border-[#0f0f0f] bg-[#0f0f0f] text-white" : "border-[#e8e8ec] text-[#5b5b66] hover:border-[#0f0f0f] hover:text-[#0f0f0f]"
                    }`}
                  >
                    {w}
                  </button>
                ))}
              </div>
              <div className="flex gap-3">
                <button onClick={back} className="flex-1 rounded-xl border border-[#e8e8ec] px-4 py-3 text-[13px] font-medium text-[#9a9aa5] hover:border-[#0f0f0f] hover:text-[#0f0f0f] transition-colors">Back</button>
                <button onClick={next} disabled={!workType} className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-[#0f0f0f] px-4 py-3 text-[13px] font-semibold text-white hover:bg-[#1a1a1a] disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                  Continue <ArrowRight size={14} />
                </button>
              </div>
            </div>
          )}

          {/* Step 3 — How you found us */}
          {step === 3 && (
            <div>
              <p className="text-[12px] font-medium text-[#9a9aa5] uppercase tracking-widest mb-3">Step 4 of 5</p>
              <h1 className="text-[36px] font-normal text-[#0f0f0f] mb-1 font-[family-name:var(--font-serif)]">How did you find Loupe?</h1>
              <p className="text-[14px] text-[#9a9aa5] mb-8">Helps us know where to focus our energy.</p>
              <div className="grid grid-cols-2 gap-2 mb-6">
                {SOURCES.map(s => (
                  <button
                    key={s}
                    onClick={() => setSource(s)}
                    className={`text-left px-4 py-3 rounded-xl border text-[13px] font-medium transition-all ${
                      source === s ? "border-[#0f0f0f] bg-[#0f0f0f] text-white" : "border-[#e8e8ec] text-[#5b5b66] hover:border-[#0f0f0f] hover:text-[#0f0f0f]"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <div className="flex gap-3">
                <button onClick={back} className="flex-1 rounded-xl border border-[#e8e8ec] px-4 py-3 text-[13px] font-medium text-[#9a9aa5] hover:border-[#0f0f0f] hover:text-[#0f0f0f] transition-colors">Back</button>
                <button onClick={next} disabled={!source} className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-[#0f0f0f] px-4 py-3 text-[13px] font-semibold text-white hover:bg-[#1a1a1a] disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                  Continue <ArrowRight size={14} />
                </button>
              </div>
            </div>
          )}

          {/* Step 4 — Connect tools */}
          {step === 4 && (
            <div>
              <p className="text-[12px] font-medium text-[#9a9aa5] uppercase tracking-widest mb-3">Step 5 of 5</p>
              <h1 className="text-[36px] font-normal text-[#0f0f0f] mb-1 font-[family-name:var(--font-serif)]">Connect your tools</h1>
              <p className="text-[14px] text-[#9a9aa5] mb-8">Loupe needs Figma access and a Chrome extension to capture live styles.</p>

              {/* Figma PAT */}
              <div className="mb-5">
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[13px] font-semibold text-[#0f0f0f]">Figma Personal Access Token</label>
                  <a href="https://www.figma.com/settings" target="_blank" rel="noopener noreferrer"
                    className="text-[11px] text-[#9a9aa5] hover:text-[#0f0f0f] flex items-center gap-0.5 transition-colors">
                    Get token <ExternalLink size={9} />
                  </a>
                </div>
                <div className="relative">
                  <input
                    type={showPat ? "text" : "password"}
                    value={pat}
                    onChange={e => setPat(e.target.value)}
                    placeholder="figd_••••••••••••••••"
                    className="w-full border border-[#e8e8ec] rounded-xl px-4 py-3 pr-10 text-[13px] text-[#0f0f0f] placeholder:text-[#c8c8d0] focus:outline-none focus:border-[#0f0f0f] transition-colors font-mono"
                  />
                  <button type="button" onClick={() => setShowPat(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#c8c8d0] hover:text-[#5b5b66] transition-colors">
                    {showPat ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                <p className="text-[11px] text-[#b0b0b8] mt-1.5">Stored only in your browser. Never sent to our servers.</p>
              </div>

              {/* Chrome Extension */}
              <div className="rounded-xl border border-[#e8e8ec] p-4 mb-5">
                <div className="flex items-start gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f5f5f7] shrink-0">
                    <Globe size={16} className="text-[#5b5b66]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-[#0f0f0f] mb-0.5">Loupe Chrome Extension</p>
                    <p className="text-[12px] text-[#9a9aa5] leading-relaxed mb-3">
                      Captures live computed styles (fonts, colors) from the page you're testing. Required for accurate comparison.
                    </p>

                    {/* Not reviewed warning */}
                    <div className="flex items-start gap-2 rounded-lg bg-[#fffbeb] border border-[#fde68a] px-3 py-2 mb-3">
                      <AlertTriangle size={12} className="text-[#d97706] mt-0.5 shrink-0" />
                      <p className="text-[11px] text-[#92400e] leading-relaxed">
                        Not yet reviewed on the Chrome Web Store. Install manually via the link below.
                        The extension only runs when you actively use Loupe.
                      </p>
                    </div>

                    <a
                      href="https://github.com/ahamedmansoor1988/memry-team/tree/main/loupe-extension"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#0f0f0f] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-[#1a1a1a] transition-colors"
                    >
                      <Globe size={11} /> View install instructions
                    </a>
                  </div>
                </div>

                {/* Consent */}
                <label className="flex items-start gap-2.5 mt-4 cursor-pointer">
                  <div
                    onClick={() => setExtensionAgreed(v => !v)}
                    className={`h-4 w-4 rounded shrink-0 mt-0.5 flex items-center justify-center border transition-all cursor-pointer ${
                      extensionAgreed ? "bg-[#0f0f0f] border-[#0f0f0f]" : "border-[#d0d0d8]"
                    }`}
                  >
                    {extensionAgreed && <Check size={10} className="text-white" strokeWidth={3} />}
                  </div>
                  <p className="text-[11px] text-[#6b7280] leading-relaxed select-none" onClick={() => setExtensionAgreed(v => !v)}>
                    I understand the extension reads CSS styles from tabs I open while using Loupe, and I agree to the{" "}
                    <a href="/terms" target="_blank" className="underline hover:text-[#0f0f0f]">Terms</a> and{" "}
                    <a href="/privacy" target="_blank" className="underline hover:text-[#0f0f0f]">Privacy Policy</a>.
                  </p>
                </label>
              </div>

              <div className="flex gap-3">
                <button onClick={back} className="flex-1 rounded-xl border border-[#e8e8ec] px-4 py-3 text-[13px] font-medium text-[#9a9aa5] hover:border-[#0f0f0f] hover:text-[#0f0f0f] transition-colors">Back</button>
                <button
                  onClick={finish}
                  disabled={!extensionAgreed}
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-[#0f0f0f] px-4 py-3 text-[13px] font-semibold text-white hover:bg-[#1a1a1a] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  {pat.trim() ? "Go to Loupe" : "Skip & go to Loupe"} <ArrowRight size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
