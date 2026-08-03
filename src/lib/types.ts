// Shared types between the browser UI, the API routes and the export pipeline.

export const EXPORT_SCOPES = ["SingleItem", "ItemAndDescendants"] as const;
export type ExportScope = (typeof EXPORT_SCOPES)[number];

/** Shared placeholders excluded when "skip header/footer" is ticked. */
export const SHARED_PLACEHOLDER_KEYS = [
  "headless-header",
  "headless-footer",
  "sxa-header",
  "sxa-footer",
] as const;

/** One entry in the export — a path, alone or with its whole subtree. */
export interface ExportItemInput {
  itemPath: string;
  scope: ExportScope;
}

export interface ExportRequest {
  environment: string;
  language: string;
  items: ExportItemInput[];
  /** Include Sitecore standard fields (__Created, …) when layout exposes them. */
  includeSystemFields: boolean;
  /** Export component/datasource fields alongside the page fields. */
  includeComponents: boolean;
  /** Drop components sitting in SHARED_PLACEHOLDER_KEYS. */
  skipSharedPlaceholders: boolean;
  /** Keep rich-text markup verbatim instead of flattening it to plain text. */
  keepHtml: boolean;
}

/**
 * A field value after normalisation. Sitecore layout JSON nests objects
 * (images, links) and arrays (content lists); we keep that shape so the XML
 * exporter can render real child elements instead of escaped JSON.
 */
export type FieldValue =
  | string
  | number
  | boolean
  | null
  | FieldValue[]
  | { [key: string]: FieldValue };

export interface ExportedField {
  name: string;
  value: FieldValue;
}

export interface ExportedComponent {
  /** Position within its placeholder. */
  index: number;
  /** Rendering / component name, e.g. "CardGrid". */
  type: string;
  uid?: string;
  placeholderKey: string;
  datasourcePath?: string;
  /** Rendering parameters (GridParameters, FieldNames, …). */
  params?: Record<string, string>;
  fields: ExportedField[];
}

export interface PageExport {
  itemPath: string;
  itemId?: string;
  name: string;
  displayName?: string;
  templateName?: string;
  language: string;
  /** Route path used against the Edge layout API, e.g. "/about". */
  route?: string;
  /** XM Cloud site name derived from the item path. */
  siteName?: string;
  fields: ExportedField[];
  components: ExportedComponent[];
  warnings: string[];
}

export interface ExportResult {
  pages: PageExport[];
  /** Export-level problems (pages skipped, subtree truncated, …). */
  warnings: string[];
}

export interface TreeNode {
  itemId: string;
  name: string;
  displayName?: string;
  path: string;
  templateName?: string;
  hasChildren: boolean;
  /** True when the item has presentation — i.e. it is an exportable page. */
  hasLayout: boolean;
}

/** Environment as exposed to the browser — never carries credentials. */
export interface EnvironmentOption {
  value: string;
  label: string;
  /** Edge API key present — required to export anything. */
  hasApiKey: boolean;
  /** Automation client present — required to browse the content tree. */
  hasAuthoring: boolean;
  /**
   * True when the host looks like an Experience Edge *delivery* host, which is
   * subject to the organisation-wide 80 req/s limit. The UI warns about it.
   */
  isLiveEdgeHost: boolean;
  contextId?: string;
  /** "env" = from SITECORE_ENVIRONMENTS, "runtime" = added via the modal. */
  source: "env" | "runtime";
}
