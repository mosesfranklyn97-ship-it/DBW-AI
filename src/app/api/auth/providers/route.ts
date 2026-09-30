import { getProviderStatus } from "@/lib/server/authProviders";

export const dynamic = "force-dynamic";

/**
 * Tells the login page which buttons to draw. Without this the UI advertises
 * methods that may not be configured, and a disabled provider fails as a
 * redirect error rather than an honest "unavailable".
 */
export async function GET() {
  const status = await getProviderStatus();
  return Response.json(status, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
