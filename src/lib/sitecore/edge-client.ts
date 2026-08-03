import type { EnvironmentConfig } from "../config";

// Transport for the XM Cloud Edge GraphQL endpoint.
//
// The app deliberately targets the *preview* endpoint served by the CM host
// ({host}/sitecore/api/graph/edge), not the Experience Edge *delivery* API.
// Delivery is rate limited to 80 requests/second for the whole organisation,
// and an export issues one request per page back to back — enough to starve
// production sites. See isLikelyLiveEdgeHost() below.

export class EdgeError extends Error {
  constructor(
    message: string,
    /** True when the server rejected the *document*, not the data. */
    public readonly isValidationError: boolean = false,
  ) {
    super(message);
  }
}

export function edgeEndpoint(env: EnvironmentConfig): string {
  return `${env.host}/sitecore/api/graph/edge`;
}

/**
 * Experience Edge delivery hosts. Configuring one of these means every export
 * request counts against the organisation-wide 80 req/s delivery limit, so the
 * UI warns about it rather than silently hammering production.
 */
export function isLikelyLiveEdgeHost(host: string): boolean {
  return /(^|\/\/|\.)edge(-platform)?\.sitecorecloud\.io/i.test(host);
}

/**
 * A GraphQL error is a validation error (wrong document) rather than a data
 * error when the server complains about unknown fields/arguments or fails to
 * parse the query.
 */
function looksLikeValidationError(message: string): boolean {
  return /cannot query field|unknown argument|unknown field|does not exist on type|is not defined|syntax error|of required type|no such type|unknown type/i.test(
    message,
  );
}

export async function edgeGraphQL<T>(
  env: EnvironmentConfig & { apiKey: string },
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const endpoint = edgeEndpoint(env);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Header form keeps the key out of URLs, request logs and error strings.
        sc_apikey: env.apiKey,
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (err) {
    // Bare "fetch failed" tells the operator nothing — name the host.
    throw new EdgeError(
      `Could not reach the Edge API at ${endpoint}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  const body = (await response.json().catch(() => null)) as {
    data?: T | null;
    errors?: Array<{ message?: string }>;
  } | null;

  if (!response.ok) {
    const detail =
      body?.errors?.map((e) => e.message).join("; ") ?? response.statusText;
    // 429 is the delivery API's rate limiter — say so plainly.
    if (response.status === 429) {
      throw new EdgeError(
        `Edge API rate limit hit (429): ${detail}. Re-run during off-peak hours, and make sure the environment host is the CM preview endpoint rather than Experience Edge delivery.`,
      );
    }
    throw new EdgeError(
      `Edge API request failed (${response.status}): ${detail}`,
      response.status === 400,
    );
  }

  // GraphQL failures come back as HTTP 200 with an errors array.
  if (body?.errors?.length) {
    const message = body.errors.map((e) => e.message ?? "unknown").join("; ");
    throw new EdgeError(
      `Edge API error: ${message}`,
      looksLikeValidationError(message),
    );
  }

  if (!body || body.data === undefined || body.data === null) {
    throw new EdgeError("Edge API returned no data");
  }
  return body.data;
}

/** Remembers which candidate document a given environment accepted. */
const acceptedVariant = new Map<string, number>();

/**
 * Runs the candidate documents in order until one is accepted. Only *document*
 * rejections advance to the next candidate — data errors propagate immediately.
 * The Edge schema differs slightly between XM Cloud releases, so the tree
 * queries lean on this instead of pinning one spelling.
 */
export async function edgeFirstSuccess<T>(
  env: EnvironmentConfig & { apiKey: string },
  variantKey: string,
  candidates: string[],
  variables: Record<string, unknown>,
): Promise<T> {
  const key = `${env.name}::${variantKey}`;
  const remembered = acceptedVariant.get(key);
  const order =
    remembered === undefined
      ? candidates.map((_, i) => i)
      : [
          remembered,
          ...candidates.map((_, i) => i).filter((i) => i !== remembered),
        ];

  let lastError: unknown;
  for (const index of order) {
    try {
      const data = await edgeGraphQL<T>(env, candidates[index], variables);
      acceptedVariant.set(key, index);
      return data;
    } catch (err) {
      lastError = err;
      if (err instanceof EdgeError && err.isValidationError) continue;
      throw err;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new EdgeError("Edge API rejected every known query shape");
}

/** Test seam. */
export function clearVariantCacheForTests(): void {
  acceptedVariant.clear();
}
