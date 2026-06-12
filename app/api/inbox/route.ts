import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

type RawItem = {
  id:                  string;
  status:              string;
  priority:            string;
  ai_classification:   string | null;
  ai_key_question:     string | null;
  ai_summary:          string | null;
  ai_risk_flag:        boolean | null;
  ai_suggested_action: string | null;
  owner_name:          string | null;
  owner_profile_id:    string | null;
  project_id:          string | null;
  created_at:          string;
  updated_at:          string;
  project:             { name: string } | { name: string }[] | null;
  comment:             { author_name: string | null } | { author_name: string | null }[] | null;
};

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: membership } = await admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1).single();

  const workspaceId = (membership as { workspace_id: string } | null)?.workspace_id;
  if (!workspaceId) return NextResponse.json({ items: [], me: null });

  const [{ data: rows }, { data: myProfile }] = await Promise.all([
    admin
      .from("feedback_items")
      .select(`
        id, status, priority, ai_classification, ai_key_question, ai_summary,
        ai_risk_flag, ai_suggested_action, owner_name, owner_profile_id, project_id,
        created_at, updated_at,
        project:projects!project_id(name),
        comment:figma_comments!figma_comment_id(author_name)
      `)
      .eq("workspace_id", workspaceId)
      .in("status", ["open", "needs_decision", "blocked"])
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(200),
    admin
      .from("profiles")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle(),
  ]);

  const items = (rows ?? []).map((item: RawItem) => {
    const project = item.project
      ? (Array.isArray(item.project) ? item.project[0] : item.project)
      : null;
    const comment = item.comment
      ? (Array.isArray(item.comment) ? item.comment[0] : item.comment)
      : null;
    return {
      id:                  item.id,
      status:              item.status,
      priority:            item.priority,
      ai_classification:   item.ai_classification,
      ai_key_question:     item.ai_key_question,
      ai_summary:          item.ai_summary,
      ai_risk_flag:        item.ai_risk_flag,
      ai_suggested_action: item.ai_suggested_action,
      owner_name:          item.owner_name,
      owner_profile_id:    item.owner_profile_id,
      author_name:         (comment as { author_name?: string | null } | null)?.author_name ?? null,
      project_id:          item.project_id,
      project_name:        (project as { name?: string } | null)?.name ?? null,
      created_at:          item.created_at,
      source:              "figma" as const,
    };
  });

  // Linked discussions: attach topic chip data to listed items
  const itemIds = items.map(i => i.id);
  const topicByItem = new Map<string, { title: string; count: number }>();
  if (itemIds.length > 0) {
    const { data: links } = await admin
      .from("topic_links")
      .select("topic_id, item_id")
      .eq("workspace_id", workspaceId)
      .eq("item_type", "feedback_item")
      .eq("status", "active")
      .in("item_id", itemIds);
    const linkRows = (links ?? []) as { topic_id: string; item_id: string }[];
    const topicIds = Array.from(new Set(linkRows.map(l => l.topic_id)));
    if (topicIds.length > 0) {
      const [{ data: topicRows }, { data: allLinks }] = await Promise.all([
        admin.from("topics").select("id, title").in("id", topicIds),
        admin.from("topic_links").select("topic_id").eq("status", "active").in("topic_id", topicIds),
      ]);
      const titleMap = new Map(((topicRows ?? []) as { id: string; title: string }[]).map(t => [t.id, t.title]));
      const countMap = new Map<string, number>();
      for (const l of (allLinks ?? []) as { topic_id: string }[]) {
        countMap.set(l.topic_id, (countMap.get(l.topic_id) ?? 0) + 1);
      }
      for (const l of linkRows) {
        const title = titleMap.get(l.topic_id);
        if (title) topicByItem.set(l.item_id, { title, count: countMap.get(l.topic_id) ?? 0 });
      }
    }
  }

  return NextResponse.json({
    items: items.map(i => ({
      ...i,
      topic_title: topicByItem.get(i.id)?.title ?? null,
      topic_count: topicByItem.get(i.id)?.count ?? 0,
    })),
    me: (myProfile as { id: string } | null)?.id ?? null,
  });
}
