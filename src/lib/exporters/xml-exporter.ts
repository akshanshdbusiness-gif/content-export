import type {
  ExportedComponent,
  ExportedField,
  ExportResult,
  FieldValue,
  PageExport,
} from "../types";

// PageExport[] → structured XML, the only output format.
//
// The point of XML here is that nested field values survive: image and link
// objects become child elements, content lists become <item> elements. Nothing
// is emitted as an escaped JSON blob.

export interface XmlExportOptions {
  environment: string;
  language: string;
  /** Keep rich-text markup verbatim instead of flattening it to plain text. */
  keepHtml: boolean;
  exportedAt?: string;
}

const INDENT = "  ";

/**
 * XML 1.0 forbids most control characters outright; only tab, LF and CR are
 * legal. Drop the rest rather than emit a document no parser will accept.
 */
export function stripInvalidXmlChars(value: string): string {
  let out = "";
  for (const char of value) {
    const code = char.codePointAt(0) as number;
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) continue;
    if (code === 0x7f) continue;
    out += char;
  }
  return out;
}

export function escapeXmlText(value: string): string {
  return stripInvalidXmlChars(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value).replace(/"/g, "&quot;").replace(/\r?\n/g, " ");
}

/**
 * Sitecore field names become XML element names in nested values, and they are
 * not guaranteed to be valid NCNames ("Card List", "2col"). Sanitise, and fall
 * back to <value> when nothing usable remains.
 */
export function toElementName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[^\w.-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!cleaned) return "value";
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `_${cleaned}`;
}

/** Collapses HTML markup to readable plain text. */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function looksLikeHtml(value: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(value);
}

function renderScalar(value: string, keepHtml: boolean): string {
  const text = !keepHtml && looksLikeHtml(value) ? htmlToText(value) : value;
  return escapeXmlText(text);
}

/**
 * Renders a normalised field value as XML children (or inline text).
 * Returns the lines to place inside the owning element.
 */
function renderValue(
  value: FieldValue,
  indent: string,
  keepHtml: boolean,
): { inline: string | null; lines: string[] } {
  if (value === null || value === undefined) {
    return { inline: "", lines: [] };
  }
  if (typeof value === "string") {
    return { inline: renderScalar(value, keepHtml), lines: [] };
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return { inline: String(value), lines: [] };
  }
  if (Array.isArray(value)) {
    const lines: string[] = [];
    for (const entry of value) {
      lines.push(...renderElement("item", entry, indent, keepHtml));
    }
    return { inline: null, lines };
  }

  const lines: string[] = [];
  for (const [key, entry] of Object.entries(value)) {
    lines.push(...renderElement(toElementName(key), entry, indent, keepHtml));
  }
  return { inline: null, lines };
}

function renderElement(
  tag: string,
  value: FieldValue,
  indent: string,
  keepHtml: boolean,
  attributes = "",
): string[] {
  const rendered = renderValue(value, indent + INDENT, keepHtml);
  if (rendered.inline !== null) {
    if (rendered.inline === "") {
      return [`${indent}<${tag}${attributes} />`];
    }
    return [`${indent}<${tag}${attributes}>${rendered.inline}</${tag}>`];
  }
  if (rendered.lines.length === 0) {
    return [`${indent}<${tag}${attributes} />`];
  }
  return [
    `${indent}<${tag}${attributes}>`,
    ...rendered.lines,
    `${indent}</${tag}>`,
  ];
}

function attribute(name: string, value: string | undefined | null): string {
  if (value === undefined || value === null || value === "") return "";
  return ` ${name}="${escapeXmlAttribute(String(value))}"`;
}

function renderField(
  field: ExportedField,
  indent: string,
  keepHtml: boolean,
): string[] {
  const attributes = attribute("name", field.name);
  return renderElement("Field", field.value, indent, keepHtml, attributes);
}

function renderComponent(
  component: ExportedComponent,
  indent: string,
  keepHtml: boolean,
): string[] {
  const inner = indent + INDENT;
  const lines: string[] = [];
  const attributes =
    ` index="${component.index}"` +
    attribute("type", component.type) +
    attribute("uid", component.uid) +
    attribute("datasourcePath", component.datasourcePath);

  lines.push(`${indent}<Component${attributes}>`);

  if (component.params && Object.keys(component.params).length > 0) {
    lines.push(`${inner}<Params>`);
    for (const [key, value] of Object.entries(component.params)) {
      lines.push(
        ...renderElement(toElementName(key), value, inner + INDENT, keepHtml),
      );
    }
    lines.push(`${inner}</Params>`);
  }

  lines.push(`${inner}<Fields count="${component.fields.length}">`);
  for (const field of component.fields) {
    lines.push(...renderField(field, inner + INDENT, keepHtml));
  }
  lines.push(`${inner}</Fields>`);
  lines.push(`${indent}</Component>`);
  return lines;
}

function renderPage(
  page: PageExport,
  indent: string,
  keepHtml: boolean,
): string[] {
  const inner = indent + INDENT;
  const lines: string[] = [];

  const attributes =
    attribute("itemPath", page.itemPath) +
    attribute("itemId", page.itemId) +
    attribute("name", page.name) +
    attribute("displayName", page.displayName ?? page.name) +
    attribute("templateName", page.templateName) +
    attribute("language", page.language) +
    attribute("site", page.siteName) +
    attribute("route", page.route);

  lines.push(`${indent}<Page${attributes}>`);

  for (const warning of page.warnings) {
    lines.push(`${inner}<Warning>${escapeXmlText(warning)}</Warning>`);
  }

  lines.push(`${inner}<Fields count="${page.fields.length}">`);
  for (const field of page.fields) {
    lines.push(...renderField(field, inner + INDENT, keepHtml));
  }
  lines.push(`${inner}</Fields>`);

  // Group components back under their placeholders, preserving first-seen order.
  const byPlaceholder = new Map<string, ExportedComponent[]>();
  for (const component of page.components) {
    const bucket = byPlaceholder.get(component.placeholderKey);
    if (bucket) bucket.push(component);
    else byPlaceholder.set(component.placeholderKey, [component]);
  }

  lines.push(`${inner}<Presentation componentCount="${page.components.length}">`);
  for (const [key, components] of byPlaceholder) {
    lines.push(
      `${inner}${INDENT}<Placeholder key="${escapeXmlAttribute(key)}" componentCount="${components.length}">`,
    );
    for (const component of components) {
      lines.push(...renderComponent(component, inner + INDENT + INDENT, keepHtml));
    }
    lines.push(`${inner}${INDENT}</Placeholder>`);
  }
  lines.push(`${inner}</Presentation>`);
  lines.push(`${indent}</Page>`);
  return lines;
}

export function exportToXml(
  result: ExportResult,
  options: XmlExportOptions,
): string {
  const { pages, warnings } = result;
  const totalComponents = pages.reduce((sum, p) => sum + p.components.length, 0);
  const exportedAt = options.exportedAt ?? new Date().toISOString();

  const lines: string[] = ['<?xml version="1.0" encoding="UTF-8"?>'];
  lines.push(
    `<SitecoreExport version="1.0"` +
      attribute("exportedAt", exportedAt) +
      attribute("environment", options.environment) +
      attribute("language", options.language) +
      ` totalPages="${pages.length}" totalComponents="${totalComponents}">`,
  );

  if (warnings.length > 0) {
    lines.push(`${INDENT}<Warnings count="${warnings.length}">`);
    for (const warning of warnings) {
      lines.push(
        `${INDENT}${INDENT}<Warning>${escapeXmlText(warning)}</Warning>`,
      );
    }
    lines.push(`${INDENT}</Warnings>`);
  }

  lines.push(`${INDENT}<Pages count="${pages.length}">`);
  for (const page of pages) {
    lines.push(...renderPage(page, INDENT + INDENT, options.keepHtml));
  }
  lines.push(`${INDENT}</Pages>`);
  lines.push("</SitecoreExport>");

  return lines.join("\n") + "\n";
}

/** Filename used in the Content-Disposition header. */
export function exportFilename(pages: PageExport[], date = new Date()): string {
  const stamp = date.toISOString().slice(0, 10);
  const suffix = pages.length === 1 ? `-${pages[0].name}` : "";
  const safe = suffix.replace(/[^\w-]/g, "-");
  return `sitecore-export-${stamp}${safe}.xml`;
}
