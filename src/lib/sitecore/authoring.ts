import type { EnvironmentConfig } from "../config";
import { getEnvironmentToken } from "./env-token";

// Thin client for the XM Cloud Authoring & Management GraphQL API.
//
// Scope: content tree browsing only. The export pipeline reads content through
// the Edge API — this is here so the tree can show what exists in `master`,
// including items that have never been published.
//
// The Authoring schema has shifted between XM Cloud releases (notably around
// how `Item.children` is shaped). Rather than pinning to one spelling and
// failing hard on older/newer environments, callers hand `graphqlFirstSuccess`
// a list of candidate documents; the first one the server accepts wins and is
// remembered for the rest of the process.

export class GraphQLError extends Error {
  constructor(
    message: string,
    /** True when the server rejected the *document*, not the data. */
    public readonly isValidationError: boolean,
  ) {
    super(message);
  }
}

interface GraphQLBody<T> {
  data?: T | null;
  errors?: Array<{ message?: string; extensions?: { code?: string } }>;
}

export function authoringEndpoint(env: EnvironmentConfig): string {
  return `${env.host}/sitecore/api/authoring/graphql/v1`;
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

export async function authoringGraphQL<T>(
  env: EnvironmentConfig,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const token = await getEnvironmentToken(env);
  const endpoint = authoringEndpoint(env);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (err) {
    // Bare "fetch failed" tells the operator nothing — name the host.
    throw new GraphQLError(
      `Could not reach the Authoring API at ${endpoint}: ${
        err instanceof Error ? err.message : String(err)
      }`,
      false,
    );
  }

  const body = (await response.json().catch(() => null)) as GraphQLBody<T> | null;

  if (!response.ok) {
    const detail =
      body?.errors?.map((e) => e.message).join("; ") ??
      (body as { detail?: string; title?: string } | null)?.detail ??
      (body as { title?: string } | null)?.title ??
      response.statusText;
    throw new GraphQLError(
      `Authoring API request failed (${response.status}): ${detail}`,
      response.status === 400,
    );
  }

  // GraphQL failures come back as HTTP 200 with an errors array.
  if (body?.errors?.length) {
    const message = body.errors.map((e) => e.message ?? "unknown").join("; ");
    throw new GraphQLError(
      `Authoring API error: ${message}`,
      looksLikeValidationError(message),
    );
  }

  if (!body || body.data === undefined || body.data === null) {
    throw new GraphQLError("Authoring API returned no data", false);
  }
  return body.data;
}

/** Remembers which candidate document a given environment accepted. */
const acceptedVariant = new Map<string, number>();

/**
 * Runs the candidate documents in order until one is accepted. Only *document*
 * rejections advance to the next candidate — data errors (item not found,
 * permission denied) propagate immediately.
 */
export async function graphqlFirstSuccess<T>(
  env: EnvironmentConfig,
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
      const data = await authoringGraphQL<T>(env, candidates[index], variables);
      acceptedVariant.set(key, index);
      return data;
    } catch (err) {
      lastError = err;
      if (err instanceof GraphQLError && err.isValidationError) continue;
      throw err;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Authoring API rejected every known query shape");
}

/** Test seam. */
export function clearVariantCacheForTests(): void {
  acceptedVariant.clear();
}
