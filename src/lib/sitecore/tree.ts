import type { EnvironmentConfig } from "../config";
import type { TreeNode } from "../types";
import { graphqlFirstSuccess } from "./authoring";

// Content tree browsing via the Authoring GraphQL API.
//
// The tree reads `master`, so unpublished items are visible here even though
// the export itself goes through Edge and can only return published content.
// That mismatch is deliberate: you can see the whole tree, and the export
// tells you plainly when a selected page has not been published.
//
// `hasLayout` drives the "is this an exportable page?" affordance: an item with
// a non-empty __Renderings field has presentation, everything else is a folder
// or a data item.

const CHILD_FIELDS = `
  itemId
  name
  path
  displayName
  hasChildren
  template { name }
  renderings: field(name: "__Renderings") { value }
  finalRenderings: field(name: "__Final Renderings") { value }
`;

// Newer schemas expose children as a paged connection; older ones return a
// plain list. graphqlFirstSuccess() picks whichever this environment accepts.
const CHILDREN_QUERIES = [
  `query TreeChildren($path: String!, $language: String!) {
     item(where: { database: "master", path: $path, language: $language }) {
       itemId
       name
       path
       displayName
       hasChildren
       template { name }
       children(first: 500) {
         nodes { ${CHILD_FIELDS} }
       }
     }
   }`,
  `query TreeChildren($path: String!, $language: String!) {
     item(where: { database: "master", path: $path, language: $language }) {
       itemId
       name
       path
       displayName
       hasChildren
       template { name }
       children {
         nodes { ${CHILD_FIELDS} }
       }
     }
   }`,
  `query TreeChildren($path: String!, $language: String!) {
     item(where: { database: "master", path: $path, language: $language }) {
       itemId
       name
       path
       displayName
       hasChildren
       template { name }
       children { ${CHILD_FIELDS} }
     }
   }`,
];

interface RawItem {
  itemId?: string;
  name?: string;
  path?: string;
  displayName?: string;
  hasChildren?: boolean;
  template?: { name?: string } | null;
  renderings?: { value?: string } | null;
  finalRenderings?: { value?: string } | null;
  children?: { nodes?: RawItem[] } | RawItem[] | null;
}

function childrenOf(item: RawItem): RawItem[] {
  const children = item.children;
  if (!children) return [];
  if (Array.isArray(children)) return children;
  return children.nodes ?? [];
}

export function hasPresentation(item: {
  renderings?: { value?: string } | null;
  finalRenderings?: { value?: string } | null;
}): boolean {
  // Sitecore stores an empty presentation as "" or as a bare <r/> shell — only
  // a rendering placement (s:id) means the item actually renders as a page.
  const values = [item.renderings?.value, item.finalRenderings?.value];
  return values.some((value) => {
    if (!value) return false;
    const trimmed = value.trim();
    if (!trimmed) return false;
    return /<r[\s>]/i.test(trimmed) && /\ss:id=/i.test(trimmed);
  });
}

function toTreeNode(item: RawItem): TreeNode {
  return {
    itemId: item.itemId ?? "",
    name: item.name ?? "",
    displayName: item.displayName || undefined,
    path: item.path ?? "",
    templateName: item.template?.name || undefined,
    hasChildren: item.hasChildren ?? false,
    hasLayout: hasPresentation(item),
  };
}

export interface TreeLevel {
  /** The item that was asked for. */
  item: TreeNode | null;
  children: TreeNode[];
}

/** Lists the children of `path`, plus the node itself. */
export async function getTreeLevel(
  env: EnvironmentConfig,
  path: string,
  language: string,
): Promise<TreeLevel> {
  const data = await graphqlFirstSuccess<{ item: RawItem | null }>(
    env,
    "tree-children",
    CHILDREN_QUERIES,
    { path, language },
  );
  if (!data.item) {
    return { item: null, children: [] };
  }
  return {
    item: toTreeNode(data.item),
    children: childrenOf(data.item)
      .map(toTreeNode)
      .filter((node) => node.path)
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/**
 * Breadth-first walk collecting every descendant of `path` (inclusive) that has
 * presentation. Used by the ItemAndDescendants export scope.
 */
export async function collectPagePaths(
  env: EnvironmentConfig,
  path: string,
  language: string,
  options: { includeSelf?: boolean; maxItems?: number } = {},
): Promise<{ paths: string[]; truncated: boolean }> {
  const includeSelf = options.includeSelf ?? true;
  const maxItems = options.maxItems ?? 1000;
  const paths: string[] = [];
  const queue: string[] = [path];
  const seen = new Set<string>();
  let truncated = false;

  while (queue.length > 0) {
    if (paths.length >= maxItems) {
      truncated = true;
      break;
    }
    const current = queue.shift() as string;
    const key = current.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const level = await getTreeLevel(env, current, language);
    const isRoot = seen.size === 1;
    if (level.item?.hasLayout && (includeSelf || !isRoot)) {
      paths.push(level.item.path);
    }

    // Descend into anything that could hold pages; leaf data items are skipped.
    for (const child of level.children) {
      if (child.hasChildren || child.hasLayout) queue.push(child.path);
    }
  }

  return { paths, truncated };
}
