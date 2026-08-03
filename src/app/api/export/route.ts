import { NextResponse } from "next/server";
import { withOrgAdmin } from "@/src/lib/auth/guard";
import { AuthError } from "@/src/lib/auth/verify-user";
import { getEnvironment, requireApiKey } from "@/src/lib/config";
import { runExport } from "@/src/lib/exporters/run-export";
import { exportFilename, exportToXml } from "@/src/lib/exporters/xml-exporter";
import {
  EXPORT_SCOPES,
  type ExportRequest,
  type ExportScope,
} from "@/src/lib/types";

export const dynamic = "force-dynamic";
// Pages are crawled sequentially; give the platform room to finish.
export const maxDuration = 300;

function parseRequest(body: unknown): ExportRequest {
  if (typeof body !== "object" || body === null) {
    throw new AuthError("Request body must be a JSON object", 400);
  }
  const raw = body as Record<string, unknown>;

  const environment = raw.environment;
  if (typeof environment !== "string" || !environment) {
    throw new AuthError("environment is required", 400);
  }

  if (!Array.isArray(raw.items) || raw.items.length === 0) {
    throw new AuthError("items must be a non-empty array", 400);
  }
  const items = raw.items.map((entry, i) => {
    if (typeof entry !== "object" || entry === null) {
      throw new AuthError(`items[${i}] must be an object`, 400);
    }
    const item = entry as Record<string, unknown>;
    const itemPath = item.itemPath;
    if (typeof itemPath !== "string" || !itemPath.startsWith("/sitecore/")) {
      throw new AuthError(`items[${i}].itemPath must be a /sitecore path`, 400);
    }
    const scope = (item.scope ?? "SingleItem") as ExportScope;
    if (!EXPORT_SCOPES.includes(scope)) {
      throw new AuthError(
        `items[${i}].scope must be one of ${EXPORT_SCOPES.join(", ")}`,
        400,
      );
    }
    return { itemPath: itemPath.trim(), scope };
  });

  const language =
    typeof raw.language === "string" && raw.language.trim()
      ? raw.language.trim()
      : "en";

  const flag = (key: string, fallback: boolean): boolean =>
    typeof raw[key] === "boolean" ? (raw[key] as boolean) : fallback;

  return {
    environment,
    language,
    items,
    includeSystemFields: flag("includeSystemFields", false),
    includeComponents: flag("includeComponents", true),
    skipSharedPlaceholders: flag("skipSharedPlaceholders", true),
    keepHtml: flag("keepHtml", false),
  };
}

/** POST /api/export — crawls the selected pages and returns the XML file. */
export async function POST(request: Request) {
  return withOrgAdmin(request, async () => {
    const body = await request.json().catch(() => {
      throw new AuthError("Request body is not valid JSON", 400);
    });
    const exportRequest = parseRequest(body);
    const env = getEnvironment(exportRequest.environment);
    requireApiKey(env);

    const result = await runExport(env, exportRequest);

    if (result.pages.length === 0) {
      // Nothing to download — hand the reasons back as JSON so the UI can show
      // them instead of offering an empty file.
      return NextResponse.json(
        {
          error:
            "No pages could be exported. " +
            (result.warnings.join(" ") || "Check the path, language and site."),
          warnings: result.warnings,
        },
        { status: 422 },
      );
    }

    const filename = exportFilename(result.pages);
    const xml = exportToXml(result, {
      environment: exportRequest.environment,
      language: exportRequest.language,
      keepHtml: exportRequest.keepHtml,
    });

    const totalComponents = result.pages.reduce(
      (sum, p) => sum + p.components.length,
      0,
    );

    return new Response(xml, {
      headers: {
        "content-type": "application/xml; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        // Surfaced in the UI without having to parse the downloaded file.
        "x-export-pages": String(result.pages.length),
        "x-export-components": String(totalComponents),
        "x-export-warnings": String(result.warnings.length),
      },
    });
  });
}
