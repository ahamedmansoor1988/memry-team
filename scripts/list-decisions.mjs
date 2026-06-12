import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
readFileSync(new URL("../.env.local", import.meta.url), "utf8")
  .split("\n").forEach(l => { const m = l.match(/^([^=]+)=(.*)/); if (m) env[m[1].trim()] = m[2].trim(); });

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: decisions } = await admin.from("decisions")
  .select("id, decision_text, source, slack_channel_name, decided_at")
  .order("decided_at", { ascending: true });

console.log(`Total decisions: ${decisions?.length ?? 0}\n`);
decisions?.forEach((d, i) => {
  console.log(`${i+1}. [${d.source}] "${d.decision_text}"`);
  console.log(`   #${d.slack_channel_name ?? "—"}  ${d.decided_at?.slice(0,10)}  ${d.id}\n`);
});
