import type { EnvironmentConfig } from "../config";
import {
  SHARED_PLACEHOLDER_KEYS,
  type ExportRequest,
  type ExportResult,
  type PageExport,
} from "../types";
import { exportPageViaEdge } from "../sitecore/edge-layout";
import { collectPagePaths } from "../sitecore/tree";

// The export runs entirely on the Edge layout API: one request per page returns
// the page fields and every component's resolved datasource fields.
//
// The Authoring API appears here in exactly one place — expanding an
// ItemAndDescendants selection into concrete page paths, which needs to read
// the content tree. No page content is ever read through it.
//
// Pages are crawled SEQUENTIALLY and deliberately so. Issuing the layout
// requests in parallel is the quickest way to trip Sitecore's rate limiter and,
// on a delivery host, to degrade production sites. Do not parallelise this loop
// without adding a concurrency limiter and a retry/backoff.

/** Hard cap so a mis-clicked root selection can't run for an hour. */
export const MAX_PAGES_PER_EXPORT = 250;

async function resolvePaths(
  env: EnvironmentConfig & { apiKey: string },
  request: ExportRequest,
  warnings: string[],
): Promise<string[]> {
  const paths: string[] = [];
  const seen = new Set<string>();

  const add = (path: string) => {
    const key = path.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    paths.push(path);
  };

  for (const item of request.items) {
    const path = item.itemPath.trim();
    if (!path.startsWith("/sitecore/")) {
      warnings.push(`Skipped "${path}" — not a /sitecore path`);
      continue;
    }

    if (item.scope === "SingleItem") {
      add(path);
      continue;
    }

    // Expanding a subtree walks the content tree, which is Authoring-only.
    if (!env.clientId || !env.clientSecret) {
      warnings.push(
        `"${path}" was exported on its own — expanding descendants needs an automation client (clientId/clientSecret) on environment "${env.name}"`,
      );
      add(path);
      continue;
    }

    const { paths: found, truncated } = await collectPagePaths(
      env,
      path,
      request.language,
      { includeSelf: true, maxItems: MAX_PAGES_PER_EXPORT },
    );
    if (truncated) {
      warnings.push(
        `"${path}" has more than ${MAX_PAGES_PER_EXPORT} pages — the export was truncated`,
      );
    }
    if (found.length === 0) {
      warnings.push(`"${path}" and its descendants contain no pages with presentation`);
    }
    for (const foundPath of found) add(foundPath);
  }

  return paths.slice(0, MAX_PAGES_PER_EXPORT);
}

export async function runExport(
  env: EnvironmentConfig & { apiKey: string },
  request: ExportRequest,
): Promise<ExportResult> {
  const warnings: string[] = [];
  const paths = await resolvePaths(env, request, warnings);

  if (paths.length === 0) {
    return { pages: [], warnings };
  }

  const pages: PageExport[] = [];

  for (const path of paths) {
    let page: PageExport | null;
    try {
      page = await exportPageViaEdge(env, path, {
        language: request.language,
        skipSharedPlaceholders: request.skipSharedPlaceholders,
        sharedPlaceholderKeys: SHARED_PLACEHOLDER_KEYS,
      });
    } catch (err) {
      warnings.push(
        `Skipped "${path}": ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }

    if (!page) {
      // The tree reads master, Edge serves published content — so a page can be
      // visible and tickable in the tree yet resolve to nothing here.
      warnings.push(
        `Skipped "${path}": the Edge layout API returned no route for language "${request.language}" — the page may be unpublished, or the site name derived from the path may be wrong`,
      );
      continue;
    }

    // The layout response has no notion of system fields or of skipping the
    // component crawl — apply those options here.
    if (!request.includeSystemFields) {
      page.fields = page.fields.filter((f) => !f.name.startsWith("__"));
    }
    if (!request.includeComponents) {
      page.components = [];
    }

    pages.push(page);
  }

  return { pages, warnings };
}
