/**
 * generateThreadSummary — stub wired by the sync engine on thread resolution.
 * Full implementation added in Prompt 4.
 *
 * When a thread resolves, the engine calls this function with the thread's UUID.
 * Prompt 4 will replace this body with: Groq summarisation → thread_summaries row
 * → optional Slack notification (posted_to_slack guard to prevent double-posts).
 */
export async function generateThreadSummary(threadId: string): Promise<void> {
  // Prompt 4 implementation goes here.
  // eslint-disable-next-line no-console
  console.log(`[generate-summary] stub called for thread ${threadId} — implement in Prompt 4`);
}
