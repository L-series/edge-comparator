import { useState, type ChangeEvent, type JSX, type SyntheticEvent } from "react";
import { validateOnnxFile } from "../api/client";

export interface ModelUploaderProps {
  onInspect: (file: File) => void;
  onFileSelect?: (file: File | null) => void;
  isLoading: boolean;
  error: string | null;
}

export function ModelUploader({
  onInspect,
  onFileSelect,
  isLoading,
  error,
}: ModelUploaderProps): JSX.Element {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (!file) {
      setSelectedFile(null);
      setValidationError(null);
      onFileSelect?.(null);
      return;
    }

    const errorMsg = validateOnnxFile(file);
    if (errorMsg) {
      setSelectedFile(null);
      setValidationError(errorMsg);
      onFileSelect?.(null);
      return;
    }

    setValidationError(null);
    setSelectedFile(file);
    onFileSelect?.(file);
  };

  const handleSubmit = (e: SyntheticEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (selectedFile && !validationError && !isLoading) {
      onInspect(selectedFile);
    }
  };

  const isButtonDisabled = !selectedFile || validationError !== null || isLoading;

  return (
    <section className="uploader-section" aria-labelledby="uploader-heading">
      <h2 id="uploader-heading">Model Intake</h2>
      <form onSubmit={handleSubmit} className="uploader-form">
        <div className="file-input-group">
          <label htmlFor="model-file-input" className="file-input-label">
            ONNX model
          </label>
          <input
            id="model-file-input"
            type="file"
            accept=".onnx"
            onChange={handleFileChange}
            className="file-input"
          />
        </div>

        {selectedFile && !validationError && (
          <div className="file-selected-info">
            <span className="file-name">{selectedFile.name}</span>
            <span className="file-size">
              ({(selectedFile.size / (1024 * 1024)).toFixed(2)} MiB)
            </span>
          </div>
        )}

        {validationError && (
          <div role="alert" className="validation-error">
            {validationError}
          </div>
        )}

        {error && (
          <div role="alert" className="error-banner">
            {error}
          </div>
        )}

        <div className="uploader-actions">
          <button
            type="submit"
            disabled={isButtonDisabled}
            className="inspect-button"
            aria-label="Inspect model"
          >
            {isLoading ? "Inspecting..." : "Inspect model"}
          </button>
        </div>

        <div role="status" aria-live="polite" className="sr-status">
          {isLoading ? "Inspecting model..." : null}
        </div>
      </form>
    </section>
  );
}
