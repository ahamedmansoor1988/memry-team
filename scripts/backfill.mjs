/**
 * Standalone backfill script — runs the Linker Agent locally.
 * Usage: node scripts/backfill.mjs
 * Reads .env.local for credentials.
 */
import { readFileSync } from "fs";
import { createHash } from "crypto";
import { createClient } from "@supabase/supabase-js";

// ── Load .env.local ──────────────────────────────────────────────────────────
const env = {};
try {
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .forEach(line => {
      const m = line.match(/^([^=]+)=(.*)$/);
      if (m) env[m[1].trim()] = m[2].trim();
    });
} catch {}

const SUPABASE_URL      = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY  = env.SUPABASE_SERVICE_ROLE_KEY;
const JINA_API_KEY      = env.JINA_API_KEY;
const GROQ_API_KEY      = env.GROQ_API_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) { console.error("Missing Supabase env"); process.exit(1); }
if (!JINA_API_KEY)  { console.error("Missing JINA_API_KEY"); process.exit(1); }
if (!GROQ_API_KEY)  { console.error("Missing GROQ_API_KEY"); process.exit(1); }

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// ── Config ───────────────────────────────────────────────────────────────────
const RETRIEVE_MIN  = 0.75;
const AUTO_LINK_MIN = 0.85;
const SUGGEST_MIN   = 0.60;
const BATCH         = 15;

// ── Helpers ───────────────────────────────────────────────────────────────────
function hashText(text) {
  return createHash("sha256").update(text).digest("hex").slice(0, 32);
}

async function embedText(text) {
  const res = await fetch("https://api.jina.ai/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${JINA_API_KEY}` },
    body: JSON.stringify({ model: "jina-embeddings-v3", dimensions: 1024, task: "retrieval.passage", input: [text.slice(0, 8000)] }),
  });
  if (!res.ok) throw new Error(`Jina error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.data[0].embedding;
}

function feedbackItemText(item) {
  return [
    item.ai_key_question && item.ai_key_question !== "None" ? item.ai_key_question : null,
    item.ai_summary,
    item.raw_content,
    item.project_name ? `Project: ${item.project_name}` : null,
  ].filter(Boolean).join("\n");
}

function decisionText(d) {
  return [
    d.decision_text,
    d.reason,
    d.slack_channel_name ? `Channel: #${d.slack_channel_name}` : null,
  ].filter(Boolean).join("\n");
}

async function verdictLLM(newItem, candidates) {
  const labels = candidates.map(c => `- [${c.item_type}] ${c.title} (${c.created_at?.slice(0, 10)})`).join("\n");
  const prompt = `You are deciding if a new discussion belongs with existing ones.

NEW ITEM (${newItem.item_type}, ${newItem.created_at?.slice(0, 10)}):
${newItem.text}

CANDIDATES:
${labels}

Reply with JSON only:
{"same_topic": true/false, "confidence": 0.0-1.0, "title": "short descriptive title if same_topic else null"}

Rules:
- same_topic = true only if they are clearly about the SAME specific decision or design question
- confidence = how certain you are
- If same_topic=false, set confidence < 0.6`;

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_API_KEY}` },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0,
    }),
  });
  if (!res.ok) throw new Error(`Groq error ${res.status}`);
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

// ── Get workspace ─────────────────────────────────────────────────────────────
const { data: ws } = await admin.from("workspaces").select("id").limit(1).maybeSingle();
const workspaceId = ws?.id;
if (!workspaceId) { console.error("No workspace found"); process.exit(1); }
console.log("Workspace:", workspaceId);

// ── Fetch unprocessed items ───────────────────────────────────────────────────
const { data: embedded } = await admin.from("item_embeddings").select("item_type, item_id").eq("workspace_id", workspaceId);
const embeddedSet = new Set((embedded ?? []).map(e => `${e.item_type}:${e.item_id}`));

const { data: fiRows } = await admin.from("feedback_items")
  .select("id, ai_key_question, ai_summary, raw_content, created_at, project:projects!project_id(name)")
  .eq("workspace_id", workspaceId).is("deleted_at", null).order("created_at", { ascending: true });

const { data: decRows } = await admin.from("decisions")
  .select("id, decision_text, reason, slack_channel_name, decided_at")
  .eq("workspace_id", workspaceId).order("decided_at", { ascending: true });

const allItems = [
  ...(fiRows ?? []).map(r => ({
    item_type: "feedback_item",
    item_id: r.id,
    text: feedbackItemText({ ...r, project_name: Array.isArray(r.project) ? r.project[0]?.name : r.project?.name }),
    created_at: r.created_at,
  })),
  ...(decRows ?? []).map(r => ({
    item_type: "decision",
    item_id: r.id,
    text: decisionText(r),
    created_at: r.decided_at,
  })),
].filter(i => i.text.trim().length > 0 && !embeddedSet.has(`${i.item_type}:${i.item_id}`));

console.log(`Unprocessed: ${allItems.length} items`);

// ── Process batch ─────────────────────────────────────────────────────────────
let processed = 0, autoLinked = 0, suggested = 0, errors = 0;
const batch = allItems.slice(0, BATCH);

for (const item of batch) {
  try {
    process.stdout.write(`  [${item.item_type}] ${item.text.slice(0, 60).replace(/\n/g, " ")}... `);

    // 1. Embed
    const embedding = await embedText(item.text);
    const hash = hashText(item.text);
    await admin.from("item_embeddings").upsert({
      workspace_id: workspaceId, item_type: item.item_type, item_id: item.item_id,
      embedding: JSON.stringify(embedding), embedded_text_hash: hash,
    }, { onConflict: "item_type,item_id" });

    // 2. Find neighbours
    const { data: neighbours } = await admin.rpc("match_items", {
      p_workspace_id: workspaceId,
      p_embedding: JSON.stringify(embedding),
      p_threshold: RETRIEVE_MIN,
      p_count: 5,
      p_exclude_type: item.item_type,
      p_exclude_id: item.item_id,
    });

    if (!neighbours || neighbours.length === 0) {
      console.log("no neighbours");
      processed++;
      continue;
    }

    // 3. Load candidate context for LLM
    const fiIds = neighbours.filter(n => n.item_type === "feedback_item").map(n => n.item_id);
    const dIds  = neighbours.filter(n => n.item_type === "decision").map(n => n.item_id);
    const [{ data: fiCands }, { data: dCands }] = await Promise.all([
      fiIds.length > 0 ? admin.from("feedback_items").select("id, ai_key_question, ai_summary, raw_content, created_at").in("id", fiIds) : { data: [] },
      dIds.length  > 0 ? admin.from("decisions").select("id, decision_text, decided_at").in("id", dIds) : { data: [] },
    ]);

    const candidateLabels = [
      ...(fiCands ?? []).map(r => ({ item_type: "feedback_item", item_id: r.id, title: r.ai_key_question || r.ai_summary || r.raw_content?.slice(0, 80), created_at: r.created_at })),
      ...(dCands  ?? []).map(r => ({ item_type: "decision", item_id: r.id, title: r.decision_text?.slice(0, 80), created_at: r.decided_at })),
    ];

    // 4. LLM verdict
    const verdict = await verdictLLM(item, candidateLabels);
    console.log(`verdict: ${verdict.same_topic ? "LINK" : "skip"} (${verdict.confidence?.toFixed(2)}) — ${verdict.title ?? ""}`);

    if (!verdict.same_topic || verdict.confidence < SUGGEST_MIN) {
      processed++;
      continue;
    }

    // 5. Find or create topic
    let topicId;
    // Check if any neighbour already belongs to a topic
    for (const n of neighbours) {
      const { data: existingLink } = await admin.from("topic_links")
        .select("topic_id").eq("item_type", n.item_type).eq("item_id", n.item_id)
        .eq("status", "active").maybeSingle();
      if (existingLink) { topicId = existingLink.topic_id; break; }
    }
    if (!topicId) {
      const { data: newTopic } = await admin.from("topics").insert({
        workspace_id: workspaceId, title: verdict.title ?? "Linked Discussion", status: "active",
      }).select("id").single();
      topicId = newTopic?.id;
      // Link the best neighbour too
      const bestNeighbour = neighbours[0];
      await admin.from("topic_links").upsert({
        topic_id: topicId, workspace_id: workspaceId,
        item_type: bestNeighbour.item_type, item_id: bestNeighbour.item_id,
        confidence: bestNeighbour.similarity,
        status: verdict.confidence >= AUTO_LINK_MIN ? "active" : "suggested",
        linked_by: "linker",
      }, { onConflict: "topic_id,item_type,item_id" });
    }

    // Link this item
    const status = verdict.confidence >= AUTO_LINK_MIN ? "active" : "suggested";
    await admin.from("topic_links").upsert({
      topic_id: topicId, workspace_id: workspaceId,
      item_type: item.item_type, item_id: item.item_id,
      confidence: verdict.confidence,
      status, linked_by: "linker",
    }, { onConflict: "topic_id,item_type,item_id" });

    if (status === "active") autoLinked++;
    else suggested++;
    processed++;

  } catch (err) {
    console.log("ERROR:", err.message);
    errors++;
    processed++;
  }
}

const remaining = allItems.length - batch.length;
console.log(`\nDone: processed=${processed} auto_linked=${autoLinked} suggested=${suggested} errors=${errors} remaining=${remaining}`);
