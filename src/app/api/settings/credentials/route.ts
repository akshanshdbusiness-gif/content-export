import { NextResponse } from "next/server";
import { withOrgAdmin } from "@/src/lib/auth/guard";
import { AuthError } from "@/src/lib/auth/verify-user";
import {
  addRuntimeEnvironments,
  areRuntimeCredentialsAllowed,
  getEnvironments,
  getEnvironmentSource,
  parseEnvironmentEntry,
  parseEnvironmentsJson,
  removeRuntimeEnvironment,
} from "@/src/lib/config";
import { isLikelyLiveEdgeHost } from "@/src/lib/sitecore/edge-client";

export const dynamic = "force-dynamic";

// Runtime credential store: environments added here live in server memory for
// the lifetime of the process and are never written to disk. Responses never
// echo secrets back — only which capabilities each environment has.

function summary() {
  return getEnvironments().map((e) => ({
    name: e.name,
    host: e.host,
    hasApiKey: Boolean(e.apiKey),
    hasAuthoring: Boolean(e.clientId && e.clientSecret),
    isLiveEdgeHost: isLikelyLiveEdgeHost(e.host),
    source: getEnvironmentSource(e.name),
  }));
}

export async function GET(request: Request) {
  return withOrgAdmin(request, async () =>
    NextResponse.json({
      environments: summary(),
      allowRuntimeCredentials: areRuntimeCredentialsAllowed(),
    }),
  );
}

/**
 * POST body is either:
 *   { "json": "[{...}]" }            — paste of a SITECORE_ENVIRONMENTS value
 *   { "environment": { name, host, … } } — a single environment
 */
export async function POST(request: Request) {
  return withOrgAdmin(request, async () => {
    if (!areRuntimeCredentialsAllowed()) {
      throw new AuthError(
        "Runtime credentials are disabled on this deployment",
        403,
      );
    }

    const body = (await request.json().catch(() => {
      throw new AuthError("Request body is not valid JSON", 400);
    })) as { json?: unknown; environment?: unknown };

    let parsed;
    try {
      if (typeof body.json === "string" && body.json.trim()) {
        parsed = parseEnvironmentsJson(body.json);
      } else if (body.environment) {
        parsed = [parseEnvironmentEntry(body.environment)];
      } else {
        throw new Error('Provide either "json" or "environment"');
      }
    } catch (err) {
      throw new AuthError(
        err instanceof Error ? err.message : String(err),
        400,
      );
    }

    addRuntimeEnvironments(parsed);
    return NextResponse.json({
      added: parsed.map((e) => e.name),
      environments: summary(),
    });
  });
}

/** DELETE /api/settings/credentials?name=Dev — drops a runtime environment. */
export async function DELETE(request: Request) {
  return withOrgAdmin(request, async () => {
    const name = new URL(request.url).searchParams.get("name");
    if (!name) {
      throw new AuthError("name is required", 400);
    }
    const removed = removeRuntimeEnvironment(name);
    if (!removed) {
      throw new AuthError(
        `"${name}" is not a runtime environment (environments from SITECORE_ENVIRONMENTS cannot be removed here)`,
        400,
      );
    }
    return NextResponse.json({ removed: name, environments: summary() });
  });
}
