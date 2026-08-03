// Server-side configuration. All secrets live here (env vars or the in-memory
// runtime store) and never reach the browser — only NEXT_PUBLIC_* values are
// compiled into the client bundle.

export interface EnvironmentConfig {
  /** Display name used in the environment dropdown, e.g. "Dev", "Prod". */
  name: string;
  /**
   * CM host, e.g. https://xmc-org-project-dev.sitecorecloud.io — the app talks
   * to that host's /sitecore/api/graph/edge *preview* endpoint. Do not point
   * this at an Experience Edge delivery host; see isLikelyLiveEdgeHost().
   */
  host: string;
  /** GraphQL API key — authenticates the Edge API, which runs the export. */
  apiKey?: string;
  /**
   * Automation client (client-credentials) for the Authoring GraphQL API.
   * Used only for browsing the content tree and expanding subtrees; the export
   * itself never touches the Authoring API.
   */
  clientId?: string;
  clientSecret?: string;
  /** Environment Context ID (Preview) from XM Cloud Deploy. Informational. */
  contextId?: string;
}

/** Source of an environment, so the UI can label runtime-added ones. */
export type EnvironmentSource = "env" | "runtime";

/**
 * A caller-fixable configuration problem (unknown environment, missing
 * credentials for the requested operation). Carries the HTTP status the API
 * guard should use, so these don't surface as opaque 500s.
 */
export class ConfigError extends Error {
  constructor(
    message: string,
    public readonly status: number = 400,
  ) {
    super(message);
  }
}

export function isAuthDisabled(): boolean {
  return process.env.DISABLE_AUTH === "true";
}

export function areRuntimeCredentialsAllowed(): boolean {
  // Opt-out rather than opt-in: the modal is the documented way to use the app
  // without baking secrets into env vars.
  return process.env.ALLOW_RUNTIME_CREDENTIALS !== "false";
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const authConfig = {
  /** Sitecore Cloud auth server (Auth0 tenant). */
  domain: process.env.SITECORE_AUTH_DOMAIN ?? "https://auth.sitecorecloud.io",
  /** Audience of the *user* token the frontend sends us. */
  userTokenAudience:
    process.env.SITECORE_USER_TOKEN_AUDIENCE ??
    "https://api-webapp.sitecorecloud.io",
  /** Audience requested for the *machine* tokens used against Sitecore APIs. */
  machineTokenAudience:
    process.env.SITECORE_MACHINE_TOKEN_AUDIENCE ??
    "https://api.sitecorecloud.io",
  get organizationId(): string {
    return required("SITECORE_ORG_ID");
  },
  /**
   * Role values (substring match) accepted as admin. Inspect a real user token
   * (jwt.io) and adjust SITECORE_ADMIN_ROLE_PATTERNS if your tenant uses
   * different role names.
   */
  adminRolePatterns: (
    process.env.SITECORE_ADMIN_ROLE_PATTERNS ??
    "Organization Admin,Organization Owner"
  )
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean),
};

function normalize(env: EnvironmentConfig): EnvironmentConfig {
  return {
    ...env,
    host: env.host.replace(/\/+$/, ""),
  };
}

/**
 * Validates one entry and returns it normalised. `name` and `host` are the hard
 * requirements; the credentials are checked at call time, so an environment can
 * have an apiKey (export only) or an automation client (tree only) or both.
 */
export function parseEnvironmentEntry(
  raw: unknown,
  label = "environment",
): EnvironmentConfig {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`${label} must be a JSON object`);
  }
  const entry = raw as Record<string, unknown>;
  for (const key of ["name", "host"]) {
    if (typeof entry[key] !== "string" || !(entry[key] as string).trim()) {
      throw new Error(`${label} is missing "${key}"`);
    }
  }
  const host = (entry.host as string).trim();
  if (!/^https?:\/\//i.test(host)) {
    throw new Error(`${label} "host" must be an absolute http(s) URL`);
  }
  const optional = (key: string): string | undefined => {
    const value = entry[key];
    if (value === undefined || value === null || value === "") return undefined;
    if (typeof value !== "string") {
      throw new Error(`${label} "${key}" must be a string`);
    }
    return value.trim() || undefined;
  };
  return normalize({
    name: (entry.name as string).trim(),
    host,
    apiKey: optional("apiKey"),
    clientId: optional("clientId"),
    clientSecret: optional("clientSecret"),
    contextId: optional("contextId"),
  });
}

export function parseEnvironmentsJson(raw: string): EnvironmentConfig[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Environments payload is not valid JSON");
  }
  const list = Array.isArray(parsed) ? parsed : [parsed];
  if (list.length === 0) {
    throw new Error("Environments payload must contain at least one entry");
  }
  return list.map((entry, i) =>
    parseEnvironmentEntry(entry, `Environment #${i + 1}`),
  );
}

let cachedEnvironments: EnvironmentConfig[] | undefined;

/**
 * SITECORE_ENVIRONMENTS is a JSON array. Unset is not fatal: the app can run
 * purely on runtime credentials entered through the modal.
 */
function getConfiguredEnvironments(): EnvironmentConfig[] {
  if (cachedEnvironments) return cachedEnvironments;
  const raw = process.env.SITECORE_ENVIRONMENTS;
  if (!raw?.trim()) {
    cachedEnvironments = [];
    return cachedEnvironments;
  }
  cachedEnvironments = parseEnvironmentsJson(raw);
  return cachedEnvironments;
}

// Runtime credential store — session-only, in memory, never written to disk.
// Kept on globalThis so the dev server's hot reload doesn't wipe it between
// module reloads.
const runtimeStore: Map<string, EnvironmentConfig> = (() => {
  const holder = globalThis as typeof globalThis & {
    __contentExportRuntimeEnvironments?: Map<string, EnvironmentConfig>;
  };
  holder.__contentExportRuntimeEnvironments ??= new Map();
  return holder.__contentExportRuntimeEnvironments;
})();

export function addRuntimeEnvironments(
  environments: EnvironmentConfig[],
): void {
  if (!areRuntimeCredentialsAllowed()) {
    throw new Error("Runtime credentials are disabled on this deployment");
  }
  for (const env of environments) {
    runtimeStore.set(env.name, normalize(env));
  }
}

export function removeRuntimeEnvironment(name: string): boolean {
  return runtimeStore.delete(name);
}

export function clearRuntimeEnvironments(): void {
  runtimeStore.clear();
}

/** Configured environments first, then runtime ones (runtime wins on name). */
export function getEnvironments(): EnvironmentConfig[] {
  const merged = new Map<string, EnvironmentConfig>();
  for (const env of getConfiguredEnvironments()) merged.set(env.name, env);
  for (const [name, env] of runtimeStore) merged.set(name, env);
  return [...merged.values()];
}

export function getEnvironmentSource(name: string): EnvironmentSource {
  return runtimeStore.has(name) ? "runtime" : "env";
}

export function getEnvironment(name: string): EnvironmentConfig {
  const env = getEnvironments().find((e) => e.name === name);
  if (!env) {
    throw new ConfigError(`Unknown environment "${name}"`, 404);
  }
  return env;
}

/**
 * Throws a helpful message when the content tree can't be browsed. Only the
 * tree needs this — the export runs on the Edge API alone.
 */
export function requireAuthoringCredentials(
  env: EnvironmentConfig,
): asserts env is EnvironmentConfig & {
  clientId: string;
  clientSecret: string;
} {
  if (!env.clientId || !env.clientSecret) {
    throw new ConfigError(
      `Environment "${env.name}" has no automation client. Add "clientId" and "clientSecret" to browse the content tree, or type page paths in manually.`,
    );
  }
}

/** Throws a helpful message when the Edge API can't be reached. */
export function requireApiKey(
  env: EnvironmentConfig,
): asserts env is EnvironmentConfig & { apiKey: string } {
  if (!env.apiKey) {
    throw new ConfigError(
      `Environment "${env.name}" has no GraphQL API key. Add "apiKey" — it is what the app authenticates to the Edge API with.`,
    );
  }
}

/** Test seam — drops the memoised SITECORE_ENVIRONMENTS parse. */
export function resetConfigCacheForTests(): void {
  cachedEnvironments = undefined;
}
