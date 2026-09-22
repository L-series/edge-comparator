import { useState, type ChangeEvent, type JSX, type SyntheticEvent } from "react";
import { validateOnnxFile } from "../api/client";
import type { DemoId } from "../types/api";

export interface ModelUploaderProps {
  selectedFile?: File | null;
  onInspect: (file: File) => void;
  onCompile?: (file: File) => void;
  onFileSelect?: (file: File | null) => void;
  onLoadDemo?: (demoId: DemoId) => void;
  isOpenVinoSelected?: boolean;
  isLoading?: boolean;
  isInspectLoading?: boolean;
  isCompileLoading?: boolean;
  isDemoLoading?: boolean;
  error?: string | null;
  inspectError?: string | null;
  compileError?: string | null;
}

export function ModelUploader({
  selectedFile,
  onInspect,
  onCompile,
  onFileSelect,
  onLoadDemo,
  isOpenVinoSelected = true,
  isLoading = false,
  isInspectLoading = false,
  isCompileLoading = false,
  isDemoLoading = false,
  error = null,
  inspectError = null,
  compileError = null,
}: ModelUploaderProps): JSX.Element {
  const [internalFile, setInternalFile] = useState<File | null>(null);
  const [consentChecked, setConsentChecked] = useState<boolean>(false);

  const activeFile = selectedFile !== undefined ? selectedFile : internalFile;
  const validationError = activeFile ? validateOnnxFile(activeFile) : null;

  const isBusy = isLoading || isInspectLoading || isCompileLoading || isDemoLoading;
  const isInspectDisabled =
    !activeFile ||
    validationError !== null ||
    isInspectLoading ||
    isCompileLoading ||
    isDemoLoading ||
    isLoading;
  const isCompileDisabled =
    !activeFile || validationError !== null || !consentChecked || !isOpenVinoSelected || isBusy;

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0] ?? null;
    setConsentChecked(false);
    setInternalFile(file);
    onFileSelect?.(file);
  };

  const handleDemoClick = (demoId: DemoId): void => {
    setConsentChecked(false);
    onLoadDemo?.(demoId);
  };

  const handleInspectSubmit = (e: SyntheticEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (activeFile && !validationError && !isCompileLoading && !isDemoLoading) {
      onInspect(activeFile);
    }
  };

  const handleCompileClick = (): void => {
    if (activeFile && !validationError && consentChecked && isOpenVinoSelected && !isBusy) {
      onCompile?.(activeFile);
    }
  };

  const activeInspectError = inspectError ?? error;

  return (
    <section className="uploader-section" aria-labelledby="uploader-heading">
      <h2 id="uploader-heading">Model Intake</h2>

      <div className="demo-chooser">
        <p className="demo-heading">
          <strong>Synthetic demonstration models (generated, no external weights):</strong>
        </p>
        <div className="demo-buttons">
          <div className="demo-item">
            <button
              type="button"
              className="demo-button"
              disabled={isBusy}
              onClick={() => {
                handleDemoClick("supported-cnn");
              }}
            >
              Load supported CNN
            </button>
            <span className="demo-description">
              Synthetic convolutional model supported by OpenVINO CPU
            </span>
          </div>
          <div className="demo-item">
            <button
              type="button"
              className="demo-button"
              disabled={isBusy}
              onClick={() => {
                handleDemoClick("unsupported-op");
              }}
            >
              Load unsupported operator
            </button>
            <span className="demo-description">
              Synthetic graph with unsupported operators to demonstrate error reporting
            </span>
          </div>
        </div>
      </div>

      <form onSubmit={handleInspectSubmit} className="uploader-form">
        <div className="file-input-group">
          <label htmlFor="model-file-input" className="file-input-label">
            ONNX model
          </label>
          <input
            id="model-file-input"
            type="file"
            accept=".onnx"
            onChange={handleFileChange}
            disabled={isCompileLoading || isDemoLoading}
            className="file-input"
          />
        </div>

        {activeFile && !validationError && (
          <div className="file-selected-info">
            <span className="file-name">{activeFile.name}</span>
            <span className="file-size">({(activeFile.size / (1024 * 1024)).toFixed(2)} MiB)</span>
          </div>
        )}

        {validationError && (
          <div role="alert" className="validation-error">
            {validationError}
          </div>
        )}

        <div className="consent-container">
          <label className="consent-label" htmlFor="consent-checkbox">
            <input
              id="consent-checkbox"
              type="checkbox"
              checked={consentChecked}
              onChange={(e) => {
                setConsentChecked(e.target.checked);
              }}
              disabled={isBusy || !activeFile || validationError !== null}
            />
            <span>Save model and evidence locally</span>
          </label>
          <p className="consent-hint">
            Retains model bytes, worker stdout/stderr, diagnostics, and environment lock in local
            storage (~/.local/share/edge-comparator/evidence). Storage limited to 20 runs / 512 MiB
            total. Evidence can be deleted at any time.
          </p>
          <p className="consent-note">
            Note: Aborting or navigating away discards the client result, but server execution may
            continue.
          </p>
        </div>

        {activeInspectError && (
          <div role="alert" className="error-banner">
            {activeInspectError}
          </div>
        )}

        {compileError && (
          <div role="alert" className="error-banner">
            {compileError}
          </div>
        )}

        <div className="uploader-actions">
          <button
            type="submit"
            disabled={isInspectDisabled}
            className="inspect-button"
            aria-label="Inspect model"
          >
            {isInspectLoading || (isLoading && !isCompileLoading)
              ? "Inspecting..."
              : "Inspect model"}
          </button>

          <button
            type="button"
            disabled={isCompileDisabled}
            onClick={handleCompileClick}
            className="compile-button"
            aria-label="Compile on local CPU"
          >
            {isCompileLoading ? "Compiling..." : "Compile on local CPU"}
          </button>
        </div>

        <div role="status" aria-live="polite" className="sr-status">
          {isCompileLoading
            ? "Compiling model on local CPU via OpenVINO..."
            : isInspectLoading || isLoading
              ? "Inspecting model..."
              : isDemoLoading
                ? "Loading demo model..."
                : null}
        </div>
      </form>
    </section>
  );
}
