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
            Local research prototype only. No actual hardware acceleration is evaluated in this
            preflight stage. Private intellectual property / models are inspected locally or via
            configured boundary; not for public SaaS or unverified execution.
          </p>
        </div>
      </div>
    </header>
  );
}
