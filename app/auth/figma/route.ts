import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));

  const params = new URLSearchParams({
    client_id:     process.env.FIGMA_CLIENT_ID!,
    redirect_uri:  process.env.FIGMA_REDIRECT_URI!,
    scope:         "files:read,file_comments:write",
    state:         user.id,
    response_type: "code",
  });

  return NextResponse.redirect(`https://www.figma.com/oauth?${params}`);
}
