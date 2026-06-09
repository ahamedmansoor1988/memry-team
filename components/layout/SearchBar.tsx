"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

export default function SearchBar() {
  const router = useRouter();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        router.push("/search");
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [router]);

  return (
    <button
      onClick={() => router.push("/search")}
      className="flex items-center gap-2 bg-zinc-100 border border-zinc-200 rounded-lg px-3 py-1.5 text-sm text-zinc-400 w-64 hover:bg-zinc-50 hover:border-zinc-300 transition-colors"
    >
      <Search size={13} className="shrink-0" />
      <span className="flex-1 text-left truncate">Search feedback, decisions…</span>
      <kbd className="text-[10px] bg-white border border-zinc-200 rounded px-1 py-0.5 text-zinc-400 shrink-0">⌘K</kbd>
    </button>
  );
}
