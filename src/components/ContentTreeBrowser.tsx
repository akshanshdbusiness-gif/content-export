"use client";

import { useCallback, useEffect, useState } from "react";
import type { TreeNode } from "@/src/lib/types";

// Lazy, collapsible content tree. Children are fetched the first time a node is
// expanded and cached thereafter. Items without presentation (folders, data
// items) are greyed out and cannot be ticked — only pages are exportable.

interface ContentTreeBrowserProps {
  rootPath: string;
  environment: string;
  language: string;
  selected: Set<string>;
  onToggle: (node: TreeNode, checked: boolean) => void;
  /** Fetches one level of the tree. */
  loadLevel: (path: string) => Promise<{ item: TreeNode | null; children: TreeNode[] }>;
}

interface LevelState {
  status: "idle" | "loading" | "loaded" | "error";
  children: TreeNode[];
  error?: string;
}

export function ContentTreeBrowser({
  rootPath,
  environment,
  language,
  selected,
  onToggle,
  loadLevel,
}: ContentTreeBrowserProps) {
  const [levels, setLevels] = useState<Record<string, LevelState>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set([rootPath]));
  const [rootNode, setRootNode] = useState<TreeNode | null>(null);
  const [rootError, setRootError] = useState<string | null>(null);

  // Switching environment/language/root invalidates everything already fetched.
  useEffect(() => {
    setLevels({});
    setExpanded(new Set([rootPath]));
    setRootNode(null);
    setRootError(null);
  }, [environment, language, rootPath]);

  const fetchLevel = useCallback(
    async (path: string) => {
      setLevels((prev) => {
        if (prev[path]?.status === "loading" || prev[path]?.status === "loaded") {
          return prev;
        }
        return { ...prev, [path]: { status: "loading", children: [] } };
      });
      try {
        const level = await loadLevel(path);
        if (path === rootPath) setRootNode(level.item);
        setLevels((prev) => ({
          ...prev,
          [path]: { status: "loaded", children: level.children },
        }));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (path === rootPath) setRootError(message);
        setLevels((prev) => ({
          ...prev,
          [path]: { status: "error", children: [], error: message },
        }));
      }
    },
    [loadLevel, rootPath],
  );

  useEffect(() => {
    if (!environment) return;
    if (levels[rootPath]) return;
    void fetchLevel(rootPath);
  }, [environment, rootPath, levels, fetchLevel]);

  const toggleExpanded = (node: TreeNode) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(node.path)) {
        next.delete(node.path);
      } else {
        next.add(node.path);
        if (!levels[node.path]) void fetchLevel(node.path);
      }
      return next;
    });
  };

  const renderNode = (node: TreeNode): React.ReactNode => {
    const isExpanded = expanded.has(node.path);
    const level = levels[node.path];

    return (
      <div className="tree-node" key={node.path}>
        <div className="tree-row">
          <button
            type="button"
            className="tree-toggle"
            onClick={() => toggleExpanded(node)}
            disabled={!node.hasChildren}
            aria-label={isExpanded ? "Collapse" : "Expand"}
            aria-expanded={node.hasChildren ? isExpanded : undefined}
          >
            {node.hasChildren ? (isExpanded ? "▼" : "▶") : "•"}
          </button>

          <input
            type="checkbox"
            id={`node-${node.path}`}
            checked={selected.has(node.path)}
            disabled={!node.hasLayout}
            onChange={(e) => onToggle(node, e.target.checked)}
            title={
              node.hasLayout
                ? undefined
                : "This item has no presentation — nothing to export"
            }
          />
          <label
            className={`tree-label${node.hasLayout ? "" : " no-layout"}`}
            htmlFor={`node-${node.path}`}
          >
            {node.displayName || node.name}
            {node.templateName && (
              <span className="tree-template">{node.templateName}</span>
            )}
          </label>
        </div>

        {isExpanded && (
          <div className="tree-children">
            {level?.status === "loading" && (
              <div className="tree-loading">Loading…</div>
            )}
            {level?.status === "error" && (
              <div className="tree-loading error">{level.error}</div>
            )}
            {level?.status === "loaded" && level.children.length === 0 && (
              <div className="tree-empty">No children</div>
            )}
            {level?.status === "loaded" && level.children.map(renderNode)}
          </div>
        )}
      </div>
    );
  };

  if (!environment) {
    return <p className="hint">Select an environment to browse its content.</p>;
  }

  if (rootError) {
    return <p className="error">{rootError}</p>;
  }

  const rootLevel = levels[rootPath];

  return (
    <div className="tree">
      {rootNode ? (
        renderNode(rootNode)
      ) : rootLevel?.status === "loading" || !rootLevel ? (
        <div className="tree-loading">Loading content tree…</div>
      ) : (
        <div className="tree-empty">Nothing found at {rootPath}</div>
      )}
    </div>
  );
}
