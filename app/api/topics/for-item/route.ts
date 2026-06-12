/**
 * GET /api/topics/for-item?type=feedback_item|decision&id=<uuid>
 * Returns the item's linked discussion (topic) with hydrated members,
 * including suggested (pending) links for this item.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

interface MemberOut {
  link_id:    string;
  item_type:  string;
  item_id:    string;
  status:     string;
  confidence: number;
  title:      string;
  source:     "figma" | "slack" | "manual";
  meta:       string | null;
  created_at: string | null;
  href:       string | null;
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url      = new URL(req.url);
  const itemType = url.searchParams.get("type");
  const itemId   = url.searchParams.get("id");
  if (!itemType || !itemId || !["feedback_item", "decision"].includes(itemType)) {
    return NextResponse.json({ error: "type and id required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: membership } = await admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1).single();
  const workspaceId = (membership as { workspace_id: string } | null)?.workspace_id;
  if (!workspaceId) return NextResponse.json({ topic: null, members: [] });

  // This item's link (active or suggested)
  const { data: myLinks } = await admin
    .from("topic_links")
    .select("id, topic_id, status, confidence")
    .eq("workspace_id", workspaceId)
    .eq("item_type", itemType)
    .eq("item_id", itemId)
    .order("created_at", { ascending: false })
    .limit(1);
  const myLink = (myLinks ?? [])[0] as { id: string; topic_id: string; status: string; confidence: number } | undefined;
  if (!myLink) return NextResponse.json({ topic: null, members: [], my_link: null });

  const [{ data: topic }, { data: links }] = await Promise.all([
    admin.from("topics").select("id, title, summary, status, created_at").eq("id", myLink.topic_id).maybeSingle(),
    admin.from("topic_links")
      .select("id, item_type, item_id, status, confidence, created_at")
      .eq("topic_id", myLink.topic_id)
      .eq("status", "active")
      .order("created_at", { ascending: true }),
  ]);

  type LinkRow = { id: string; item_type: string; item_id: string; status: string; confidence: number; created_at: string };
  const linkRows = (links ?? []) as LinkRow[];

  const itemIds     = linkRows.filter(l => l.item_type === "feedback_item").map(l => l.item_id);
  const decisionIds = linkRows.filter(l => l.item_type === "decision").map(l => l.item_id);

  const [{ data: feedbackRows }, { data: decisionRows }] = await Promise.all([
    itemIds.length > 0
      ? admin.from("feedback_items")
          .select("id, ai_key_question, ai_summary, status, created_at, project_id, project:projects!project_id(name)")
          .in("id", itemIds)
      : Promise.resolve({ data: [] }),
    decisionIds.length > 0
      ? admin.from("decisions")
          .select("id, decision_text, source, slack_channel_name, decided_at")
          .in("id", decisionIds)
      : Promise.resolve({ data: [] }),
  ]);

  type FeedbackRow = {
    id: string; ai_key_question: string | null; ai_summary: string | null;
    status: string; created_at: string; project_id: string | null;
    project: { name: string } | { name: string }[] | null;
  };
  type DecisionRow = {
    id: string; decision_text: string; source: string;
    slack_channel_name: string | null; decided_at: string;
  };

  const feedbackMap = new Map(((feedbackRows ?? []) as FeedbackRow[]).map(r => [r.id, r]));
  const decisionMap = new Map(((decisionRows ?? []) as DecisionRow[]).map(r => [r.id, r]));

  const members: MemberOut[] = linkRows.map(l => {
    if (l.item_type === "feedback_item") {
      const r = feedbackMap.get(l.item_id);
      const project = r?.project ? (Array.isArray(r.project) ? r.project[0] : r.project) : null;
      return {
        link_id: l.id, item_type: l.item_type, item_id: l.item_id,
        status: l.status, confidence: l.confidence,
        title: r ? ((r.ai_key_question && r.ai_key_question !== "None" ? r.ai_key_question : r.ai_summary) ?? "Discussion") : "Discussion",
        source: "figma",
        meta: project?.name ?? null,
        created_at: r?.created_at ?? null,
        href: r?.project_id ? `/inbox/${r.project_id}/${l.item_id}` : null,
      };
    }
    const r = decisionMap.get(l.item_id);
    return {
      link_id: l.id, item_type: l.item_type, item_id: l.item_id,
      status: l.status, confidence: l.confidence,
      title: r?.decision_text ?? "Decision",
      source: r?.source === "slack" ? "slack" : "manual",
      meta: r?.slack_channel_name ? `#${r.slack_channel_name}` : null,
      created_at: r?.decided_at ?? null,
      href: `/decisions/${l.item_id}`,
    };
  });

  return NextResponse.json({
    topic,
    members,
    my_link: { id: myLink.id, status: myLink.status, confidence: myLink.confidence },
  });
}
