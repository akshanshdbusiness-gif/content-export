"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ContentTreeBrowser } from "./ContentTreeBrowser";
import { CredentialsModal, type CredentialSummary } from "./CredentialsModal";
import { EnvironmentSelector } from "./EnvironmentSelector";
import { UsageDisclaimer } from "./UsageDisclaimer";
import {
  type EnvironmentOption,
  type ExportRequest,
  type ExportScope,
  type TreeNode,
} from "@/src/lib/types";

const ROOT_PATH = "/sitecore/content";

/** An API caller — supplied by the page so auth mode stays out of this file. */
export type ApiCall = (path: string, init?: RequestInit) => Promise<Response>;

interface SelectedPage {
  path: string;
  name: string;
  scope: ExportScope;
}

interface ExportPanelProps {
  callApi: ApiCall;
}

async function readError(response: Response): Promise<string> {
  const data = await response.json().catch(() => null);
  return (
    (data as { error?: string } | null)?.error ??
    `Request failed (${response.status})`
  );
}

export function ExportPanel({ callApi }: ExportPanelProps) {
  const [environments, setEnvironments] = useState<EnvironmentOption[]>([]);
  const [environment, setEnvironment] = useState("");
  const [language, setLanguage] = useState("en");
  const [allowRuntimeCredentials, setAllowRuntimeCredentials] = useState(false);
  const [showCredentials, setShowCredentials] = useState(false);
  const [loadingEnvironments, setLoadingEnvironments] = useState(true);

  const [selected, setSelected] = useState<SelectedPage[]>([]);
  const [manualPath, setManualPath] = useState("");

  const [includeComponents, setIncludeComponents] = useState(true);
  const [includeSystemFields, setIncludeSystemFields] = useState(false);
  const [skipSharedPlaceholders, setSkipSharedPlaceholders] = useState(true);
  const [keepHtml, setKeepHtml] = useState(false);

  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const selectedEnv = environments.find((e) => e.value === environment);
  const selectedPaths = useMemo(
    () => new Set(selected.map((s) => s.path)),
    [selected],
  );

  const loadEnvironments = useCallback(async () => {
    setLoadingEnvironments(true);
    try {
      const response = await callApi("/api/environments");
      if (!response.ok) throw new Error(await readError(response));
      const data = (await response.json()) as {
        environments: EnvironmentOption[];
        allowRuntimeCredentials: boolean;
      };
      setEnvironments(data.environments);
      setAllowRuntimeCredentials(data.allowRuntimeCredentials);
      setEnvironment((current) =>
        current && data.environments.some((e) => e.value === current)
          ? current
          : (data.environments[0]?.value ?? ""),
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingEnvironments(false);
    }
  }, [callApi]);

  useEffect(() => {
    void loadEnvironments();
  }, [loadEnvironments]);

  const loadLevel = useCallback(
    async (path: string) => {
      const query = new URLSearchParams({ environment, path, language });
      const response = await callApi(`/api/tree?${query}`);
      if (!response.ok) throw new Error(await readError(response));
      return (await response.json()) as {
        item: TreeNode | null;
        children: TreeNode[];
      };
    },
    [callApi, environment, language],
  );

  const toggleNode = (node: TreeNode, checked: boolean) => {
    setSelected((current) => {
      if (checked) {
        if (current.some((s) => s.path === node.path)) return current;
        return [
          ...current,
          {
            path: node.path,
            name: node.displayName || node.name,
            scope: "SingleItem",
          },
        ];
      }
      return current.filter((s) => s.path !== node.path);
    });
  };

  const addManualPath = () => {
    const path = manualPath.trim();
    if (!path.startsWith("/sitecore/")) {
      setError("Paths must start with /sitecore/");
      return;
    }
    setError(null);
    setManualPath("");
    setSelected((current) =>
      current.some((s) => s.path === path)
        ? current
        : [
            ...current,
            {
              path,
              name: path.split("/").filter(Boolean).pop() ?? path,
              scope: "SingleItem",
            },
          ],
    );
  };

  const setScope = (path: string, scope: ExportScope) =>
    setSelected((current) =>
      current.map((s) => (s.path === path ? { ...s, scope } : s)),
    );

  const runExport = async () => {
    setExporting(true);
    setError(null);
    setResult(null);
    setWarnings([]);

    const request: ExportRequest = {
      environment,
      language,
      items: selected.map((s) => ({ itemPath: s.path, scope: s.scope })),
      includeSystemFields,
      includeComponents,
      skipSharedPlaceholders,
      keepHtml,
    };

    try {
      const response = await callApi("/api/export", {
        method: "POST",
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
          warnings?: string[];
        } | null;
        setWarnings(data?.warnings ?? []);
        throw new Error(data?.error ?? `Export failed (${response.status})`);
      }

      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const filename =
        /filename="([^"]+)"/.exec(disposition)?.[1] ?? "sitecore-export.xml";

      // Trigger the browser download from the in-memory blob.
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      const pages = response.headers.get("x-export-pages") ?? "?";
      const components = response.headers.get("x-export-components") ?? "?";
      const warningCount = Number(
        response.headers.get("x-export-warnings") ?? "0",
      );
      setResult(
        `Downloaded ${filename} — ${pages} page(s), ${components} component(s)` +
          (warningCount > 0 ? `, ${warningCount} warning(s) inside the file` : ""),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  };

  const credentialApi = {
    loadSummary: async (): Promise<CredentialSummary[]> => {
      const response = await callApi("/api/settings/credentials");
      if (!response.ok) throw new Error(await readError(response));
      const data = (await response.json()) as {
        environments: CredentialSummary[];
      };
      return data.environments;
    },
    savePasted: async (json: string): Promise<string[]> => {
      const response = await callApi("/api/settings/credentials", {
        method: "POST",
        body: JSON.stringify({ json }),
      });
      if (!response.ok) throw new Error(await readError(response));
      return ((await response.json()) as { added: string[] }).added;
    },
    saveSingle: async (env: Record<string, string>): Promise<string[]> => {
      const response = await callApi("/api/settings/credentials", {
        method: "POST",
        body: JSON.stringify({ environment: env }),
      });
      if (!response.ok) throw new Error(await readError(response));
      return ((await response.json()) as { added: string[] }).added;
    },
    removeEnvironment: async (name: string): Promise<void> => {
      const response = await callApi(
        `/api/settings/credentials?name=${encodeURIComponent(name)}`,
        { method: "DELETE" },
      );
      if (!response.ok) throw new Error(await readError(response));
    },
  };

  return (
    <>
      <UsageDisclaimer
        isLiveEdgeHost={selectedEnv?.isLiveEdgeHost}
        environmentName={selectedEnv?.label}
      />

      <EnvironmentSelector
        environments={environments}
        value={environment}
        onChange={setEnvironment}
        language={language}
        onLanguageChange={setLanguage}
        onManageCredentials={
          allowRuntimeCredentials ? () => setShowCredentials(true) : undefined
        }
        disabled={exporting}
      />

      {loadingEnvironments && <p className="hint">Loading environments…</p>}

      {!loadingEnvironments && environments.length === 0 && (
        <div className="panel">
          <p className="hint">
            No environments are configured. Set <code>SITECORE_ENVIRONMENTS</code>{" "}
            in <code>.env.local</code>
            {allowRuntimeCredentials
              ? ", or add one now with the Credentials button above."
              : "."}
          </p>
        </div>
      )}

      <div className="panel">
        <h2>Pages to export</h2>

        {selectedEnv?.hasAuthoring ? (
          <ContentTreeBrowser
            rootPath={ROOT_PATH}
            environment={environment}
            language={language}
            selected={selectedPaths}
            onToggle={toggleNode}
            loadLevel={loadLevel}
          />
        ) : (
          environment && (
            <p className="hint">
              Tree browsing needs an automation client on this environment. Add
              page paths manually below.
            </p>
          )
        )}

        <div className="row">
          <label>
            Add a path manually
            <input
              type="text"
              value={manualPath}
              onChange={(e) => setManualPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addManualPath();
                }
              }}
              placeholder="/sitecore/content/org/site/Home/about"
            />
          </label>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button
              type="button"
              className="secondary"
              onClick={addManualPath}
              disabled={!manualPath.trim()}
            >
              Add path
            </button>
          </div>
        </div>

        {selected.length > 0 ? (
          <div className="selection">
            {selected.map((item) => (
              <div className="selection-row" key={item.path}>
                <span className="selection-path">{item.path}</span>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={item.scope === "ItemAndDescendants"}
                    onChange={(e) =>
                      setScope(
                        item.path,
                        e.target.checked ? "ItemAndDescendants" : "SingleItem",
                      )
                    }
                    disabled={!selectedEnv?.hasAuthoring}
                    title={
                      selectedEnv?.hasAuthoring
                        ? undefined
                        : "Expanding descendants needs an automation client"
                    }
                  />
                  Include descendants
                </label>
                <button
                  type="button"
                  className="secondary small"
                  onClick={() =>
                    setSelected((current) =>
                      current.filter((s) => s.path !== item.path),
                    )
                  }
                  aria-label={`Remove ${item.path}`}
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              className="link"
              onClick={() => setSelected([])}
            >
              Clear all
            </button>
          </div>
        ) : (
          <p className="hint">
            Nothing selected yet. Tick pages in the tree, or add a path manually.
          </p>
        )}
      </div>

      <div className="panel">
        <h2>Options</h2>

        <p className="hint">
          Output is XML — hierarchical, keeping nested image, link and list
          values as real elements.
        </p>

        <div className="checkbox-grid">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={includeComponents}
              onChange={(e) => setIncludeComponents(e.target.checked)}
            />
            Include component / datasource fields
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={skipSharedPlaceholders}
              onChange={(e) => setSkipSharedPlaceholders(e.target.checked)}
            />
            Skip shared header / footer placeholders
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={includeSystemFields}
              onChange={(e) => setIncludeSystemFields(e.target.checked)}
            />
            Include system fields (__Created, …)
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={keepHtml}
              onChange={(e) => setKeepHtml(e.target.checked)}
            />
            Preserve HTML in rich text
          </label>
        </div>

        <button
          type="button"
          onClick={() => void runExport()}
          disabled={exporting || selected.length === 0 || !environment}
        >
          {exporting
            ? "Exporting…"
            : `Export ${selected.length || ""} page${selected.length === 1 ? "" : "s"} as XML`}
        </button>

        {error && <p className="error">{error}</p>}
        {result && <p className="success">{result}</p>}
        {warnings.length > 0 && (
          <div className="warnings">
            {warnings.map((warning, i) => (
              <span key={i}>{warning}</span>
            ))}
          </div>
        )}
      </div>

      {showCredentials && (
        <CredentialsModal
          onClose={() => setShowCredentials(false)}
          onSaved={() => void loadEnvironments()}
          {...credentialApi}
        />
      )}
    </>
  );
}
