import { authConfig, type EnvironmentConfig } from "../config";

// Machine (client-credentials) tokens per environment, used for the Authoring
// GraphQL API that powers content tree browsing. The automation clients must
// belong to an identity with authoring rights on that environment.
//
// The export itself does not use these — it goes through the Edge API with the
// environment's API key.

interface CachedToken {
  token: string;
  expiresAt: number;
}

const tokenCache = new Map<string, CachedToken>();

/** Cache key includes the client id so rotating credentials invalidates it. */
function cacheKey(env: EnvironmentConfig): string {
  return `${env.name}::${env.clientId ?? ""}`;
}

export async function getEnvironmentToken(
  env: EnvironmentConfig,
): Promise<string> {
  if (!env.clientId || !env.clientSecret) {
    throw new Error(
      `Environment "${env.name}" has no automation client credentials`,
    );
  }

  const key = cacheKey(env);
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }

  const response = await fetch(`${authConfig.domain}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: env.clientId,
      client_secret: env.clientSecret,
      audience: authConfig.machineTokenAudience,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Failed to get token for environment "${env.name}" (${response.status}): ${body}`,
    );
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };

  tokenCache.set(key, {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  });
  return data.access_token;
}

/** Test seam. */
export function clearTokenCacheForTests(): void {
  tokenCache.clear();
}
