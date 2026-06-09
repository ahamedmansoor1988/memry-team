"use client";
import Link from "next/link";
import { Video, FileText, Upload } from "lucide-react";

interface IntegrationCard {
  icon: React.ReactNode;
  title: string;
  description: string;
  status: "coming_soon" | "available";
  href?: string;
}

const CARDS: IntegrationCard[] = [
  {
    icon: <Video size={18} />,
    title: "Google Meet",
    description:
      "Auto-import transcripts from Google Meet. Decisions and action items are extracted instantly.",
    status: "coming_soon",
  },
  {
    icon: <Video size={18} />,
    title: "Zoom",
    description:
      "Connect Zoom to pull in meeting recordings and transcript summaries automatically.",
    status: "coming_soon",
  },
  {
    icon: <FileText size={18} />,
    title: "Notion",
    description:
      "Sync meeting notes and decision logs from your Notion workspace.",
    status: "coming_soon",
  },
  {
    icon: <Upload size={18} />,
    title: "Paste transcript",
    description:
      "Manually paste a transcript to extract decisions and action items.",
    status: "available",
    href: "/meetings/manual",
  },
];

export default function MeetingsPage() {
  return (
    <div className="flex flex-col h-screen overflow-hidden bg-white">

      {/* Header */}
      <div className="px-8 pt-7 pb-5 border-b border-zinc-200 shrink-0">
        <h1 className="text-2xl font-semibold text-zinc-900">Meetings</h1>
        <p className="text-sm text-zinc-400 mt-0.5">
          Transcripts from your meetings, automatically.
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-8 py-7 max-w-4xl">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {CARDS.map((card) => {
            const inner = (
              <>
                <div className="w-9 h-9 rounded-lg bg-zinc-100 flex items-center justify-center text-zinc-500 mb-3">
                  {card.icon}
                </div>
                <div className="flex items-start justify-between gap-2 mb-1">
                  <p className="text-sm font-medium text-zinc-900">{card.title}</p>
                  {card.status === "coming_soon" ? (
                    <span className="shrink-0 bg-zinc-100 text-zinc-500 text-xs px-2 py-0.5 rounded-full">
                      Coming soon
                    </span>
                  ) : (
                    <span className="shrink-0 bg-zinc-900 text-white text-xs px-2 py-0.5 rounded-full">
                      Available
                    </span>
                  )}
                </div>
                <p className="text-xs text-zinc-500 leading-relaxed">{card.description}</p>
              </>
            );

            const cls =
              "bg-white border border-zinc-200 rounded-xl p-5 hover:border-zinc-300 hover:shadow-sm transition-all text-left";

            if (card.href) {
              return (
                <Link key={card.title} href={card.href} className={cls}>
                  {inner}
                </Link>
              );
            }

            return (
              <div key={card.title} className={cls + " cursor-default"}>
                {inner}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
