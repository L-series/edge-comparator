import type { JSX } from "react";
import type { Target } from "../types/api";

export interface TargetCatalogProps {
  targets: Target[];
  selectedTargetIds: Set<string>;
  onToggleTarget: (id: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
}

export function TargetCatalog({
  targets,
  selectedTargetIds,
  onToggleTarget,
  onSelectAll,
  onDeselectAll,
  isLoading,
  error,
  onRetry,
}: TargetCatalogProps): JSX.Element {
  if (isLoading) {
    return (
      <section className="catalog-section" aria-labelledby="catalog-heading">
        <h2 id="catalog-heading">Hardware Targets</h2>
        <div role="status" aria-live="polite" className="loading-state">
          Loading target catalog...
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="catalog-section" aria-labelledby="catalog-heading">
        <h2 id="catalog-heading">Hardware Targets</h2>
        <div className="error-banner" role="alert">
          <p>{error}</p>
          <button type="button" onClick={onRetry} className="retry-button">
            Retry
          </button>
        </div>
      </section>
    );
  }

  const allSelected = targets.length > 0 && selectedTargetIds.size === targets.length;
  const noneSelected = selectedTargetIds.size === 0;

  return (
    <section className="catalog-section" aria-labelledby="catalog-heading">
      <div className="section-header">
        <h2 id="catalog-heading">Hardware Targets</h2>
        <div className="catalog-actions">
          <button
            type="button"
            onClick={onSelectAll}
            disabled={allSelected}
            className="action-button"
          >
            Select All
          </button>
          <button
            type="button"
            onClick={onDeselectAll}
            disabled={noneSelected}
            className="action-button"
          >
            Deselect All
          </button>
        </div>
      </div>

      {noneSelected && (
        <div role="alert" className="warning-banner">
          No targets selected for comparison.
        </div>
      )}

      <ul className="target-list" aria-label="Available hardware targets">
        {targets.map((target) => {
          const isChecked = selectedTargetIds.has(target.id);
          const checkboxId = `target-${target.id}`;

          return (
            <li key={target.id} className="target-item">
              <label htmlFor={checkboxId} className="target-label">
                <input
                  id={checkboxId}
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => {
                    onToggleTarget(target.id);
                  }}
                  className="target-checkbox"
                />
                <div className="target-details">
                  <span className="target-name">{target.name}</span>
                  <span className="target-vendor">Vendor: {target.vendor}</span>
                  <span className="target-accelerator">Accelerator: {target.accelerator}</span>
                </div>
              </label>
              <a
                href={target.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="target-source-link"
                aria-label={`${target.name} source documentation`}
              >
                Source docs &rarr;
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
