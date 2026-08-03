import { NextResponse } from "next/server";
import { withOrgAdmin } from "@/src/lib/auth/guard";
import {
  areRuntimeCredentialsAllowed,
  getEnvironments,
  getEnvironmentSource,
} from "@/src/lib/config";
import { isLikelyLiveEdgeHost } from "@/src/lib/sitecore/edge-client";
import type { EnvironmentOption } from "@/src/lib/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withOrgAdmin(request, async () => {
    // Names and capability flags only — hosts, keys and secrets stay server-side.
    const environments: EnvironmentOption[] = getEnvironments().map((e) => ({
      value: e.name,
      label: e.name,
      hasApiKey: Boolean(e.apiKey),
      hasAuthoring: Boolean(e.clientId && e.clientSecret),
      isLiveEdgeHost: isLikelyLiveEdgeHost(e.host),
      contextId: e.contextId,
      source: getEnvironmentSource(e.name),
    }));

    return NextResponse.json({
      environments,
      allowRuntimeCredentials: areRuntimeCredentialsAllowed(),
    });
  });
}
