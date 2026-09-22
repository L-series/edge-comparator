import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ComparisonMatrix } from "./ComparisonMatrix";
import type { Target, InspectResult, CompilationRun } from "../types/api";

const mockTargets: Target[] = [
  {
    id: "nvidia-jetson-orin-nano",
    name: "NVIDIA Jetson Orin Nano",
    vendor: "NVIDIA",
    accelerator: "Ampere GPU (1024 CUDA cores)",
    source_url: "https://example.com/jetson",
    configuration_status: "catalog_only",
  },
  {
    id: "intel-openvino-cpu",
    name: "Local CPU via OpenVINO",
    vendor: "Local host (OpenVINO by Intel)",
    accelerator: "CPU only; actual processor recorded per run",
    source_url: "https://example.com/openvino",
    configuration_status: "catalog_only",
  },
];

const mockResults: InspectResult[] = [
  {
    target_id: "nvidia-jetson-orin-nano",
    status: "not_tested",
    reason: "Static preflight only; no acceleration compiled or measured",
  },
  {
    target_id: "intel-openvino-cpu",
    status: "not_tested",
    reason: "Static preflight only; no runtime execution",
  },
];

describe("ComparisonMatrix", () => {
  it("displays prompt when inspection has not occurred yet", () => {
    render(
      <ComparisonMatrix
        targets={mockTargets}
        selectedTargetIds={new Set(["nvidia-jetson-orin-nano"])}
        results={[]}
        hasInspected={false}
      />,
    );

    expect(
      screen.getByText("Upload and inspect an ONNX model to compare target compatibility."),
    ).toBeInTheDocument();
  });

  it("displays message when no targets are selected", () => {
    render(
      <ComparisonMatrix
        targets={mockTargets}
        selectedTargetIds={new Set()}
        results={mockResults}
        hasInspected={true}
      />,
    );

    expect(screen.getByText("No targets selected to display in matrix.")).toBeInTheDocument();
  });

  it("renders matrix with target name, accelerator, not tested status, and reason", () => {
    render(
      <ComparisonMatrix
        targets={mockTargets}
        selectedTargetIds={new Set(["nvidia-jetson-orin-nano", "intel-openvino-cpu"])}
        results={mockResults}
        hasInspected={true}
      />,
    );

    expect(screen.getByRole("table", { name: "Compatibility matrix" })).toBeInTheDocument();
    expect(screen.getByText("NVIDIA Jetson Orin Nano")).toBeInTheDocument();
    expect(screen.getByText("Ampere GPU (1024 CUDA cores)")).toBeInTheDocument();
    expect(screen.getAllByText("Not tested")).toHaveLength(2);
    expect(screen.getAllByText("Not selected")).toHaveLength(2);
    expect(
      screen.getByText("Static preflight only; no acceleration compiled or measured"),
    ).toBeInTheDocument();
  });

  it("filters out unselected targets from the matrix", () => {
    render(
      <ComparisonMatrix
        targets={mockTargets}
        selectedTargetIds={new Set(["intel-openvino-cpu"])}
        results={mockResults}
        hasInspected={true}
      />,
    );

    expect(screen.queryByText("NVIDIA Jetson Orin Nano")).not.toBeInTheDocument();
    expect(screen.getByText("Local CPU via OpenVINO")).toBeInTheDocument();
  });

  it("displays Inconclusive status and explicit message when a target has no result record", () => {
    render(
      <ComparisonMatrix
        targets={mockTargets}
        selectedTargetIds={new Set(["nvidia-jetson-orin-nano"])}
        results={[]}
        hasInspected={true}
      />,
    );

    expect(screen.getByText("Inconclusive")).toBeInTheDocument();
    expect(screen.getByText("Missing evaluation record from inspect response")).toBeInTheDocument();
    expect(screen.queryByText("Not tested")).not.toBeInTheDocument();
  });

  const mockCompileSuccess: CompilationRun = {
    schema_version: 1,
    id: "a0000000-0000-4000-8000-000000000001",
    created_at: "2026-09-22T12:00:00Z",
    model: {
      sha256: "1".repeat(64),
      format: "onnx",
      ir_version: 8,
      opsets: { "": 17 },
      inputs: [],
      outputs: [],
      operations: [],
      node_count: 0,
    },
    target_id: "intel-openvino-cpu",
    status: "compiled_unverified",
    stage: "compile",
    evidence_type: "compiler_reported",
    summary: "Compiled successfully for CPU execution",
    diagnostics: "",
    configuration: {
      adapter: "openvino-cpu",
      adapter_version: "1",
      requested_version: "2026.4.0",
      compiler_version: "2026.4.0",
      compiler_build: "build-custom",
      plugin_version: "plugin-1",
      device: "CPU",
      reader: "onnx_frontend",
      cpu_affinity: "one_allowed_logical_cpu",
      device_name: "AMD Ryzen 9 7950X3D",
      precision: "f32",
      options: {},
      fallback_policy: "none",
      os: "Linux",
      architecture: "x86_64",
      python_version: "3.12.3",
      adapter_sha256: "b".repeat(64),
      dependency_lock_sha256: "c".repeat(64),
      container_digest: null,
      telemetry: "disabled",
      worker_command: ["/usr/bin/python3", "-m", "edge_comparator.compiler_worker"],
      wall_time_limit_seconds: 60.0,
    },
    evaluation_key: "d".repeat(64),
    placement_scope: "openvino_imported_graph_query",
    query_placements: [],
    artifacts: [],
  };

  it("updates OpenVINO target row when matching compile record is provided", () => {
    render(
      <ComparisonMatrix
        targets={mockTargets}
        selectedTargetIds={new Set(["nvidia-jetson-orin-nano", "intel-openvino-cpu"])}
        results={mockResults}
        hasInspected={true}
        compileRecord={mockCompileSuccess}
        currentModelSha={"1".repeat(64)}
      />,
    );

    expect(screen.getByText("Compiled — execution unverified")).toBeInTheDocument();
    expect(screen.getByText("OpenVINO 2026.4.0 (AMD Ryzen 9 7950X3D)")).toBeInTheDocument();
    // Jetson remains not tested and not selected
    expect(screen.getByText("Not tested")).toBeInTheDocument();
    expect(screen.getByText("Not selected")).toBeInTheDocument();
  });

  it("displays Compile failed when compile record status is compile_failed", () => {
    const mockFailed: CompilationRun = {
      ...mockCompileSuccess,
      status: "compile_failed",
      summary: "Unsupported operator: NonExistentOp",
    };

    render(
      <ComparisonMatrix
        targets={mockTargets}
        selectedTargetIds={new Set(["intel-openvino-cpu"])}
        results={mockResults}
        hasInspected={true}
        compileRecord={mockFailed}
        currentModelSha={"1".repeat(64)}
      />,
    );

    expect(screen.getByText("Compile failed")).toBeInTheDocument();
    expect(screen.getByText("Unsupported operator: NonExistentOp")).toBeInTheDocument();
  });

  it("displays Inconclusive when compile record status is inconclusive and formats runtime without device name", () => {
    const mockInconclusive: CompilationRun = {
      ...mockCompileSuccess,
      status: "inconclusive",
      summary: "Environment failure",
      configuration: {
        ...mockCompileSuccess.configuration,
        device_name: null,
      },
    };

    render(
      <ComparisonMatrix
        targets={mockTargets}
        selectedTargetIds={new Set(["intel-openvino-cpu"])}
        results={mockResults}
        hasInspected={true}
        compileRecord={mockInconclusive}
        currentModelSha={"1".repeat(64)}
      />,
    );

    expect(screen.getByText("Inconclusive")).toBeInTheDocument();
    expect(screen.getByText("OpenVINO 2026.4.0")).toBeInTheDocument();
  });

  it("does not fall back to requested_version when compiler_version is null", () => {
    const mockNoActualVersion: CompilationRun = {
      ...mockCompileSuccess,
      status: "inconclusive",
      summary: "Import failed before compiler initialized",
      configuration: {
        ...mockCompileSuccess.configuration,
        requested_version: "2026.4.0",
        compiler_version: null,
        device_name: null,
      },
    };

    render(
      <ComparisonMatrix
        targets={mockTargets}
        selectedTargetIds={new Set(["intel-openvino-cpu"])}
        results={mockResults}
        hasInspected={true}
        compileRecord={mockNoActualVersion}
        currentModelSha={"1".repeat(64)}
      />,
    );

    expect(screen.getByText("OpenVINO version not reported")).toBeInTheDocument();
    expect(screen.queryByText("OpenVINO 2026.4.0")).not.toBeInTheDocument();
  });

  it("marks non-compiled targets as Not tested with demonstration scope reason when compile alone is performed without inspect results", () => {
    render(
      <ComparisonMatrix
        targets={mockTargets}
        selectedTargetIds={new Set(["nvidia-jetson-orin-nano", "intel-openvino-cpu"])}
        results={[]}
        hasInspected={true}
        compileRecord={mockCompileSuccess}
        currentModelSha={"1".repeat(64)}
      />,
    );

    expect(screen.getByText("Compiled — execution unverified")).toBeInTheDocument();
    expect(screen.getByText("Not tested")).toBeInTheDocument();
    expect(
      screen.getByText("Not evaluated; compiler demonstration scoped to local CPU"),
    ).toBeInTheDocument();
  });

  it("ignores compile record if model SHA does not match current model", () => {
    render(
      <ComparisonMatrix
        targets={mockTargets}
        selectedTargetIds={new Set(["intel-openvino-cpu"])}
        results={mockResults}
        hasInspected={true}
        compileRecord={mockCompileSuccess}
        currentModelSha={"2".repeat(64)} // Different model SHA!
      />,
    );

    expect(screen.queryByText("Compiled — execution unverified")).not.toBeInTheDocument();
    expect(screen.getByText("Not tested")).toBeInTheDocument();
    expect(screen.getByText("Not selected")).toBeInTheDocument();
  });
});
