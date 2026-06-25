"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Play, Loader2, ChevronRight, AlertCircle, CheckCircle2,
  MessageSquare, Bot, Trash2,
} from "lucide-react";

interface StepMessage {
  id: string;
  type: "step" | "error";
  text: string;
}

interface CommentResult {
  id: string;
  text: string;
  author: string;
  classification: "vague" | "specific" | "skip";
  question?: string;
  replyCommentId?: string;
  replied: boolean;
}

function Badge({ classification }: { classification: CommentResult["classification"] }) {
  if (classification === "vague") {
    return (
      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
        Vague
      </span>
    );
  }
  if (classification === "specific") {
    return (
      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
        Specific
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-[#2a2a35] text-[#9a9aa5] border border-[#3a3a45]">
      Skipped
    </span>
  );
}

export default function CommentWatcherPage() {
  const [figmaUrl, setFigmaUrlRaw] = useState("");
  const [pat,      setPatRaw]      = useState("");
  const [running,  setRunning]     = useState(false);
  const [steps,    setSteps]       = useState<StepMessage[]>([]);
  const [comments, setComments]    = useState<CommentResult[]>([]);
  const [summary,  setSummary]     = useState("");

  const guardRef   = useRef(false);
  const bottomRef  = useRef<HTMLDivElement>(null);

  const setPat = useCallback((v: string) => {
    setPatRaw(v);
    localStorage.setItem("loupe_pat", v);
  }, []);

  const setFigmaUrl = useCallback((v: string) => {
    setFigmaUrlRaw(v);
    localStorage.setItem("loupe_figma_url", v);
  }, []);

  useEffect(() => {
    setFigmaUrlRaw(localStorage.getItem("loupe_figma_url") ?? "");
    setPatRaw(localStorage.getItem("loupe_pat")          ?? "");
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [steps]);

  function addStep(type: "step" | "error", text: string) {
    setSteps(prev => [...prev, { id: crypto.randomUUID(), type, text }]);
  }

  function parseFileKey(url: string): string | null {
    const m = url.match(/figma\.com\/(?:file|design)\/([A-Za-z0-9]+)/);
    return m ? m[1] : null;
  }

  async function run() {
    if (guardRef.current) return;
    const fileKey = parseFileKey(figmaUrl.trim());
    if (!fileKey || !pat.trim()) {
      addStep("error", "Paste a valid Figma file URL and your PAT to continue.");
      return;
    }

    guardRef.current = true;
    setRunning(true);
    setSteps([]);
    setComments([]);
    setSummary("");

    try {
      const res = await fetch("/api/agents/comment-watch", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ fileKey, pat: pat.trim() }),
      });

      if (!res.ok || !res.body) {
        addStep("error", `Request failed (${res.status})`);
        return;
      }

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let   buffer  = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data:")) continue;
          try {
            const data = JSON.parse(line.slice(5).trim());
            if (data.type === "step")   addStep("step",  data.text);
            if (data.type === "error")  addStep("error", data.text);
            if (data.type === "result") {
              setSummary(data.text ?? "");
              setComments(data.comments ?? []);
            }
          } catch {}
        }
      }
    } catch (e) {
      addStep("error", `Connection error: ${String(e)}`);
    } finally {
      setRunning(false);
      guardRef.current = false;
    }
  }

  const vagueCount    = comments.filter(c => c.classification === "vague").length;
  const specificCount = comments.filter(c => c.classification === "specific").length;
  const repliedCount  = comments.filter(c => c.replied).length;

  return (
    <div className="min-h-screen bg-[#0e0e13] text-[#e2e2e9] font-sans">
      <div className="mx-auto max-w-4xl px-4 py-10 space-y-6">

        {/* Header */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-violet-400" />
            <h1 className="text-lg font-semibold tracking-tight">Comment Clarity</h1>
          </div>
          <p className="text-sm text-[#9a9aa5]">
            Detects vague Figma comments and posts clarifying questions automatically.
          </p>
        </div>

        {/* Config */}
        <div className="rounded-xl border border-[#2a2a35] bg-[#16161f] p-4 space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs text-[#9a9aa5] font-medium">Figma File URL</label>
            <input
              value={figmaUrl}
              onChange={e => setFigmaUrl(e.target.value)}
              placeholder="https://www.figma.com/design/..."
              className="w-full rounded-lg border border-[#2a2a35] bg-[#0e0e13] px-3 py-2 text-sm placeholder:text-[#555565] focus:outline-none focus:border-violet-500/60"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-[#9a9aa5] font-medium">Personal Access Token</label>
            <input
              type="password"
              value={pat}
              onChange={e => setPat(e.target.value)}
              placeholder="figd_..."
              className="w-full rounded-lg border border-[#2a2a35] bg-[#0e0e13] px-3 py-2 text-sm placeholder:text-[#555565] focus:outline-none focus:border-violet-500/60"
            />
          </div>
          <button
            onClick={run}
            disabled={running}
            className="flex items-center gap-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 px-4 py-2 text-sm font-medium transition-colors"
          >
            {running
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Running…</>
              : <><Play className="h-4 w-4" /> Run Agent</>
            }
          </button>
        </div>

        {/* Step log */}
        {steps.length > 0 && (
          <div className="rounded-xl border border-[#2a2a35] bg-[#16161f] p-4 space-y-1.5">
            {steps.map(s => (
              <div key={s.id} className="flex items-start gap-2 text-sm">
                {s.type === "error"
                  ? <AlertCircle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
                  : <ChevronRight className="h-4 w-4 text-violet-400 mt-0.5 shrink-0" />
                }
                <span className={s.type === "error" ? "text-red-300" : "text-[#c8c8d4]"}>{s.text}</span>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}

        {/* Summary stats */}
        {summary && (
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-sm text-amber-300">
              <AlertCircle className="h-3.5 w-3.5" />
              {vagueCount} vague
            </div>
            <div className="flex items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-sm text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {specificCount} specific
            </div>
            {repliedCount > 0 && (
              <div className="flex items-center gap-1.5 rounded-lg border border-violet-500/20 bg-violet-500/10 px-3 py-1.5 text-sm text-violet-300">
                <Bot className="h-3.5 w-3.5" />
                {repliedCount} replied
              </div>
            )}
          </div>
        )}

        {/* Results table */}
        {comments.length > 0 && (
          <div className="rounded-xl border border-[#2a2a35] bg-[#16161f] overflow-hidden">
            <div className="px-4 py-3 border-b border-[#2a2a35] text-xs font-medium text-[#9a9aa5] grid grid-cols-[1fr_90px_1fr_80px] gap-3">
              <span>Comment</span>
              <span>Author</span>
              <span>Clarifying question</span>
              <span>Status</span>
            </div>
            <div className="divide-y divide-[#2a2a35]">
              {comments.map(c => (
                <div key={c.id} className="px-4 py-3 grid grid-cols-[1fr_90px_1fr_80px] gap-3 items-start text-sm">
                  <div className="space-y-1">
                    <Badge classification={c.classification} />
                    <p className="text-[#c8c8d4] leading-relaxed">{c.text.slice(0, 120)}{c.text.length > 120 ? "…" : ""}</p>
                  </div>
                  <span className="text-[#9a9aa5] text-xs truncate pt-0.5">{c.author}</span>
                  <p className="text-[#9a9aa5] text-xs leading-relaxed pt-0.5">
                    {c.question ?? (c.classification === "specific" ? "—" : "—")}
                  </p>
                  <div className="pt-0.5">
                    {c.classification === "vague" && c.replied && (
                      <span className="inline-flex items-center gap-1 text-xs text-violet-300">
                        <CheckCircle2 className="h-3 w-3" /> Replied
                      </span>
                    )}
                    {c.classification === "vague" && !c.replied && (
                      <span className="text-xs text-[#9a9aa5]">Pending</span>
                    )}
                    {c.classification !== "vague" && (
                      <span className="text-xs text-[#555565]">—</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {!running && steps.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center space-y-3">
            <div className="h-12 w-12 rounded-full bg-violet-500/10 flex items-center justify-center">
              <MessageSquare className="h-6 w-6 text-violet-400" />
            </div>
            <p className="text-sm text-[#9a9aa5] max-w-xs">
              Paste your Figma file URL and run the agent. It will classify every comment and reply to vague ones asking for specifics.
            </p>
          </div>
        )}

      </div>
    </div>
  );
}
