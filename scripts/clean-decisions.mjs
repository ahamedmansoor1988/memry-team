import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
readFileSync(new URL("../.env.local", import.meta.url), "utf8")
  .split("\n").forEach(l => { const m = l.match(/^([^=]+)=(.*)/); if (m) env[m[1].trim()] = m[2].trim(); });

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const toDelete = [
  "894a7781-ba08-43d1-9309-92c6b81de8ec", // "Approved" placeholder
  "ab7dee32-075b-4147-b2b5-ab463e5aaa7f", // "Approved" placeholder
  "14e3064d-6870-4176-909e-92a174fc2329", // duplicate Inter font decision
  "b43b288b-2598-4b90-a0c7-231f18689f70", // test "color palette approved" from #new-channel
];

// Also delete their topic_links and embeddings, then the topics that go empty
for (const id of toDelete) {
  await admin.from("topic_links").delete().eq("item_type", "decision").eq("item_id", id);
  await admin.from("item_embeddings").delete().eq("item_type", "decision").eq("item_id", id);
  await admin.from("decisions").delete().eq("id", id);
  console.log(`Deleted decision ${id}`);
}

// Clean up topics with fewer than 2 active members
const { data: topics } = await admin.from("topics").select("id, title");
for (const t of topics ?? []) {
  const { count } = await admin.from("topic_links")
    .select("id", { count: "exact", head: true })
    .eq("topic_id", t.id).eq("status", "active");
  if ((count ?? 0) < 2) {
    await admin.from("topic_links").delete().eq("topic_id", t.id);
    await admin.from("topics").delete().eq("id", t.id);
    console.log(`Deleted orphan topic "${t.title}"`);
  }
}

console.log("\nDone. Remaining decisions:");
const { data: remaining } = await admin.from("decisions")
  .select("decision_text, source, slack_channel_name, decided_at")
  .order("decided_at", { ascending: true });
remaining?.forEach(d => console.log(`  [${d.source}] "${d.decision_text}" #${d.slack_channel_name ?? "—"} ${d.decided_at?.slice(0,10)}`));
