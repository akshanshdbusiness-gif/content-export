"use client";

import { useEffect, useState } from "react";

// Runtime credentials. Values entered here are POSTed to the server and kept in
// process memory only — never written to disk, gone on restart.

export interface CredentialSummary {
  name: string;
  host: string;
  hasApiKey: boolean;
  hasAuthoring: boolean;
  isLiveEdgeHost: boolean;
  source: "env" | "runtime";
}

interface CredentialsModalProps {
  onClose: () => void;
  onSaved: () => void;
  loadSummary: () => Promise<CredentialSummary[]>;
  savePasted: (json: string) => Promise<string[]>;
  saveSingle: (environment: Record<string, string>) => Promise<string[]>;
  removeEnvironment: (name: string) => Promise<void>;
}

const EMPTY_SINGLE = {
  name: "",
  host: "",
  apiKey: "",
  clientId: "",
  clientSecret: "",
};

export function CredentialsModal({
  onClose,
  onSaved,
  loadSummary,
  savePasted,
  saveSingle,
  removeEnvironment,
}: CredentialsModalProps) {
  const [tab, setTab] = useState<"paste" | "single">("paste");
  const [json, setJson] = useState("");
  const [single, setSingle] = useState({ ...EMPTY_SINGLE });
  const [summary, setSummary] = useState<CredentialSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      setSummary(await loadSummary());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const added =
        tab === "paste"
          ? await savePasted(json)
          : await saveSingle({ ...single });
      setMessage(`Added: ${added.join(", ")}`);
      if (tab === "paste") setJson("");
      else setSingle({ ...EMPTY_SINGLE });
      await refresh();
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (name: string) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await removeEnvironment(name);
      await refresh();
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const canSubmit =
    tab === "paste"
      ? json.trim().length > 0
      : single.name.trim().length > 0 && single.host.trim().length > 0;

  const field = (
    key: keyof typeof EMPTY_SINGLE,
    label: string,
    placeholder: string,
    type: "text" | "password" = "text",
  ) => (
    <label>
      {label}
      <input
        type={type}
        value={single[key]}
        onChange={(e) => setSingle({ ...single, [key]: e.target.value })}
        placeholder={placeholder}
        autoComplete="off"
      />
    </label>
  );

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label="Credentials">
        <div className="panel-head">
          <h2>Environment credentials</h2>
          <button type="button" className="secondary small" onClick={onClose}>
            Close
          </button>
        </div>

        <p className="hint">
          Added environments live in the server&apos;s memory for this session
          only — they are never written to disk and disappear when the server
          restarts. For anything permanent, set <code>SITECORE_ENVIRONMENTS</code>.
        </p>

        {summary.length > 0 && (
          <div className="env-list">
            {summary.map((env) => (
              <div className="env-list-row" key={env.name}>
                <span className="grow">
                  <strong>{env.name}</strong> — {env.host}
                  <span className={`badge ${env.hasApiKey ? "ok" : "warn"}`}>
                    {env.hasApiKey ? "apiKey" : "no apiKey"}
                  </span>
                  <span className={`badge ${env.hasAuthoring ? "ok" : "warn"}`}>
                    {env.hasAuthoring ? "tree browsing" : "no tree"}
                  </span>
                  {env.isLiveEdgeHost && (
                    <span className="badge warn">live Edge host</span>
                  )}
                  <span className="badge">{env.source}</span>
                </span>
                {env.source === "runtime" && (
                  <button
                    type="button"
                    className="secondary small"
                    onClick={() => void remove(env.name)}
                    disabled={busy}
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="tabs">
          <button
            type="button"
            className={tab === "paste" ? "active" : ""}
            onClick={() => setTab("paste")}
          >
            Paste JSON
          </button>
          <button
            type="button"
            className={tab === "single" ? "active" : ""}
            onClick={() => setTab("single")}
          >
            Add one environment
          </button>
        </div>

        {tab === "paste" ? (
          <label>
            SITECORE_ENVIRONMENTS value
            <textarea
              value={json}
              onChange={(e) => setJson(e.target.value)}
              spellCheck={false}
              placeholder={`[{"name":"Dev","host":"https://xmc-org-project-dev.sitecorecloud.io","apiKey":"...","clientId":"...","clientSecret":"...","contextId":"..."}]`}
            />
          </label>
        ) : (
          <>
            <div className="row">
              {field("name", "Name", "Dev")}
              {field(
                "host",
                "CM host",
                "https://xmc-org-project-dev.sitecorecloud.io",
              )}
            </div>
            {field(
              "apiKey",
              "GraphQL API key — runs the export",
              "from the Edge GraphQL Playground",
              "password",
            )}
            <div className="row">
              {field(
                "clientId",
                "Automation client ID — content tree only",
                "optional",
              )}
              {field(
                "clientSecret",
                "Automation client secret",
                "optional",
                "password",
              )}
            </div>
            <p className="hint">
              The API key is what exports content. The automation client is
              optional and only powers the content tree browser — without it you
              can still export by typing page paths in manually.
            </p>
          </>
        )}

        {error && <p className="error">{error}</p>}
        {message && <p className="success">{message}</p>}

        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || !canSubmit}
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
