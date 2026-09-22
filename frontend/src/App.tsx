import { useEffect, useRef, useState, type JSX } from "react";
import { fetchTargets, inspectModel } from "./api/client";
import { ComparisonMatrix } from "./components/ComparisonMatrix";
import { Header } from "./components/Header";
import { ModelSummary } from "./components/ModelSummary";
import { ModelUploader } from "./components/ModelUploader";
import { TargetCatalog } from "./components/TargetCatalog";
import type { InspectResponse, Target } from "./types/api";
import "./App.css";

export default function App(): JSX.Element {
  const [targets, setTargets] = useState<Target[]>([]);
  const [selectedTargetIds, setSelectedTargetIds] = useState<Set<string>>(new Set());
  const [targetsLoading, setTargetsLoading] = useState<boolean>(true);
  const [targetsError, setTargetsError] = useState<string | null>(null);

  const [inspectResponse, setInspectResponse] = useState<InspectResponse | null>(null);
  const [inspectLoading, setInspectLoading] = useState<boolean>(false);
  const [inspectError, setInspectError] = useState<string | null>(null);

  const currentFileRef = useRef<File | null>(null);
  const activeInspectControllerRef = useRef<AbortController | null>(null);
  const catalogueRetryControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let ignore = false;
    const controller = new AbortController();

    async function initTargets(): Promise<void> {
      try {
        const data = await fetchTargets(controller.signal);
        if (!ignore) {
          setTargets(data);
          setSelectedTargetIds(new Set(data.map((t) => t.id)));
          setTargetsLoading(false);
        }
      } catch (err: unknown) {
        if (!ignore) {
          if (!(err instanceof DOMException && err.name === "AbortError")) {
            const message = err instanceof Error ? err.message : "Failed to load targets catalog";
            setTargetsError(message);
          }
          setTargetsLoading(false);
        }
      }
    }

    void initTargets();

    return () => {
      ignore = true;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    return () => {
      activeInspectControllerRef.current?.abort();
      catalogueRetryControllerRef.current?.abort();
    };
  }, []);

  const handleRetryTargets = async (): Promise<void> => {
    if (catalogueRetryControllerRef.current) {
      catalogueRetryControllerRef.current.abort();
    }
    const controller = new AbortController();
    catalogueRetryControllerRef.current = controller;

    setTargetsLoading(true);
    setTargetsError(null);
    try {
      const data = await fetchTargets(controller.signal);
      setTargets(data);
      setSelectedTargetIds(new Set(data.map((t) => t.id)));
    } catch (err: unknown) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        const message = err instanceof Error ? err.message : "Failed to load targets catalog";
        setTargetsError(message);
      }
    } finally {
      if (catalogueRetryControllerRef.current === controller) {
        setTargetsLoading(false);
      }
    }
  };

  const handleToggleTarget = (id: string): void => {
    setSelectedTargetIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSelectAll = (): void => {
    setSelectedTargetIds(new Set(targets.map((t) => t.id)));
  };

  const handleDeselectAll = (): void => {
    setSelectedTargetIds(new Set());
  };

  const handleFileSelect = (file: File | null): void => {
    currentFileRef.current = file;
    if (activeInspectControllerRef.current) {
      activeInspectControllerRef.current.abort();
      activeInspectControllerRef.current = null;
    }
    setInspectLoading(false);
    setInspectResponse(null);
    setInspectError(null);
  };

  const handleInspect = async (file: File): Promise<void> => {
    if (activeInspectControllerRef.current) {
      activeInspectControllerRef.current.abort();
    }

    const controller = new AbortController();
    activeInspectControllerRef.current = controller;
    currentFileRef.current = file;

    setInspectLoading(true);
    setInspectResponse(null);
    setInspectError(null);

    try {
      const response = await inspectModel(file, controller.signal);
      if (
        !controller.signal.aborted &&
        activeInspectControllerRef.current === controller &&
        currentFileRef.current === file
      ) {
        setInspectResponse(response);
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      if (
        !controller.signal.aborted &&
        activeInspectControllerRef.current === controller &&
        currentFileRef.current === file
      ) {
        const message = err instanceof Error ? err.message : "Model inspection failed";
        setInspectError(message);
      }
    } finally {
      if (activeInspectControllerRef.current === controller) {
        setInspectLoading(false);
      }
    }
  };

  return (
    <div className="app-container">
      <Header />
      <main>
        <TargetCatalog
          targets={targets}
          selectedTargetIds={selectedTargetIds}
          onToggleTarget={handleToggleTarget}
          onSelectAll={handleSelectAll}
          onDeselectAll={handleDeselectAll}
          isLoading={targetsLoading}
          error={targetsError}
          onRetry={() => {
            void handleRetryTargets();
          }}
        />

        <ModelUploader
          onInspect={(file) => {
            void handleInspect(file);
          }}
          onFileSelect={handleFileSelect}
          isLoading={inspectLoading}
          error={inspectError}
        />

        {inspectResponse && (
          <ModelSummary
            model={inspectResponse.model}
            evidenceType={inspectResponse.evidence_type}
            stage={inspectResponse.stage}
          />
        )}

        <ComparisonMatrix
          targets={targets}
          selectedTargetIds={selectedTargetIds}
          results={inspectResponse?.results ?? []}
          hasInspected={inspectResponse !== null}
        />
      </main>
    </div>
  );
}
