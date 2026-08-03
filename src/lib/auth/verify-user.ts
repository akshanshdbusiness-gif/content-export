import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { authConfig, isAuthDisabled } from "../config";

// The backend is the real authorization gate: app visibility in the portal is
// UX only. Every API route must go through withOrgAdmin() before doing
// anything — unless DISABLE_AUTH=true, which is for local/internal use only.

export class AuthError extends Error {
  constructor(
    message: string,
    public status: number = 401,
  ) {
    super(message);
  }
}

// Lazily created: constructing it at module load would resolve the JWKS URL
// even in DISABLE_AUTH deployments that never verify a token.
let jwksCache: ReturnType<typeof createRemoteJWKSet> | undefined;
function getJwks() {
  jwksCache ??= createRemoteJWKSet(
    new URL(`${authConfig.domain}/.well-known/jwks.json`),
  );
  return jwksCache;
}

// Sitecore user tokens carry claims under namespaced keys; the exact keys can
// differ per tenant/product. Check the common candidates.
const ORG_CLAIM_KEYS = ["org_id", "https://auth.sitecorecloud.io/claims/org_id"];
const ROLE_CLAIM_KEYS = [
  "roles",
  "https://auth.sitecorecloud.io/claims/roles",
  "https://auth.sitecorecloud.io/roles",
];

function readClaim(payload: JWTPayload, keys: string[]): unknown {
  for (const key of keys) {
    if (payload[key] !== undefined) return payload[key];
  }
  return undefined;
}

export interface VerifiedUser {
  sub: string;
  orgId: string;
  roles: string[];
  /** True when the request was let through by DISABLE_AUTH. */
  authDisabled?: boolean;
}

export async function verifyOrgAdmin(request: Request): Promise<VerifiedUser> {
  if (isAuthDisabled()) {
    return {
      sub: "auth-disabled",
      orgId: process.env.SITECORE_ORG_ID ?? "unknown",
      roles: [],
      authDisabled: true,
    };
  }

  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    throw new AuthError("Missing bearer token");
  }
  const token = header.slice("Bearer ".length);

  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, getJwks(), {
      issuer: `${authConfig.domain}/`,
      audience: authConfig.userTokenAudience,
    }));
  } catch (err) {
    throw new AuthError(
      `Token verification failed: ${err instanceof Error ? err.message : "unknown error"}`,
    );
  }

  const orgId = readClaim(payload, ORG_CLAIM_KEYS);
  if (typeof orgId !== "string" || orgId !== authConfig.organizationId) {
    throw new AuthError("Token does not belong to this organization", 403);
  }

  const rawRoles = readClaim(payload, ROLE_CLAIM_KEYS);
  const roles = Array.isArray(rawRoles)
    ? rawRoles.filter((r): r is string => typeof r === "string")
    : typeof rawRoles === "string"
      ? [rawRoles]
      : [];

  const isAdmin = roles.some((role) =>
    authConfig.adminRolePatterns.some((pattern) => role.includes(pattern)),
  );
  if (!isAdmin) {
    throw new AuthError(
      "Content export requires the Organization Admin or Organization Owner role",
      403,
    );
  }

  return { sub: payload.sub ?? "unknown", orgId, roles };
}
