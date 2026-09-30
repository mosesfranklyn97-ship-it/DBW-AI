import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

function safeNext(raw: string | null): string {
  if (!raw) return "/projects";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/projects";
  return raw;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const destination = new URL(safeNext(url.searchParams.get("next")), url.origin);

  if (!code) {
    destination.pathname = "/login";
    destination.searchParams.set("error", "Missing authorization code");
    return NextResponse.redirect(destination);
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    destination.pathname = "/login";
    destination.searchParams.set("error", "Supabase is not configured");
    return NextResponse.redirect(destination);
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    destination.pathname = "/login";
    destination.search = "";
    destination.searchParams.set("error", error.message);
    return NextResponse.redirect(destination);
  }

  return NextResponse.redirect(destination);
}
