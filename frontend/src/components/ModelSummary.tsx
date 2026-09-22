import type { JSX } from "react";
import type { ModelInfo } from "../types/api";

export interface ModelSummaryProps {
  model: ModelInfo;
  evidenceType: string;
  stage: string;
}

export function ModelSummary({ model, evidenceType, stage }: ModelSummaryProps): JSX.Element {
  const formatEvidenceBadge = (): string => {
    if (evidenceType === "static_inferred" && stage === "preflight") {
      return "Static inferred / preflight";
    }
    return `${evidenceType} / ${stage}`;
  };

  const formatShape = (shape: (number | string | null)[]): string => {
    return `[${shape.map((dim) => (dim === null ? "?" : String(dim))).join(", ")}]`;
  };

  const formatDomain = (domain: string): string => {
    if (!domain || domain === "") {
      return "default (ai.onnx)";
    }
    return domain;
  };

  return (
    <section className="summary-section" aria-labelledby="summary-heading">
      <div className="section-header">
        <h2 id="summary-heading">Model Inspection Summary</h2>
        <span className="evidence-badge" aria-label="Evidence classification">
          {formatEvidenceBadge()}
        </span>
      </div>

      <div className="summary-card">
        <dl className="metadata-grid">
          <div className="metadata-item">
            <dt>SHA-256 Digest</dt>
            <dd>
              <code className="hash-code">{model.sha256}</code>
            </dd>
          </div>
          <div className="metadata-item">
            <dt>Format & Version</dt>
            <dd>
              ONNX (IR v{model.ir_version}) &bull; Node count: {model.node_count}
            </dd>
          </div>
          <div className="metadata-item">
            <dt>Opset Imports</dt>
            <dd className="opset-list">
              {Object.entries(model.opsets).map(([domain, version]) => (
                <span key={domain || "default"} className="opset-tag">
                  {formatDomain(domain)}: v{version}
                </span>
              ))}
            </dd>
          </div>
        </dl>

        <div className="tensors-container">
          <div className="tensor-table-wrapper">
            <h3>Inputs ({model.inputs.length})</h3>
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Type</th>
                  <th scope="col">Shape</th>
                </tr>
              </thead>
              <tbody>
                {model.inputs.map((input) => (
                  <tr key={input.name}>
                    <td>
                      <code>{input.name}</code>
                    </td>
                    <td>
                      <span className="type-badge">{input.dtype}</span>
                    </td>
                    <td>
                      <code>{formatShape(input.shape)}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="tensor-table-wrapper">
            <h3>Outputs ({model.outputs.length})</h3>
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Type</th>
                  <th scope="col">Shape</th>
                </tr>
              </thead>
              <tbody>
                {model.outputs.map((output) => (
                  <tr key={output.name}>
                    <td>
                      <code>{output.name}</code>
                    </td>
                    <td>
                      <span className="type-badge">{output.dtype}</span>
                    </td>
                    <td>
                      <code>{formatShape(output.shape)}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="operations-wrapper">
          <h3>Operations Inventory ({model.operations.length})</h3>
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Name</th>
                <th scope="col">Domain</th>
                <th scope="col">Operator Type</th>
              </tr>
            </thead>
            <tbody>
              {model.operations.map((op) => (
                <tr key={`${String(op.index)}-${op.name}`}>
                  <td>{op.index}</td>
                  <td>
                    <code>{op.name}</code>
                  </td>
                  <td>{op.domain || "(default)"}</td>
                  <td>
                    <span className="op-badge">{op.op_type}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
