"use client";

import type { EnvironmentOption } from "@/src/lib/types";

interface EnvironmentSelectorProps {
  environments: EnvironmentOption[];
  value: string;
  onChange: (value: string) => void;
  language: string;
  onLanguageChange: (value: string) => void;
  onManageCredentials?: () => void;
  disabled?: boolean;
}

export function EnvironmentSelector({
  environments,
  value,
  onChange,
  language,
  onLanguageChange,
  onManageCredentials,
  disabled,
}: EnvironmentSelectorProps) {
  const selected = environments.find((e) => e.value === value);

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Environment</h2>
        {onManageCredentials && (
          <button
            type="button"
            className="secondary small"
            onClick={onManageCredentials}
          >
            Credentials
          </button>
        )}
      </div>

      <div className="row">
        <label>
          Environment
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled || environments.length === 0}
          >
            {environments.length === 0 && <option value="">None configured</option>}
            {environments.map((env) => (
              <option key={env.value} value={env.value}>
                {env.label}
                {env.source === "runtime" ? " (runtime)" : ""}
              </option>
            ))}
          </select>
        </label>

        <label>
          Language
          <input
            type="text"
            value={language}
            onChange={(e) => onLanguageChange(e.target.value)}
            placeholder="en"
            disabled={disabled}
          />
        </label>
      </div>

      {selected && (
        <p className="hint">
          Capabilities:
          <span className={`badge ${selected.hasApiKey ? "ok" : "warn"}`}>
            {selected.hasApiKey ? "export (Edge)" : "no API key — cannot export"}
          </span>
          <span className={`badge ${selected.hasAuthoring ? "ok" : "warn"}`}>
            {selected.hasAuthoring ? "content tree" : "no tree browsing"}
          </span>
          {!selected.hasAuthoring && (
            <>
              {" "}
              Without an automation client the content tree cannot be browsed —
              type page paths manually below.
            </>
          )}
        </p>
      )}
    </div>
  );
}
