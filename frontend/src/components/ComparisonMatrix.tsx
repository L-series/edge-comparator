import type { JSX } from "react";
import type { InspectResult, Target } from "../types/api";

export interface ComparisonMatrixProps {
  targets: Target[];
  selectedTargetIds: Set<string>;
  results: InspectResult[];
  hasInspected: boolean;
}

export function ComparisonMatrix({
  targets,
  selectedTargetIds,
  results,
  hasInspected,
}: ComparisonMatrixProps): JSX.Element {
  if (!hasInspected) {
    return (
      <section className="matrix-section" aria-labelledby="matrix-heading">
        <h2 id="matrix-heading">Comparison Matrix</h2>
        <div className="empty-prompt">
          <p>Upload and inspect an ONNX model to compare target compatibility.</p>
        </div>
      </section>
    );
  }

  if (selectedTargetIds.size === 0) {
    return (
      <section className="matrix-section" aria-labelledby="matrix-heading">
        <h2 id="matrix-heading">Comparison Matrix</h2>
        <div className="empty-prompt" role="status">
          <p>No targets selected to display in matrix.</p>
        </div>
      </section>
    );
  }

  const resultMap = new Map<string, InspectResult>();
  for (const r of results) {
    resultMap.set(r.target_id, r);
  }

  const visibleTargets = targets.filter((target) => selectedTargetIds.has(target.id));

  return (
    <section className="matrix-section" aria-labelledby="matrix-heading">
      <div className="section-header">
        <h2 id="matrix-heading">Comparison Matrix</h2>
        <span className="results-count">
          Showing {visibleTargets.length} of {targets.length} targets
        </span>
      </div>

      <div className="matrix-table-wrapper">
        <table className="matrix-table" aria-label="Compatibility matrix">
          <thead>
            <tr>
              <th scope="col">Target</th>
              <th scope="col">Acceleration Backend</th>
              <th scope="col">Status</th>
              <th scope="col">Compiler / Runtime</th>
              <th scope="col">Reason</th>
            </tr>
          </thead>
          <tbody>
            {visibleTargets.map((target) => {
              const res = resultMap.get(target.id);
              const hasResult = res !== undefined;
              const statusText = hasResult ? "Not tested" : "Inconclusive";
              const statusClass = hasResult
                ? "status-badge status-not-tested"
                : "status-badge status-inconclusive";
              const reason = hasResult
                ? res.reason
                : "Missing evaluation record from inspect response";

              return (
                <tr key={target.id}>
                  <td>
                    <div className="matrix-target-cell">
                      <strong>{target.name}</strong>
                      <span className="cell-subtext">{target.vendor}</span>
                    </div>
                  </td>
                  <td>{target.accelerator}</td>
                  <td>
                    <span className={statusClass}>{statusText}</span>
                  </td>
                  <td>
                    <span className="runtime-badge">Not selected</span>
                  </td>
                  <td className="reason-cell">{reason}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
