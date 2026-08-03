import { NextResponse } from "next/server";
import { withOrgAdmin } from "@/src/lib/auth/guard";
import { AuthError } from "@/src/lib/auth/verify-user";
import { getEnvironment, requireApiKey } from "@/src/lib/config";
import { getSites } from "@/src/lib/sitecore/edge-layout";

export const dynamic = "force-dynamic";

/** GET /api/sites?environment=Dev — site definitions published to Edge. */
export async function GET(request: Request) {
  return withOrgAdmin(request, async () => {
    const environment = new URL(request.url).searchParams.get("environment");
    if (!environment) {
      throw new AuthError("environment is required", 400);
    }

    const env = getEnvironment(environment);
    requireApiKey(env);

    return NextResponse.json({ sites: await getSites(env) });
  });
}
