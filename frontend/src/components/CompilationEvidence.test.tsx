import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { CompilationEvidence } from "./CompilationEvidence";
import type { CompilationRun } from "../types/api";

const mockRunSuccess: CompilationRun = {
  schema_version: 1,
  id: "a0000000-0000-4000-8000-000000000001",
  created_at: "2026-09-22T12:00:00Z",
  model: {
    sha256: "a".repeat(64),
    format: "onnx",
    ir_version: 8,
    opsets: { "": 17 },
    inputs: [{ name: "input0", dtype: "float32", shape: [1, 3, 224, 224] }],
    outputs: [{ name: "output0", dtype: "float32", shape: [1, 1000] }],
    operations: [{ index: 0, name: "conv1", domain: "", op_type: "Conv" }],
    node_count: 1,
  },
  target_id: "intel-openvino-cpu",
  status: "compiled_unverified",
  stage: "compile",
  evidence_type: "compiler_reported",
  summary: "Compiled successfully for CPU execution",
  diagnostics: "OpenVINO CPU graph compilation successful without warnings.",
  configuration: {
    adapter: "openvino-cpu",
    adapter_version: "1",
    requested_version: "2026.4.0",
    compiler_version: "2026.4.0",
    compiler_build: "build-custom-2026",
    plugin_version: "plugin-2026",
    device: "CPU",
    reader: "onnx_frontend",
    cpu_affinity: "one_allowed_logical_cpu",
    device_name: "AMD Ryzen 9 7950X3D",
    precision: "f32",
    options: {
      INFERENCE_PRECISION_HINT: "f32",
      INFERENCE_NUM_THREADS: 1,
      NUM_STREAMS: 1,
      PERFORMANCE_HINT: "LATENCY",
    },
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
  query_placements: [
    { name: "conv1", operation: "Conv", device: "CPU" },
    { name: "relu1", operation: "Relu", device: "CPU" },
  ],
  artifacts: [
    {
      name: "model.onnx",
      sha256: "a".repeat(64),
      size_bytes: 4096,
      media_type: "application/octet-stream",
    },
    {
      name: "worker.stdout.json",
      sha256: "e".repeat(64),
      size_bytes: 512,
      media_type: "application/json",
    },
  ],
};

describe("CompilationEvidence", () => {
  it("renders status, summary, and truthfulness disclaimer", () => {
    render(<CompilationEvidence run={mockRunSuccess} />);

    expect(screen.getByText("Compiled — execution unverified")).toBeInTheDocument();
    expect(screen.getByText("Compiled successfully for CPU execution")).toBeInTheDocument();
    expect(
      screen.getByText(
        /Successful compilation alone does not verify numerical correctness, execution, or acceleration/i,
      ),
    ).toBeInTheDocument();
  });

  it("displays provenance details including hashes, compiler versions, CPU name, and explicit unrecorded container digest", () => {
    render(<CompilationEvidence run={mockRunSuccess} />);

    expect(screen.getByText("a".repeat(64))).toBeInTheDocument();
    expect(screen.getByText("d".repeat(64))).toBeInTheDocument();
    expect(screen.getByText("compiler_reported")).toBeInTheDocument();
    expect(screen.getByText("compile")).toBeInTheDocument();
    expect(screen.getByText(/AMD Ryzen 9 7950X3D/)).toBeInTheDocument();
    expect(screen.getByText("build-custom-2026")).toBeInTheDocument();
    expect(screen.getByText("onnx_frontend")).toBeInTheDocument();
    expect(screen.getByText("one_allowed_logical_cpu")).toBeInTheDocument();
    expect(screen.getByText("b".repeat(64))).toBeInTheDocument();
    expect(screen.getByText("c".repeat(64))).toBeInTheDocument();
    expect(screen.getByText("Not recorded")).toBeInTheDocument();
    expect(
      screen.getByText('["/usr/bin/python3","-m","edge_comparator.compiler_worker"]'),
    ).toBeInTheDocument();
    expect(screen.getByText("60s")).toBeInTheDocument();
    expect(screen.getByText(/INFERENCE_PRECISION_HINT/)).toBeInTheDocument();
  });

  it("displays query placements with disclaimer that it is not runtime placement and not 1:1 ONNX mapping", () => {
    render(<CompilationEvidence run={mockRunSuccess} />);

    expect(
      screen.getByText(/not runtime placement and not 1:1 original ONNX mapping/i),
    ).toBeInTheDocument();
    expect(screen.getByText("conv1")).toBeInTheDocument();
    expect(screen.getByText("relu1")).toBeInTheDocument();
  });

  it("renders diagnostics inside accessible details and pre block", () => {
    render(<CompilationEvidence run={mockRunSuccess} />);

    expect(
      screen.getByText("OpenVINO CPU graph compilation successful without warnings."),
    ).toBeInTheDocument();
  });

  it("renders download links for individual allowlisted artifacts and full JSON report", () => {
    render(<CompilationEvidence run={mockRunSuccess} />);

    const reportLink = screen.getByRole("link", { name: /Download Full JSON Report/i });
    expect(reportLink).toHaveAttribute("href", "/api/runs/a0000000-0000-4000-8000-000000000001");
    expect(reportLink).toHaveAttribute("download", "run-a0000000-0000-4000-8000-000000000001.json");

    const modelArtifactLink = screen.getByRole("link", { name: /model\.onnx \(4096 bytes\)/i });
    expect(modelArtifactLink).toHaveAttribute(
      "href",
      "/api/runs/a0000000-0000-4000-8000-000000000001/artifacts/model.onnx",
    );
  });

  it("handles historical view, failed/inconclusive statuses, and empty placements or diagnostics", () => {
    const minimalRun: CompilationRun = {
      ...mockRunSuccess,
      status: "inconclusive",
      stage: "environment",
      evidence_type: "infrastructure_observed",
      diagnostics: "",
      query_placements: [{ name: "node_unassigned", operation: "Identity", device: null }],
      configuration: {
        ...mockRunSuccess.configuration,
        compiler_version: null,
        compiler_build: null,
        plugin_version: null,
        device_name: null,
        container_digest: "sha256:" + "f".repeat(64),
        worker_command: null,
        wall_time_limit_seconds: null,
      },
    };

    render(<CompilationEvidence run={minimalRun} isHistorical={true} />);

    expect(
      screen.getByRole("heading", { name: /Historical Compilation Evidence/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Inconclusive")).toBeInTheDocument();
    expect(screen.getByText("environment")).toBeInTheDocument();
    expect(screen.getByText("infrastructure_observed")).toBeInTheDocument();
    expect(screen.getByText("(unassigned)")).toBeInTheDocument();
    expect(screen.getByText("(No diagnostic output recorded)")).toBeInTheDocument();
    expect(screen.getAllByText("Not reported")).toHaveLength(4);
    expect(screen.getAllByText("Not recorded")).toHaveLength(2);
    expect(screen.getByText("sha256:" + "f".repeat(64))).toBeInTheDocument();
  });
});
