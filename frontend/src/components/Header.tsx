import type { JSX } from "react";

export function Header(): JSX.Element {
  return (
    <header className="app-header">
      <div className="header-content">
        <h1>Edge AI Comparator</h1>
        <div className="prototype-notice" role="region" aria-label="Research prototype disclaimer">
          <p className="notice-title">
            <strong>Local Research Preview Only</strong>
          </p>
          <p className="notice-body">
            Local research prototype evaluating real CPU compilation via OpenVINO. No actual
            hardware acceleration, model inference, or benchmarking is evaluated. Private
            intellectual property / models are inspected and compiled locally; not for public SaaS
            or unverified execution.
          </p>
        </div>
      </div>
    </header>
  );
}
