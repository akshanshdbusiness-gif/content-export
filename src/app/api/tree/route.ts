import { NextResponse } from "next/server";
import { withOrgAdmin } from "@/src/lib/auth/guard";
import { AuthError } from "@/src/lib/auth/verify-user";
import { getEnvironment, requireAuthoringCredentials } from "@/src/lib/config";
import { getTreeLevel } from "@/src/lib/sitecore/tree";

export const dynamic = "force-dynamic";

/** GET /api/tree?environment=Dev&path=/sitecore/content&language=en */
export async function GET(request: Request) {
  return withOrgAdmin(request, async () => {
    const url = new URL(request.url);
    const environment = url.searchParams.get("environment");
    const path = url.searchParams.get("path") ?? "/sitecore/content";
    const language = url.searchParams.get("language") ?? "en";

    if (!environment) {
      throw new AuthError("environment is required", 400);
    }
    if (!path.startsWith("/sitecore")) {
      throw new AuthError("path must start with /sitecore", 400);
    }

    const env = getEnvironment(environment);
    requireAuthoringCredentials(env);

    const level = await getTreeLevel(env, path, language);
    if (!level.item) {
      throw new AuthError(
        `Item "${path}" was not found in ${environment} (language "${language}")`,
        404,
      );
    }

    return NextResponse.json(level);
  });
}
