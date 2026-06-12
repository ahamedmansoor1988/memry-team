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
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "5px 10px",
        fontSize: 12,
        color: "var(--text-3)",
        width: 240,
        cursor: "pointer",
        transition: "border-color 0.15s",
      }}
      className="hover:border-[var(--accent-border)]"
    >
      <Search style={{ width: 12, height: 12, flexShrink: 0 }} />
      <span style={{ flex: 1, textAlign: "left" }}>Ask Memry anything…</span>
      <kbd style={{ fontFamily: "var(--font-mono)", fontSize: 10, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 4, padding: "1px 5px", color: "var(--text-3)", flexShrink: 0 }}>⌘K</kbd>
    </button>
  );
}
