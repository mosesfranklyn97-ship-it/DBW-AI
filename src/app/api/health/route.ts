import { db } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * Only DATABASE_URL is load-bearing: without it every read and write fails.
 * The Supabase keys just switch auth off, and the app still runs on anonymous
 * workspaces, so they are reported as advisories rather than failing the check.
 */
const ADVISORY = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"] as const;

export async function GET() {
  const missing = [
    ...(process.env.DATABASE_URL ? [] : ["DATABASE_URL"]),
    // Names only. A health endpoint is public, so it must never echo a secret.
    ...ADVISORY.filter((name) => !process.env[name]),
  ];

  let database: "ok" | "unreachable" = "ok";
  try {
    await db.execute(sql`select 1`);
  } catch {
    database = "unreachable";
  }

  const ok = database === "ok" && Boolean(process.env.DATABASE_URL);

  return Response.json(
    {
      ok,
      database,
      missing,
      ai: Boolean(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY),
      // Without this, signup depends on "Confirm email" being off in the
      // Dashboard plus working mail delivery, and fails silently when either
      // is missing. Reported by name presence only — never the value.
      instantSignup: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    },
    { status: ok ? 200 : 500 },
  );
}
