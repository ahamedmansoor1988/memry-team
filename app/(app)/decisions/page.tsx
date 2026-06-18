import Link from "next/link";
import { BrainCircuit, ArrowRight } from "lucide-react";

export default function DecisionsPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-text mb-1">Decisions</h1>
        <p className="text-sm text-text-2">Every decision captured across all your tools.</p>
      </div>

      <div className="bg-surface border border-border rounded-xl p-10 text-center">
        <div className="w-12 h-12 rounded-xl bg-accent-soft flex items-center justify-center mx-auto mb-4">
          <BrainCircuit size={22} className="text-accent-text" />
        </div>
        <h2 className="text-base font-semibold text-text mb-2">Connect your tools first</h2>
        <p className="text-sm text-text-2 mb-6 max-w-sm mx-auto">
          Decisions appear here automatically once Slack, Figma, Jira, or Notion is connected and your team starts discussing.
        </p>
        <Link
          href="/integrations"
          className="inline-flex items-center gap-2 bg-accent text-accent-ink text-sm font-medium px-4 py-2 rounded-lg hover:opacity-90 transition-opacity"
        >
          Go to Integrations <ArrowRight size={14} />
        </Link>
      </div>
    </div>
  );
}
