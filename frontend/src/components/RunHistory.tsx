import type { JSX } from "react";
import type { RunSummary } from "../types/api";

export interface RunHistoryProps {
  runs: RunSummary[];
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  onViewRun: (id: string) => void;
  onDeleteRun: (id: string) => void;
  isDeletingId?: string | null;
}

export function RunHistory({
  runs,
  isLoading,
  error,
  onRetry,
  onViewRun,
  onDeleteRun,
  isDeletingId = null,
}: RunHistoryProps): JSX.Element {
  const statusLabels: Record<RunSummary["status"], { text: string; className: string }> = {
    compiled_unverified: {
      text: "Compiled — unverified",
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

  const handleDelete = (id: string): void => {
    if (
      window.confirm(
        "Are you sure you want to permanently delete this persisted evidence run and all its artifacts?",
      )
    ) {
      onDeleteRun(id);
    }
  };

  return (
    <section className="history-section" aria-labelledby="history-heading">
      <div className="section-header">
        <h2 id="history-heading">Persisted Runs History (Latest 20)</h2>
        <span className="history-limit-note">Local retention limit: 20 runs / 512 MiB total</span>
      </div>

      {isLoading && (
        <div role="status" aria-live="polite" className="history-loading">
          Loading persisted runs history...
        </div>
      )}

      {error && (
        <div role="alert" className="error-banner">
          <p>{error}</p>
          <button type="button" onClick={onRetry} className="retry-button">
            Retry
          </button>
        </div>
      )}

      {!isLoading && !error && runs.length === 0 && (
        <div className="empty-history">
          <p>
            No persisted compiler runs found. Compile a model with retention consent to record
            evidence.
          </p>
        </div>
      )}

      {!isLoading && !error && runs.length > 0 && (
        <div className="matrix-table-wrapper">
          <table className="matrix-table" aria-label="Persisted compilation runs">
            <thead>
              <tr>
                <th scope="col">Created (UTC)</th>
                <th scope="col">Model SHA-256</th>
                <th scope="col">Status</th>
                <th scope="col">Compiler Version</th>
                <th scope="col">Device</th>
                <th scope="col">Summary</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const statusInfo = statusLabels[run.status];
                const isDeleting = isDeletingId === run.id;

                return (
                  <tr key={run.id}>
                    <td>{run.created_at}</td>
                    <td>
                      <code className="hash-code" title={run.model_sha256}>
                        {run.model_sha256.slice(0, 12)}...
                      </code>
                    </td>
                    <td>
                      <span className={statusInfo.className}>{statusInfo.text}</span>
                    </td>
                    <td>{run.compiler_version ?? "(not reported)"}</td>
                    <td>{run.device_name ?? "CPU"}</td>
                    <td className="reason-cell">{run.summary}</td>
                    <td>
                      <div className="history-actions">
                        <button
                          type="button"
                          className="action-button view-button"
                          onClick={() => {
                            onViewRun(run.id);
                          }}
                          aria-label={`View Evidence for run ${run.id}`}
                        >
                          View Evidence
                        </button>
                        <button
                          type="button"
                          className="action-button delete-button"
                          disabled={isDeleting}
                          onClick={() => {
                            handleDelete(run.id);
                          }}
                          aria-label={`Delete run ${run.id}`}
                        >
                          {isDeleting ? "Deleting..." : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
