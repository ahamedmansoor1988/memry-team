import { NextRequest, NextResponse } from "next/server";

const NEW_KEY_COOKIE = "loupe_new_api_key";

/** Reads the just-minted API key set by /api/paypal-capture, then deletes the cookie — shown exactly once. */
export async function GET(req: NextRequest) {
  const key = req.cookies.get(NEW_KEY_COOKIE)?.value;
  const res = NextResponse.json({ key: key ?? null });
  if (key) res.cookies.delete(NEW_KEY_COOKIE);
  return res;
}
