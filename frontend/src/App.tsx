import { useEffect, useRef, useState, type JSX } from "react";
import {
  compileModel,
  deleteRun,
  fetchDemo,
  fetchRun,
  fetchRuns,
  fetchTargets,
  inspectModel,
} from "./api/client";
import { ComparisonMatrix } from "./components/ComparisonMatrix";
import { CompilationEvidence } from "./components/CompilationEvidence";
import { Header } from "./components/Header";
import { ModelSummary } from "./components/ModelSummary";
import { ModelUploader } from "./components/ModelUploader";
import { RunHistory } from "./components/RunHistory";
import { TargetCatalog } from "./components/TargetCatalog";
import type { CompilationRun, DemoId, InspectResponse, RunSummary, Target } from "./types/api";
import "./App.css";

export default function App(): JSX.Element {
  const [targets, setTargets] = useState<Target[]>([]);
  const [selectedTargetIds, setSelectedTargetIds] = useState<Set<string>>(new Set());
  const [targetsLoading, setTargetsLoading] = useState<boolean>(true);
  const [targetsError, setTargetsError] = useState<string | null>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const [inspectResponse, setInspectResponse] = useState<InspectResponse | null>(null);
  const [inspectLoading, setInspectLoading] = useState<boolean>(false);
  const [inspectError, setInspectError] = useState<string | null>(null);

  const [compileRecord, setCompileRecord] = useState<CompilationRun | null>(null);
  const [compileLoading, setCompileLoading] = useState<boolean>(false);
  const [compileError, setCompileError] = useState<string | null>(null);

  const [demoLoading, setDemoLoading] = useState<boolean>(false);

  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [runsLoading, setRunsLoading] = useState<boolean>(true);
  const [runsError, setRunsError] = useState<string | null>(null);

  const [viewedHistoricalRun, setViewedHistoricalRun] = useState<CompilationRun | null>(null);
  const [isDeletingRunId, setIsDeletingRunId] = useState<string | null>(null);

  const currentFileRef = useRef<File | null>(null);
  const activeInspectControllerRef = useRef<AbortController | null>(null);
  const activeCompileControllerRef = useRef<AbortController | null>(null);
  const activeDemoControllerRef = useRef<AbortController | null>(null);
  const catalogueRetryControllerRef = useRef<AbortController | null>(null);
  const activeHistoricalRunControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let ignore = false;
    const targetController = new AbortController();
    const runsController = new AbortController();

    async function initTargets(): Promise<void> {
      try {
        const data = await fetchTargets(targetController.signal);
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

    async function initRuns(): Promise<void> {
      try {
        const data = await fetchRuns(runsController.signal);
        if (!ignore) {
          setRuns(data);
          setRunsLoading(false);
        }
      } catch (err: unknown) {
        if (!ignore) {
          if (!(err instanceof DOMException && err.name === "AbortError")) {
            const message = err instanceof Error ? err.message : "Failed to load runs history";
            setRunsError(message);
          }
          setRunsLoading(false);
        }
      }
    }

    void initTargets();
    void initRuns();

    return () => {
      ignore = true;
      targetController.abort();
      runsController.abort();
    };
  }, []);

  useEffect(() => {
    return () => {
      activeInspectControllerRef.current?.abort();
      activeCompileControllerRef.current?.abort();
      activeDemoControllerRef.current?.abort();
      catalogueRetryControllerRef.current?.abort();
      activeHistoricalRunControllerRef.current?.abort();
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

  const refreshRuns = async (): Promise<void> => {
    setRunsLoading(true);
    setRunsError(null);
    try {
      const data = await fetchRuns();
      setRuns(data);
    } catch (err: unknown) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setRunsError(err instanceof Error ? err.message : "Failed to refresh runs history");
      }
    } finally {
      setRunsLoading(false);
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
    setSelectedFile(file);
    currentFileRef.current = file;
    if (activeInspectControllerRef.current) {
      activeInspectControllerRef.current.abort();
      activeInspectControllerRef.current = null;
    }
    if (activeCompileControllerRef.current) {
      activeCompileControllerRef.current.abort();
      activeCompileControllerRef.current = null;
    }
    setInspectLoading(false);
    setInspectResponse(null);
    setInspectError(null);
    setCompileLoading(false);
    setCompileRecord(null);
    setCompileError(null);
  };

  const handleLoadDemo = async (demoId: DemoId): Promise<void> => {
    if (activeDemoControllerRef.current) {
      activeDemoControllerRef.current.abort();
    }
    const controller = new AbortController();
    activeDemoControllerRef.current = controller;

    setDemoLoading(true);
    setInspectError(null);
    setCompileError(null);

    try {
      const file = await fetchDemo(demoId, controller.signal);
      if (!controller.signal.aborted) {
        handleFileSelect(file);
      }
    } catch (err: unknown) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setInspectError(err instanceof Error ? err.message : "Failed to load demonstration model");
      }
    } finally {
      if (activeDemoControllerRef.current === controller) {
        setDemoLoading(false);
      }
    }
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

  const handleCompile = async (file: File): Promise<void> => {
    if (activeCompileControllerRef.current) {
      activeCompileControllerRef.current.abort();
    }

    const controller = new AbortController();
    activeCompileControllerRef.current = controller;
    currentFileRef.current = file;

    setCompileLoading(true);
    setCompileError(null);

    try {
      const run = await compileModel(file, controller.signal);
      if (
        !controller.signal.aborted &&
        activeCompileControllerRef.current === controller &&
        currentFileRef.current === file
      ) {
        setCompileRecord(run);
        void refreshRuns();
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      if (
        !controller.signal.aborted &&
        activeCompileControllerRef.current === controller &&
        currentFileRef.current === file
      ) {
        const message = err instanceof Error ? err.message : "Compilation failed";
        setCompileError(message);
      }
    } finally {
      if (activeCompileControllerRef.current === controller) {
        setCompileLoading(false);
      }
    }
  };

  const handleViewRun = async (id: string): Promise<void> => {
    if (activeHistoricalRunControllerRef.current) {
      activeHistoricalRunControllerRef.current.abort();
    }
    const controller = new AbortController();
    activeHistoricalRunControllerRef.current = controller;

    try {
      const run = await fetchRun(id, controller.signal);
      if (!controller.signal.aborted && activeHistoricalRunControllerRef.current === controller) {
        setViewedHistoricalRun(run);
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      if (!controller.signal.aborted && activeHistoricalRunControllerRef.current === controller) {
        setRunsError(err instanceof Error ? err.message : "Failed to load run details");
      }
    } finally {
      if (activeHistoricalRunControllerRef.current === controller) {
        activeHistoricalRunControllerRef.current = null;
      }
    }
  };

  const handleDeleteRun = async (id: string): Promise<void> => {
    setIsDeletingRunId(id);
    try {
      await deleteRun(id);
      if (viewedHistoricalRun?.id === id) {
        setViewedHistoricalRun(null);
      }
      if (compileRecord?.id === id) {
        setCompileRecord(null);
      }
      await refreshRuns();
    } catch (err: unknown) {
      setRunsError(err instanceof Error ? err.message : "Failed to delete run");
    } finally {
      setIsDeletingRunId(null);
    }
  };

  const displayedModelInfo = inspectResponse
    ? {
        model: inspectResponse.model,
        evidenceType: inspectResponse.evidence_type,
        stage: inspectResponse.stage,
      }
    : compileRecord
      ? {
          model: compileRecord.model,
          evidenceType: "static_inferred" as const,
          stage: "preflight" as const,
        }
      : null;

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
          selectedFile={selectedFile}
          onInspect={(file) => {
            void handleInspect(file);
          }}
          onCompile={(file) => {
            void handleCompile(file);
          }}
          onFileSelect={handleFileSelect}
          onLoadDemo={(demoId) => {
            void handleLoadDemo(demoId);
          }}
          isOpenVinoSelected={selectedTargetIds.has("intel-openvino-cpu")}
          isInspectLoading={inspectLoading}
          isCompileLoading={compileLoading}
          isDemoLoading={demoLoading}
          inspectError={inspectError}
          compileError={compileError}
        />

        {displayedModelInfo && (
          <ModelSummary
            model={displayedModelInfo.model}
            evidenceType={displayedModelInfo.evidenceType}
            stage={displayedModelInfo.stage}
          />
        )}

        <ComparisonMatrix
          targets={targets}
          selectedTargetIds={selectedTargetIds}
          results={inspectResponse?.results ?? []}
          hasInspected={inspectResponse !== null || compileRecord !== null}
          compileRecord={compileRecord}
          currentModelSha={inspectResponse?.model.sha256 ?? compileRecord?.model.sha256 ?? null}
        />

        {compileRecord && <CompilationEvidence run={compileRecord} />}

        {viewedHistoricalRun && (
          <div className="historical-run-panel" role="region" aria-label="Saved Run Detail">
            <div className="historical-panel-header">
              <h3>Saved Historical Run</h3>
              <button
                type="button"
                className="close-button"
                onClick={() => {
                  setViewedHistoricalRun(null);
                }}
                aria-label="Close Historical View"
              >
                Close Historical View
              </button>
            </div>
            <div className="historical-notice" role="note">
              <p>
                <strong>Viewing persisted historical evidence:</strong> This record reflects stored
                evidence and is not linked to the currently active model intake or comparison
                matrix.
              </p>
            </div>
            <CompilationEvidence run={viewedHistoricalRun} isHistorical={true} />
          </div>
        )}

        <RunHistory
          runs={runs}
          isLoading={runsLoading}
          error={runsError}
          onRetry={() => {
            void refreshRuns();
          }}
          onViewRun={(id) => {
            void handleViewRun(id);
          }}
          onDeleteRun={(id) => {
            void handleDeleteRun(id);
          }}
          isDeletingId={isDeletingRunId}
        />
      </main>
    </div>
  );
}
