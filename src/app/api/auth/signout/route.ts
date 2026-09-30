import { NextResponse } from "next/server";
import { canonicalOrigin, createSupabaseServerClient } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  if (supabase) await supabase.auth.signOut();

  const wantsJson = (request.headers.get("accept") ?? "").includes("application/json");
  if (wantsJson) return Response.json({ ok: true });

  return NextResponse.redirect(new URL("/", canonicalOrigin(request.url)), { status: 303 });
}
