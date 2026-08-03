import type { EnvironmentConfig } from "../config";
import type {
  ExportedComponent,
  ExportedField,
  FieldValue,
  PageExport,
} from "../types";
import { EdgeError, edgeGraphQL } from "./edge-client";

// Edge layout API crawl.
//
// One call per page returns the layout JSON: page fields *and* every
// component's datasource fields, already resolved by Sitecore. That single
// request per page is the whole export pipeline — which is also why a large
// export should be run off-peak against the CM preview endpoint.

const LAYOUT_QUERY = `query GetPageLayout($siteName: String!, $routePath: String!, $language: String!) {
  layout(site: $siteName, routePath: $routePath, language: $language) {
    item {
      rendered
    }
  }
}`;

const SITES_QUERY = `query GetSites {
  site {
    siteInfoCollection {
      name
      hostName
      language
    }
  }
}`;

interface SiteLocation {
  segments: string[];
  /** Index of the site root item, e.g. "acme-us". */
  rootIndex: number;
  /** Index of the /Home node, or -1 when the site has none. */
  homeIndex: number;
}

/**
 * Locates the site root inside a content path. Both the site name and the route
 * are derived from this one answer so they can never disagree.
 *
 *   /sitecore/content/org/acme-us/Home/about  →  root "acme-us", home present
 *   /sitecore/content/org/site/landing         →  root "site"     (org/site shape)
 *   /sitecore/content/MySite/landing           →  root "MySite"   (classic shape)
 */
function locateSite(itemPath: string): SiteLocation | null {
  const segments = itemPath.split("/").filter(Boolean);
  const contentIndex = segments.findIndex((s) => s.toLowerCase() === "content");
  if (contentIndex === -1) return null;

  const homeIndex = segments.findIndex(
    (s, i) => i > contentIndex && s.toLowerCase() === "home",
  );
  // The site root is the item directly above /Home.
  if (homeIndex > contentIndex + 1) {
    return { segments, rootIndex: homeIndex - 1, homeIndex };
  }

  // No /Home node. XM Cloud usually nests sites one level deep under an
  // organisation folder; fall back to the classic single-level shape when the
  // path is too short for that.
  const rootIndex =
    segments.length > contentIndex + 2 ? contentIndex + 2 : contentIndex + 1;
  if (rootIndex >= segments.length) return null;
  return { segments, rootIndex, homeIndex: -1 };
}

/**
 * XM Cloud site name from a content path — the segment before /Home.
 *   /sitecore/content/org/acme-us/Home/about  →  "acme-us"
 */
export function siteNameFromPath(itemPath: string): string | undefined {
  const location = locateSite(itemPath);
  return location ? location.segments[location.rootIndex] : undefined;
}

/**
 * Route path for the layout query — everything below the site root, with the
 * /Home node itself collapsed to "/".
 *   /sitecore/content/org/site/Home        →  "/"
 *   /sitecore/content/org/site/Home/about  →  "/about"
 *   /sitecore/content/org/site/landing     →  "/landing"
 */
export function sitecorePathToRoute(itemPath: string): string {
  const location = locateSite(itemPath);
  if (!location) return "/";
  const { segments, rootIndex, homeIndex } = location;
  const tail = segments.slice(homeIndex === -1 ? rootIndex + 1 : homeIndex + 1);
  return tail.length === 0 ? "/" : `/${tail.join("/")}`;
}

// --- layout JSON shapes ----------------------------------------------------

interface LayoutField {
  value?: unknown;
  [key: string]: unknown;
}

interface LayoutComponent {
  uid?: string;
  componentName?: string;
  dataSource?: string;
  params?: Record<string, string>;
  fields?: Record<string, unknown>;
  placeholders?: Record<string, LayoutComponent[]>;
}

interface LayoutRoute {
  name?: string;
  displayName?: string;
  itemId?: string;
  templateName?: string;
  itemLanguage?: string;
  fields?: Record<string, unknown>;
  placeholders?: Record<string, LayoutComponent[]>;
}

interface RenderedLayout {
  sitecore?: {
    context?: Record<string, unknown>;
    route?: LayoutRoute | null;
  };
}

// --- field normalisation ---------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Turns a layout-service field into a plain, JSON-shaped value:
 *  - `{ value: "x" }`                 → "x"
 *  - `{ value: { src, alt } }`        → { src, alt }
 *  - `[{ id, fields: {…} }, …]`       → [{ id, … }, …]   (content lists)
 *  - `{ id, url, fields: {…} }`       → { id, url, … }   (item links)
 * Depth-capped so a cyclic or pathologically nested payload can't hang the
 * export.
 */
export function normalizeFieldValue(raw: unknown, depth = 0): FieldValue {
  if (depth > 12) return null;
  if (raw === null || raw === undefined) return null;

  if (Array.isArray(raw)) {
    return raw.map((entry) => normalizeFieldValue(entry, depth + 1));
  }

  if (
    typeof raw === "string" ||
    typeof raw === "number" ||
    typeof raw === "boolean"
  ) {
    return raw;
  }

  if (!isPlainObject(raw)) return String(raw);

  // A field wrapper: { value: … } plus optional metadata (editable, …).
  if ("value" in raw && !("fields" in raw)) {
    return normalizeFieldValue((raw as LayoutField).value, depth + 1);
  }

  // An item reference: { id, url, name, fields: { … } }. Flatten the nested
  // fields up alongside the identity so <item> elements read naturally.
  if ("fields" in raw && isPlainObject(raw.fields)) {
    const out: Record<string, FieldValue> = {};
    for (const key of ["id", "url", "name", "displayName", "templateName"]) {
      const value = raw[key];
      if (typeof value === "string" && value) out[key] = value;
    }
    for (const [key, value] of Object.entries(raw.fields)) {
      out[key] = normalizeFieldValue(value, depth + 1);
    }
    return out;
  }

  const out: Record<string, FieldValue> = {};
  for (const [key, value] of Object.entries(raw)) {
    // Layout-service bookkeeping that carries no content.
    if (key === "editable" || key === "editableFirstPart") continue;
    out[key] = normalizeFieldValue(value, depth + 1);
  }
  return out;
}

export function normalizeFields(
  fields: Record<string, unknown> | undefined,
): ExportedField[] {
  if (!fields) return [];
  return Object.entries(fields).map(([name, value]) => ({
    name,
    value: normalizeFieldValue(value),
  }));
}

/** Depth-first walk of the placeholder tree, flattened to a component list. */
export function flattenPlaceholders(
  placeholders: Record<string, LayoutComponent[]> | undefined,
  options: { skipPlaceholderKeys?: readonly string[] } = {},
): ExportedComponent[] {
  const skip = new Set(
    (options.skipPlaceholderKeys ?? []).map((k) => k.toLowerCase()),
  );
  const out: ExportedComponent[] = [];

  const walk = (
    map: Record<string, LayoutComponent[]> | undefined,
    depth: number,
  ) => {
    if (!map || depth > 12) return;
    for (const [key, components] of Object.entries(map)) {
      // Placeholder keys are dynamic in SXA ("headless-main-{uid}-0"); match on
      // the base name so nested instances are skipped too.
      const baseKey = key.split("-{")[0].toLowerCase();
      if (skip.has(baseKey) || skip.has(key.toLowerCase())) continue;
      if (!Array.isArray(components)) continue;

      components.forEach((component, index) => {
        if (!component?.componentName) {
          // Nested placeholder-only entries still carry children.
          walk(component?.placeholders, depth + 1);
          return;
        }
        out.push({
          index,
          type: component.componentName,
          uid: component.uid,
          placeholderKey: key,
          datasourcePath: component.dataSource || undefined,
          params:
            component.params && Object.keys(component.params).length > 0
              ? component.params
              : undefined,
          fields: normalizeFields(component.fields),
        });
        walk(component.placeholders, depth + 1);
      });
    }
  };

  walk(placeholders, 0);
  return out;
}

// --- the crawl ------------------------------------------------------------

export interface EdgeSiteInfo {
  name: string;
  hostName?: string;
  language?: string;
}

/** Site definitions published to Edge — used by the UI to sanity-check paths. */
export async function getSites(
  env: EnvironmentConfig & { apiKey: string },
): Promise<EdgeSiteInfo[]> {
  const data = await edgeGraphQL<{
    site?: { siteInfoCollection?: EdgeSiteInfo[] };
  }>(env, SITES_QUERY, {});
  return data.site?.siteInfoCollection ?? [];
}

export interface EdgeCrawlOptions {
  language: string;
  skipSharedPlaceholders: boolean;
  sharedPlaceholderKeys: readonly string[];
  /** Overrides the site name derived from the item path. */
  siteName?: string;
}

/**
 * Exports one page through the Edge layout API. Returns null when the route
 * resolves to nothing (unpublished, wrong site, wrong language) so the caller
 * can fall back to the authoring crawler.
 */
export async function exportPageViaEdge(
  env: EnvironmentConfig & { apiKey: string },
  itemPath: string,
  options: EdgeCrawlOptions,
): Promise<PageExport | null> {
  const siteName = options.siteName ?? siteNameFromPath(itemPath);
  if (!siteName) {
    throw new EdgeError(
      `Could not derive a site name from "${itemPath}" — expected a path under /sitecore/content`,
    );
  }
  const routePath = sitecorePathToRoute(itemPath);

  const data = await edgeGraphQL<{
    layout?: { item?: { rendered?: RenderedLayout | string } | null } | null;
  }>(env, LAYOUT_QUERY, {
    siteName,
    routePath,
    language: options.language,
  });

  const renderedRaw = data.layout?.item?.rendered;
  if (!renderedRaw) return null;

  // `rendered` is a JSON scalar — usually an object, occasionally a string.
  let rendered: RenderedLayout;
  try {
    rendered =
      typeof renderedRaw === "string"
        ? (JSON.parse(renderedRaw) as RenderedLayout)
        : renderedRaw;
  } catch {
    throw new EdgeError(
      `Edge layout API returned unparsable JSON for "${itemPath}"`,
    );
  }

  const route = rendered.sitecore?.route;
  if (!route) return null;

  const components = flattenPlaceholders(route.placeholders, {
    skipPlaceholderKeys: options.skipSharedPlaceholders
      ? options.sharedPlaceholderKeys
      : [],
  });

  const name = route.name || itemPath.split("/").filter(Boolean).pop() || "";

  return {
    itemPath,
    itemId: route.itemId,
    name,
    displayName: route.displayName || undefined,
    templateName: route.templateName || undefined,
    language: route.itemLanguage || options.language,
    route: routePath,
    siteName,
    fields: normalizeFields(route.fields),
    components,
    warnings: [],
  };
}
