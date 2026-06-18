import Link from "next/link";
import { FolderKanban, ArrowRight } from "lucide-react";

export default function ProjectsPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-text mb-1">Projects</h1>
        <p className="text-sm text-text-2">Decisions, blockers, and risks per project — auto-populated.</p>
      </div>

      <div className="bg-surface border border-border rounded-xl p-10 text-center">
        <div className="w-12 h-12 rounded-xl bg-accent-soft flex items-center justify-center mx-auto mb-4">
          <FolderKanban size={22} className="text-accent-text" />
        </div>
        <h2 className="text-base font-semibold text-text mb-2">Connect your tools first</h2>
        <p className="text-sm text-text-2 mb-6 max-w-sm mx-auto">
          Projects are created automatically from your Slack channels and Jira projects once connected.
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
