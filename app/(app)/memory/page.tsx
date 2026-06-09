"use client";

import { useState, useRef, useEffect } from "react";
import { Brain, Send, Loader2, ChevronDown, ChevronUp, Sparkles, BookOpen, Clock } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MemoryAnswer {
  answer:      string;
  confidence:  "high" | "medium" | "low";
  sources:     string[];
  suggestions: string[];
}

interface MemoryEntry {
  id:         string;
  type:       "decision" | "pattern" | "context";
  title:      string;
  content:    string;
  tags:       string[];
  created_at: string;
}

interface Message {
  role:    "user" | "assistant";
  content: string;
  answer?: MemoryAnswer;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  const d = Math.floor(diff / 86400000);
  if (d === 0) return "Today";
  if (d === 1) return "Yesterday";
  if (d < 30)  return `${d}d ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

const CONFIDENCE_STYLE: Record<string, string> = {
  high:   "bg-zinc-900 text-white",
  medium: "bg-zinc-100 text-zinc-700",
  low:    "bg-zinc-50  text-zinc-400",
};

const TYPE_STYLE: Record<string, string> = {
  decision: "bg-zinc-900 text-white",
  pattern:  "bg-zinc-100 text-zinc-700",
  context:  "bg-zinc-50  text-zinc-500",
};

const SUGGESTED_QUESTIONS = [
  "Why did we make the last major design decision?",
  "What decisions are still unresolved?",
  "Which items have the highest risk?",
  "What was decided about onboarding?",
  "Who owns the most open decisions?",
  "What patterns keep appearing in our feedback?",
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function ConfidenceBadge({ confidence }: { confidence: "high" | "medium" | "low" }) {
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${CONFIDENCE_STYLE[confidence]}`}>
      {confidence} confidence
    </span>
  );
}

function AssistantMessage({ message }: { message: Message }) {
  const [showSources, setShowSources] = useState(false);
  const answer = message.answer;

  return (
    <div className="flex gap-3">
      {/* Avatar */}
      <div className="w-7 h-7 rounded-md bg-zinc-900 flex items-center justify-center flex-shrink-0 mt-0.5">
        <Brain className="w-3.5 h-3.5 text-white" />
      </div>

      <div className="flex-1 min-w-0">
        {/* Answer text */}
        <p className="text-sm text-zinc-800 leading-relaxed">{message.content}</p>

        {answer && (
          <div className="mt-3 space-y-3">
            {/* Confidence */}
            <ConfidenceBadge confidence={answer.confidence} />

            {/* Sources toggle */}
            {answer.sources.length > 0 && (
              <div>
                <button
                  onClick={() => setShowSources(s => !s)}
                  className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-700 transition-colors"
                >
                  <BookOpen className="w-3 h-3" />
                  {answer.sources.length} source{answer.sources.length > 1 ? "s" : ""}
                  {showSources ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
                {showSources && (
                  <ul className="mt-2 space-y-1.5">
                    {answer.sources.map((s, i) => (
                      <li key={i} className="flex gap-2 text-xs text-zinc-600 bg-zinc-50 rounded-lg px-3 py-2 border border-zinc-100">
                        <span className="text-zinc-300 font-mono shrink-0">{i + 1}.</span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Follow-up suggestions */}
            {answer.suggestions.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-1">
                {answer.suggestions.map((s, i) => (
                  <button
                    key={i}
                    className="text-xs text-zinc-500 bg-zinc-50 border border-zinc-200 rounded-full px-3 py-1 hover:bg-zinc-100 hover:text-zinc-800 transition-colors"
                    onClick={() => {
                      // Bubble up via custom event so the input can receive it
                      window.dispatchEvent(new CustomEvent("memry:suggest", { detail: s }));
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function UserMessage({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[75%] bg-zinc-900 text-white rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm">
        {content}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function MemoryPage() {
  const [messages,  setMessages]  = useState<Message[]>([]);
  const [input,     setInput]     = useState("");
  const [loading,   setLoading]   = useState(false);
  const [entries,   setEntries]   = useState<MemoryEntry[]>([]);
  const [tab,       setTab]       = useState<"chat" | "entries">("chat");
  const bottomRef  = useRef<HTMLDivElement>(null);
  const inputRef   = useRef<HTMLTextAreaElement>(null);

  // Load memory entries
  useEffect(() => {
    fetch("/api/memory/entries")
      .then(r => r.json())
      .then((d: { entries?: MemoryEntry[] }) => setEntries(d.entries ?? []))
      .catch(() => {});
  }, []);

  // Scroll to bottom on new message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Listen for suggestion clicks from child components
  useEffect(() => {
    function onSuggest(e: Event) {
      const text = (e as CustomEvent<string>).detail;
      setInput(text);
      inputRef.current?.focus();
    }
    window.addEventListener("memry:suggest", onSuggest);
    return () => window.removeEventListener("memry:suggest", onSuggest);
  }, []);

  async function sendMessage(query?: string) {
    const text = (query ?? input).trim();
    if (!text || loading) return;

    setInput("");
    setMessages(prev => [...prev, { role: "user", content: text }]);
    setLoading(true);

    try {
      const res  = await fetch("/api/memory/search", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ query: text }),
      });
      const data = await res.json() as MemoryAnswer;

      setMessages(prev => [
        ...prev,
        { role: "assistant", content: data.answer, answer: data },
      ]);
    } catch {
      setMessages(prev => [
        ...prev,
        { role: "assistant", content: "Something went wrong. Please try again." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  const isEmpty = messages.length === 0;

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-white">

      {/* ── Header ── */}
      <div className="px-8 pt-7 pb-4 border-b border-zinc-200 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-zinc-900 flex items-center gap-2.5">
              <Brain className="w-6 h-6" />
              Memory
            </h1>
            <p className="text-sm text-zinc-400 mt-0.5">
              Ask anything about your team&apos;s decision history
            </p>
          </div>

          {/* Tab toggle */}
          <div className="flex items-center gap-1 bg-zinc-100 rounded-lg p-1">
            <button
              onClick={() => setTab("chat")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                tab === "chat" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
              }`}
            >
              Ask
            </button>
            <button
              onClick={() => setTab("entries")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                tab === "entries" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
              }`}
            >
              Entries {entries.length > 0 && <span className="ml-1 text-zinc-400">({entries.length})</span>}
            </button>
          </div>
        </div>
      </div>

      {tab === "chat" ? (
        <>
          {/* ── Chat Area ── */}
          <div className="flex-1 overflow-y-auto px-8 py-6">
            <div className="max-w-2xl mx-auto space-y-6">

              {isEmpty ? (
                /* Empty state */
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="w-14 h-14 rounded-2xl bg-zinc-900 flex items-center justify-center mb-5">
                    <Sparkles className="w-6 h-6 text-white" />
                  </div>
                  <h2 className="text-lg font-semibold text-zinc-900 mb-1">
                    Ask your team&apos;s memory
                  </h2>
                  <p className="text-sm text-zinc-400 max-w-sm mb-8">
                    Get instant answers about any decision your team has ever made — why it happened,
                    who owns it, and what came next.
                  </p>

                  {/* Suggested questions */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
                    {SUGGESTED_QUESTIONS.map(q => (
                      <button
                        key={q}
                        onClick={() => sendMessage(q)}
                        className="text-left text-xs text-zinc-600 bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3 hover:bg-zinc-100 hover:border-zinc-300 transition-colors leading-relaxed"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                /* Messages */
                messages.map((msg, i) =>
                  msg.role === "user"
                    ? <UserMessage key={i} content={msg.content} />
                    : <AssistantMessage key={i} message={msg} />
                )
              )}

              {/* Loading indicator */}
              {loading && (
                <div className="flex gap-3">
                  <div className="w-7 h-7 rounded-md bg-zinc-900 flex items-center justify-center flex-shrink-0">
                    <Brain className="w-3.5 h-3.5 text-white" />
                  </div>
                  <div className="flex items-center gap-1.5 py-2">
                    <Loader2 className="w-4 h-4 text-zinc-400 animate-spin" />
                    <span className="text-sm text-zinc-400">Searching memory…</span>
                  </div>
                </div>
              )}

              <div ref={bottomRef} />
            </div>
          </div>

          {/* ── Input Bar ── */}
          <div className="shrink-0 border-t border-zinc-100 bg-white px-8 py-4">
            <div className="max-w-2xl mx-auto">
              <div className="flex items-end gap-3 bg-zinc-50 border border-zinc-200 rounded-2xl px-4 py-3 focus-within:border-zinc-400 focus-within:bg-white transition-colors">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="Ask about any decision, risk, or pattern…"
                  rows={1}
                  className="flex-1 bg-transparent text-sm text-zinc-900 placeholder-zinc-400 resize-none outline-none leading-relaxed max-h-32"
                  style={{ overflowY: input.split("\n").length > 3 ? "auto" : "hidden" }}
                />
                <button
                  onClick={() => sendMessage()}
                  disabled={!input.trim() || loading}
                  className="w-8 h-8 rounded-xl bg-zinc-900 flex items-center justify-center text-white hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors shrink-0"
                >
                  {loading
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <Send className="w-3.5 h-3.5" />
                  }
                </button>
              </div>
              <p className="text-[10px] text-zinc-400 mt-2 text-center">
                Press Enter to send · Shift+Enter for new line
              </p>
            </div>
          </div>
        </>
      ) : (
        /* ── Entries Tab ── */
        <div className="flex-1 overflow-y-auto px-8 py-6">
          <div className="max-w-2xl mx-auto">
            {entries.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <BookOpen className="w-10 h-10 text-zinc-200 mb-3" />
                <p className="text-sm text-zinc-400">No memory entries yet.</p>
                <p className="text-xs text-zinc-300 mt-1">
                  Entries are created automatically as decisions are resolved.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {entries.map(entry => (
                  <div
                    key={entry.id}
                    className="rounded-xl border border-zinc-200 bg-white p-4 hover:border-zinc-300 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <h3 className="text-sm font-medium text-zinc-900 leading-snug">{entry.title}</h3>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${TYPE_STYLE[entry.type]}`}>
                        {entry.type}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-500 leading-relaxed line-clamp-2">{entry.content}</p>
                    <div className="flex items-center gap-2 mt-3 flex-wrap">
                      {entry.tags.map(tag => (
                        <span key={tag} className="text-[10px] text-zinc-400 bg-zinc-50 border border-zinc-100 rounded px-1.5 py-0.5">
                          {tag}
                        </span>
                      ))}
                      <div className="ml-auto flex items-center gap-1 text-[10px] text-zinc-300">
                        <Clock className="w-3 h-3" />
                        {timeAgo(entry.created_at)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
