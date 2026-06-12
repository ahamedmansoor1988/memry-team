# Memry backlog

Candidate work for Sprint 4+, in rough priority order. Re-prioritize after the
first 5 real teams are onboarded (Sprint 3) — let usage data decide.

## Project scoping for multi-client teams (agency safety)

Problem: the Linker and the Slack Q&A bot search workspace-wide. A decision for
Client B can be wrongly linked to (or quoted as an answer for) Client A when
the Slack channel name carries no client signal.

1. **Channel → project mapping** — let workspaces map Slack channels to
   projects; decisions inherit `project_id` from their channel. Linker and Q&A
   respect the boundary, with a "shared/internal" tier for agency-wide topics.
2. **Figma URL → project inference** — when a Slack message or its thread
   contains a Figma file URL, resolve file → project via `figma_files` and
   scope the captured decision to it. Strongest signal, infra already exists.
3. **LLM project-name inference** — match decision text + thread context
   against known project names in `projects`; scope when determinable.
4. **Unscoped decision flagging** — when none of the above resolves a project,
   store the decision as unscoped: linker never auto-links it cross-project,
   and Q&A answers cite it with a "project not identified" caveat.

## Vague comment auto-clarification (original product mission)

Problem: vague Figma comments ("make it pop") are detected and classified, but
resolution is manual — a human must click "Ask for clarification".

5. **Auto-clarify in the Figma thread** — when a comment classifies as Vague,
   Memry replies in the Figma comment thread with a specific question
   ("Which part — contrast, size, or placement?"). Comment-posting already
   exists in `lib/slack/bot.ts`-style infra for Figma.
6. **Vague-item nudge cycle** — vague items that sit untriaged get their own
   escalation path (separate from the generic stale cron).

## Smaller fixes

7. `node_missing` errors in frame preview should be a terminal status, not
   retried forever.
8. Slack setup checklist must include the `channels:join` scope — without it,
   the daily auto-join silently fails and channel coverage looks patchy.
