import { useId, type JSX } from "react";
import type { CompilationRun } from "../types/api";

export interface CompilationEvidenceProps {
  run: CompilationRun;
  isHistorical?: boolean;
}

export function CompilationEvidence({
  run,
  isHistorical = false,
}: CompilationEvidenceProps): JSX.Element {
  const headingId = useId();
  const statusLabels: Record<CompilationRun["status"], { text: string; className: string }> = {
    compiled_unverified: {
      text: "Compiled — execution unverified",
      className: "status-badge status-compiled",
    },
    compile_failed: {
      text: "Compile failed",
      className: "status-badge status-compile-failed",
    },
    inconclusive: {
      text: "Inconclusive",
      className: "status-badge status-inconclusive",
    },
  };

  const statusInfo = statusLabels[run.status];
  const config = run.configuration;
  const containerDigestText = config.container_digest ?? "Not recorded";

  return (
    <section className="compilation-evidence-section" aria-labelledby={headingId}>
      <div className="evidence-header">
        <h3 id={headingId}>
          {isHistorical ? `Historical Compilation Evidence (${run.id})` : "Compilation Evidence"}
        </h3>
        <span className={statusInfo.className}>{statusInfo.text}</span>
      </div>

      <div className="evidence-notice" role="note">
        <p>
          <strong>Notice:</strong> Successful compilation alone does not verify numerical
          correctness, execution, or acceleration.
        </p>
      </div>

      <p className="evidence-summary">{run.summary}</p>

      <div className="evidence-details-grid">
        <div className="details-card">
          <h4>Provenance & Identification</h4>
          <dl className="details-dl">
            <div className="details-row">
              <dt>Run ID</dt>
              <dd>
                <code>{run.id}</code>
              </dd>
            </div>
            <div className="details-row">
              <dt>Created (UTC)</dt>
              <dd>{run.created_at}</dd>
            </div>
            <div className="details-row">
              <dt>Evidence Type</dt>
              <dd>
                <code>{run.evidence_type}</code>
              </dd>
            </div>
            <div className="details-row">
              <dt>Stage</dt>
              <dd>
                <code>{run.stage}</code>
              </dd>
            </div>
            <div className="details-row">
              <dt>Model SHA-256</dt>
              <dd>
                <code className="hash-code">{run.model.sha256}</code>
              </dd>
            </div>
            <div className="details-row">
              <dt>Evaluation Key</dt>
              <dd>
                <code className="hash-code">{run.evaluation_key}</code>
              </dd>
            </div>
          </dl>
        </div>

        <div className="details-card">
          <h4>Compiler & Device Configuration</h4>
          <dl className="details-dl">
            <div className="details-row">
              <dt>Target Device (Requested)</dt>
              <dd>{config.device}</dd>
            </div>
            <div className="details-row">
              <dt>Actual Device / CPU</dt>
              <dd>{config.device_name ?? "Not reported"}</dd>
            </div>
            <div className="details-row">
              <dt>Requested SDK Version</dt>
              <dd>{config.requested_version}</dd>
            </div>
            <div className="details-row">
              <dt>Observed Compiler Version</dt>
              <dd>{config.compiler_version ?? "Not reported"}</dd>
            </div>
            <div className="details-row">
              <dt>Compiler Build</dt>
              <dd>{config.compiler_build ?? "Not reported"}</dd>
            </div>
            <div className="details-row">
              <dt>Plugin Version</dt>
              <dd>{config.plugin_version ?? "Not reported"}</dd>
            </div>
            <div className="details-row">
              <dt>Reader & Frontend</dt>
              <dd>{config.reader}</dd>
            </div>
            <div className="details-row">
              <dt>CPU Affinity</dt>
              <dd>{config.cpu_affinity}</dd>
            </div>
            <div className="details-row">
              <dt>Precision & Policy</dt>
              <dd>
                Precision: {config.precision}, Fallback: {config.fallback_policy}
              </dd>
            </div>
            <div className="details-row">
              <dt>Host Environment</dt>
              <dd>
                OS: {config.os} ({config.architecture}), Python: {config.python_version}
              </dd>
            </div>
            <div className="details-row">
              <dt>Adapter Hash</dt>
              <dd>
                <code className="hash-code">{config.adapter_sha256}</code>
              </dd>
            </div>
            <div className="details-row">
              <dt>Dependency Lock Hash</dt>
              <dd>
                <code className="hash-code">{config.dependency_lock_sha256}</code>
              </dd>
            </div>
            <div className="details-row">
              <dt>Container Digest</dt>
              <dd>{containerDigestText}</dd>
            </div>
            <div className="details-row">
              <dt>Telemetry</dt>
              <dd>{config.telemetry}</dd>
            </div>
            <div className="details-row">
              <dt>Worker Command</dt>
              <dd>
                {config.worker_command && config.worker_command.length > 0 ? (
                  <code>{JSON.stringify(config.worker_command)}</code>
                ) : (
                  "Not recorded"
                )}
              </dd>
            </div>
            <div className="details-row">
              <dt>Wall Time Limit</dt>
              <dd>
                {config.wall_time_limit_seconds !== null &&
                config.wall_time_limit_seconds !== undefined
                  ? `${String(config.wall_time_limit_seconds)}s`
                  : "Not recorded"}
              </dd>
            </div>
            <div className="details-row">
              <dt>Requested Compiler Options (not verified per-kernel precision)</dt>
              <dd>
                <pre className="options-pre">{JSON.stringify(config.options, null, 2)}</pre>
              </dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="placements-section">
        <h4>Imported OpenVINO Graph Query Placements</h4>
        <p className="placements-disclaimer">
          Imported OpenVINO graph query placements (query support map; not runtime placement and not
          1:1 original ONNX mapping).
        </p>

        {run.query_placements.length > 0 ? (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Node Name</th>
                  <th scope="col">Operation</th>
                  <th scope="col">Assigned Device</th>
                </tr>
              </thead>
              <tbody>
                {run.query_placements.map((placement) => (
                  <tr key={`${placement.name}-${placement.operation}`}>
                    <td>
                      <code>{placement.name}</code>
                    </td>
                    <td>{placement.operation}</td>
                    <td>{placement.device ?? "(unassigned)"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty-placements">No query placements recorded.</p>
        )}
      </div>

      <div className="diagnostics-section">
        <details className="diagnostics-details">
          <summary>Raw Diagnostics ({run.diagnostics ? "available" : "none"})</summary>
          <pre className="diagnostics-pre">
            {run.diagnostics || "(No diagnostic output recorded)"}
          </pre>
        </details>
      </div>

      <div className="artifacts-section">
        <h4>Evidence Artifacts & Report</h4>
        <div className="artifacts-links">
          <a
            href={`/api/runs/${run.id}`}
            download={`run-${run.id}.json`}
            className="artifact-download-link report-link"
          >
            Download Full JSON Report
          </a>

          {run.artifacts.map((artifact) => (
            <a
              key={artifact.name}
              href={`/api/runs/${run.id}/artifacts/${encodeURIComponent(artifact.name)}`}
              download={artifact.name}
              className="artifact-download-link"
            >
              {artifact.name} ({String(artifact.size_bytes)} bytes)
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
