import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import App from "./App";
import * as client from "./api/client";

const mockTargets = [
  {
    id: "nvidia-jetson-orin-nano",
    name: "NVIDIA Jetson Orin Nano",
    vendor: "NVIDIA",
    accelerator: "Ampere GPU (1024 CUDA cores)",
    source_url: "https://example.com/jetson",
    configuration_status: "catalog_only" as const,
  },
  {
    id: "intel-openvino-cpu",
    name: "Local CPU via OpenVINO",
    vendor: "Local host (OpenVINO by Intel)",
    accelerator: "CPU only; actual processor recorded per run",
    source_url: "https://example.com/openvino",
    configuration_status: "catalog_only" as const,
  },
  {
    id: "nxp-imx93-ethos-u65",
    name: "NXP i.MX93 Ethos-U65",
    vendor: "NXP",
    accelerator: "Arm Ethos-U65 NPU",
    source_url: "https://example.com/imx93",
    configuration_status: "catalog_only" as const,
  },
];

const mockInspectResponse = {
  evidence_type: "static_inferred" as const,
  stage: "preflight" as const,
  model: {
    sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    format: "onnx" as const,
    ir_version: 8,
    opsets: { "": 17 },
    inputs: [{ name: "input", dtype: "float32", shape: [1, 3, 224, 224] }],
    outputs: [{ name: "output", dtype: "float32", shape: [1, 1000] }],
    operations: [{ index: 0, name: "Conv_0", domain: "", op_type: "Conv" }],
    node_count: 1,
  },
  results: [
    {
      target_id: "nvidia-jetson-orin-nano",
      status: "not_tested" as const,
      reason: "Catalog-only target: no hardware run performed",
    },
    {
      target_id: "intel-openvino-cpu",
      status: "not_tested" as const,
      reason: "Catalog-only target: no hardware run performed",
    },
    {
      target_id: "nxp-imx93-ethos-u65",
      status: "not_tested" as const,
      reason: "Catalog-only target: no hardware run performed",
    },
  ],
};

describe("App integration", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(client, "fetchRuns").mockResolvedValue([]);
  });

  it("fetches target catalog on mount and selects all targets initially", async () => {
    vi.spyOn(client, "fetchTargets").mockResolvedValueOnce(mockTargets);

    render(<App />);

    expect(screen.getByText(/Loading target catalog/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("NVIDIA Jetson Orin Nano")).toBeInTheDocument();
      expect(screen.getByText("Local CPU via OpenVINO")).toBeInTheDocument();
      expect(screen.getByText("NXP i.MX93 Ethos-U65")).toBeInTheDocument();
    });

    const jetsonCb = screen.getByRole("checkbox", { name: /NVIDIA Jetson Orin Nano/i });
    const intelCb = screen.getByRole("checkbox", { name: /Local CPU via OpenVINO/i });
    const nxpCb = screen.getByRole("checkbox", { name: /NXP i\.MX93/i });
    expect(jetsonCb).toBeChecked();
    expect(intelCb).toBeChecked();
    expect(nxpCb).toBeChecked();
  });

  it("handles target catalog load error and allows retry", async () => {
    const user = userEvent.setup();
    const fetchTargetsSpy = vi
      .spyOn(client, "fetchTargets")
      .mockRejectedValueOnce(new Error("Network connection failed"))
      .mockResolvedValueOnce(mockTargets);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Network connection failed")).toBeInTheDocument();
    });

    const retryBtn = screen.getByRole("button", { name: /Retry/i });
    await user.click(retryBtn);

    await waitFor(() => {
      expect(screen.getByText("NVIDIA Jetson Orin Nano")).toBeInTheDocument();
    });

    expect(fetchTargetsSpy).toHaveBeenCalledTimes(2);
  });

  it("handles target catalog retry failure", async () => {
    const user = userEvent.setup();
    vi.spyOn(client, "fetchTargets")
      .mockRejectedValueOnce(new Error("Initial load failure"))
      .mockRejectedValueOnce(new Error("Retry load failure"));

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Initial load failure")).toBeInTheDocument();
    });

    const retryBtn = screen.getByRole("button", { name: /Retry/i });
    await user.click(retryBtn);

    await waitFor(() => {
      expect(screen.getByText("Retry load failure")).toBeInTheDocument();
    });
  });

  it("runs full inspect workflow and updates summary and matrix", async () => {
    const user = userEvent.setup();
    vi.spyOn(client, "fetchTargets").mockResolvedValueOnce(mockTargets);
    const inspectSpy = vi.spyOn(client, "inspectModel").mockResolvedValueOnce(mockInspectResponse);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("NVIDIA Jetson Orin Nano")).toBeInTheDocument();
    });

    const file = new File([new Uint8Array([1, 2, 3])], "resnet50.onnx");
    const input = screen.getByLabelText("ONNX model");
    await user.upload(input, file);

    const inspectBtn = screen.getByRole("button", { name: /Inspect model/i });
    expect(inspectBtn).toBeEnabled();

    await user.click(inspectBtn);

    await waitFor(() => {
      expect(screen.getByText("Static inferred / preflight")).toBeInTheDocument();
      expect(
        screen.getByText("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"),
      ).toBeInTheDocument();
      expect(screen.getAllByText("Catalog-only target: no hardware run performed")).toHaveLength(3);
    });

    expect(inspectSpy).toHaveBeenCalledTimes(1);
    expect(inspectSpy).toHaveBeenCalledWith(file, expect.any(AbortSignal));
  });

  it("displays user-visible inspect error when API fails", async () => {
    const user = userEvent.setup();
    vi.spyOn(client, "fetchTargets").mockResolvedValueOnce(mockTargets);
    vi.spyOn(client, "inspectModel").mockRejectedValueOnce(
      new Error("Model format invalid or corrupted"),
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("NVIDIA Jetson Orin Nano")).toBeInTheDocument();
    });

    const file = new File([new Uint8Array([1, 2])], "corrupted.onnx");
    await user.upload(screen.getByLabelText("ONNX model"), file);

    await user.click(screen.getByRole("button", { name: /Inspect model/i }));

    await waitFor(() => {
      expect(screen.getByText("Model format invalid or corrupted")).toBeInTheDocument();
    });
  });

  it("clears inspection response and errors on file change and prevents stale evidence on subsequent failure", async () => {
    const user = userEvent.setup();
    vi.spyOn(client, "fetchTargets").mockResolvedValueOnce(mockTargets);
    vi.spyOn(client, "inspectModel")
      .mockResolvedValueOnce(mockInspectResponse)
      .mockRejectedValueOnce(new Error("Second file inspection failed"));

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("NVIDIA Jetson Orin Nano")).toBeInTheDocument();
    });

    const fileA = new File([new Uint8Array([1, 2, 3])], "fileA.onnx");
    const input = screen.getByLabelText("ONNX model");
    await user.upload(input, fileA);
    await user.click(screen.getByRole("button", { name: /Inspect model/i }));

    await waitFor(() => {
      expect(screen.getByText("Static inferred / preflight")).toBeInTheDocument();
    });

    // Selecting a different file must clear fileA's inspection summary and error immediately
    const fileB = new File([new Uint8Array([4, 5, 6])], "fileB.onnx");
    await user.upload(input, fileB);

    expect(screen.queryByText("Static inferred / preflight")).not.toBeInTheDocument();
    expect(screen.queryByText(mockInspectResponse.model.sha256)).not.toBeInTheDocument();

    // Inspecting fileB fails -> shows fileB's error, never retains fileA's results
    await user.click(screen.getByRole("button", { name: /Inspect model/i }));

    await waitFor(() => {
      expect(screen.getByText("Second file inspection failed")).toBeInTheDocument();
    });
    expect(screen.queryByText("Static inferred / preflight")).not.toBeInTheDocument();
    expect(screen.queryByText(mockInspectResponse.model.sha256)).not.toBeInTheDocument();
  });

  it("aborts in-flight request on new inspect submit without stale overwrite", async () => {
    const user = userEvent.setup();
    vi.spyOn(client, "fetchTargets").mockResolvedValueOnce(mockTargets);

    let abortCount = 0;
    vi.spyOn(client, "inspectModel").mockImplementation((file, signal) => {
      signal?.addEventListener("abort", () => {
        abortCount++;
      });
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
          } else {
            resolve({
              ...mockInspectResponse,
              model: {
                ...mockInspectResponse.model,
                sha256: file.name.includes("second")
                  ? "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
                  : "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              },
            });
          }
        }, 100);
      });
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("NVIDIA Jetson Orin Nano")).toBeInTheDocument();
    });

    const input = screen.getByLabelText("ONNX model");
    const firstFile = new File([new Uint8Array([1])], "first.onnx");
    await user.upload(input, firstFile);

    const inspectBtn = screen.getByRole("button", { name: /Inspect model/i });
    await user.click(inspectBtn);

    // Now upload second file and click inspect again
    const secondFile = new File([new Uint8Array([2])], "second.onnx");
    await user.upload(input, secondFile);
    await user.click(inspectBtn);

    await waitFor(() => {
      expect(
        screen.getByText("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
      ).toBeInTheDocument();
    });

    expect(abortCount).toBe(1);
    expect(
      screen.queryByText("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
    ).not.toBeInTheDocument();
  });

  it("handles toggling individual targets, select all, and deselect all", async () => {
    const user = userEvent.setup();
    vi.spyOn(client, "fetchTargets").mockResolvedValueOnce(mockTargets);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("NVIDIA Jetson Orin Nano")).toBeInTheDocument();
    });

    const jetsonCheckbox = screen.getByRole("checkbox", { name: /NVIDIA Jetson Orin Nano/i });
    expect(jetsonCheckbox).toBeChecked();

    // Toggle off
    await user.click(jetsonCheckbox);
    expect(jetsonCheckbox).not.toBeChecked();

    // Toggle on again
    await user.click(jetsonCheckbox);
    expect(jetsonCheckbox).toBeChecked();

    // Deselect All
    const deselectBtn = screen.getByRole("button", { name: /^Deselect All$/i });
    await user.click(deselectBtn);

    expect(screen.getByText("No targets selected for comparison.")).toBeInTheDocument();
    expect(jetsonCheckbox).not.toBeChecked();

    // Select All
    const selectAllBtn = screen.getByRole("button", { name: /^Select All$/i });
    await user.click(selectAllBtn);

    expect(jetsonCheckbox).toBeChecked();
  });

  it("handles AbortError quietly during loadTargets", async () => {
    vi.spyOn(client, "fetchTargets").mockRejectedValueOnce(
      new DOMException("Aborted", "AbortError"),
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.queryByText(/Loading target catalog/i)).not.toBeInTheDocument();
    });

    // Should not display error banner or retry button
    expect(screen.queryByRole("button", { name: /Retry/i })).not.toBeInTheDocument();
  });

  const mockCompileRun = {
    schema_version: 1 as const,
    id: "a0000000-0000-4000-8000-000000000001",
    created_at: "2026-09-22T12:00:00Z",
    model: mockInspectResponse.model,
    target_id: "intel-openvino-cpu" as const,
    status: "compiled_unverified" as const,
    stage: "compile" as const,
    evidence_type: "compiler_reported" as const,
    summary: "Compiled successfully for CPU execution",
    diagnostics: "Diagnostics output: graph compiled cleanly",
    configuration: {
      adapter: "openvino-cpu" as const,
      adapter_version: "1" as const,
      requested_version: "2026.4.0",
      compiler_version: "2026.4.0",
      compiler_build: "custom-build-1",
      plugin_version: "2026.4.0-plugin",
      device: "CPU" as const,
      reader: "onnx_frontend" as const,
      cpu_affinity: "one_allowed_logical_cpu" as const,
      device_name: "AMD Ryzen 9 7950X3D",
      precision: "f32" as const,
      options: {},
      fallback_policy: "none" as const,
      os: "Linux",
      architecture: "x86_64",
      python_version: "3.12.3",
      adapter_sha256: "b".repeat(64),
      dependency_lock_sha256: "c".repeat(64),
      container_digest: null,
      telemetry: "disabled" as const,
      worker_command: ["/usr/bin/python3", "-m", "edge_comparator.compiler_worker"],
      wall_time_limit_seconds: 60.0,
    },
    evaluation_key: "d".repeat(64),
    placement_scope: "openvino_imported_graph_query" as const,
    query_placements: [{ name: "Conv_0", operation: "Conv", device: "CPU" }],
    artifacts: [
      {
        name: "model.onnx" as const,
        sha256: mockInspectResponse.model.sha256,
        size_bytes: 1024,
        media_type: "application/octet-stream",
      },
    ],
  };

  it("loads a synthetic demo, inspects it, and compiles on local CPU with consent", async () => {
    const user = userEvent.setup();
    vi.spyOn(client, "fetchTargets").mockResolvedValueOnce(mockTargets);

    const demoFile = new File([new Uint8Array([1, 2, 3])], "demo_supported_cnn.onnx");
    vi.spyOn(client, "fetchDemo").mockResolvedValueOnce(demoFile);
    vi.spyOn(client, "inspectModel").mockResolvedValueOnce(mockInspectResponse);
    vi.spyOn(client, "compileModel").mockResolvedValueOnce(mockCompileRun);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("NVIDIA Jetson Orin Nano")).toBeInTheDocument();
    });

    // Click load demo button
    const loadDemoBtn = screen.getByRole("button", { name: /Load supported CNN/i });
    await user.click(loadDemoBtn);

    await waitFor(() => {
      expect(screen.getByText(/demo_supported_cnn\.onnx/)).toBeInTheDocument();
    });

    // Inspect the demo model
    const inspectBtn = screen.getByRole("button", { name: /Inspect model/i });
    await user.click(inspectBtn);

    await waitFor(() => {
      expect(screen.getByText("Static inferred / preflight")).toBeInTheDocument();
    });

    // Attempt compile before consent -> button disabled
    const compileBtn = screen.getByRole("button", { name: /Compile on local CPU/i });
    expect(compileBtn).toBeDisabled();

    // Check consent checkbox
    const consentCb = screen.getByRole("checkbox", { name: /Save model and evidence locally/i });
    await user.click(consentCb);
    expect(compileBtn).toBeEnabled();

    // Compile model
    await user.click(compileBtn);

    await waitFor(() => {
      expect(screen.getAllByText("Compiled — execution unverified").length).toBeGreaterThanOrEqual(
        1,
      );
      expect(screen.getAllByText(/AMD Ryzen 9 7950X3D/).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("Diagnostics output: graph compiled cleanly")).toBeInTheDocument();
    });
  });

  it("supports Compile without prior Inspect: immediately shows ModelSummary, updates matrix with CPU compiled and other 2 targets Not tested, and clears all on file change", async () => {
    const user = userEvent.setup();
    vi.spyOn(client, "fetchTargets").mockResolvedValueOnce(mockTargets);

    const demoFile = new File([new Uint8Array([1, 2, 3])], "demo_supported_cnn.onnx");
    vi.spyOn(client, "fetchDemo").mockResolvedValueOnce(demoFile);
    vi.spyOn(client, "compileModel").mockResolvedValueOnce(mockCompileRun);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("NVIDIA Jetson Orin Nano")).toBeInTheDocument();
    });

    // 1. Load demo directly without clicking Inspect
    const loadDemoBtn = screen.getByRole("button", { name: /Load supported CNN/i });
    await user.click(loadDemoBtn);

    await waitFor(() => {
      expect(screen.getByText(/demo_supported_cnn\.onnx/)).toBeInTheDocument();
    });

    // 2. Consent and Compile directly (no prior Inspect!)
    const consentCb = screen.getByRole("checkbox", { name: /Save model and evidence locally/i });
    await user.click(consentCb);

    const compileBtn = screen.getByRole("button", { name: /Compile on local CPU/i });
    await user.click(compileBtn);

    // 3. Verify ModelSummary appears immediately from compileRecord.model
    await waitFor(() => {
      expect(screen.getByText("Model Inspection Summary")).toBeInTheDocument();
      expect(screen.getByText("Static inferred / preflight")).toBeInTheDocument();
    });

    // 4. Verify matrix is visible: CPU row is compiled, other two targets are Not tested
    const matrix = screen.getByRole("table", { name: /Compatibility matrix/i });
    expect(within(matrix).getByText("Compiled — execution unverified")).toBeInTheDocument();
    expect(
      screen.getAllByText("Not evaluated; compiler demonstration scoped to local CPU"),
    ).toHaveLength(2);

    // 5. Change file selection -> verify all active evidence, summary, and matrix are cleared
    const fileInput = screen.getByLabelText("ONNX model");
    const nextFile = new File([new Uint8Array([9, 9])], "next_model.onnx");
    await user.upload(fileInput, nextFile);

    expect(screen.queryByText("Model Inspection Summary")).not.toBeInTheDocument();
    expect(
      screen.getByText("Upload and inspect an ONNX model to compare target compatibility."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Compiled — execution unverified")).not.toBeInTheDocument();
  });

  it("handles history item viewing and deletion", async () => {
    const user = userEvent.setup();
    vi.spyOn(client, "fetchTargets").mockResolvedValueOnce(mockTargets);
    const mockSummary = {
      id: "a0000000-0000-4000-8000-000000000001",
      created_at: "2026-09-22T14:30:00Z",
      model_sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      status: "compiled_unverified" as const,
      compiler_version: "2026.4.0",
      device_name: "Intel CPU",
      evaluation_key: "d".repeat(64),
      summary: "Historical run summary",
    };

    vi.spyOn(client, "fetchRuns").mockResolvedValueOnce([mockSummary]).mockResolvedValueOnce([]);
    vi.spyOn(client, "fetchRun").mockResolvedValueOnce(mockCompileRun);
    const deleteSpy = vi.spyOn(client, "deleteRun").mockResolvedValueOnce();
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Historical run summary")).toBeInTheDocument();
    });

    // Click View Evidence
    const viewBtn = screen.getByRole("button", { name: /View Evidence/i });
    await user.click(viewBtn);

    await waitFor(() => {
      expect(screen.getByText(/Saved Historical Run/i)).toBeInTheDocument();
      expect(
        screen.getByText(
          /This record reflects stored evidence and is not linked to the currently active model/i,
        ),
      ).toBeInTheDocument();
    });

    // Close historical view
    const closeBtn = screen.getByRole("button", { name: /Close Historical View/i });
    await user.click(closeBtn);
    expect(screen.queryByText(/Saved Historical Run/i)).not.toBeInTheDocument();

    // Delete run
    const deleteBtn = screen.getByRole("button", { name: /Delete/i });
    await user.click(deleteBtn);

    expect(deleteSpy).toHaveBeenCalledWith("a0000000-0000-4000-8000-000000000001");
  });

  it("handles demo loading failure and displays error", async () => {
    const user = userEvent.setup();
    vi.spyOn(client, "fetchTargets").mockResolvedValueOnce(mockTargets);
    vi.spyOn(client, "fetchDemo").mockRejectedValueOnce(new Error("Demo download network error"));

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("NVIDIA Jetson Orin Nano")).toBeInTheDocument();
    });

    const loadDemoBtn = screen.getByRole("button", { name: /Load supported CNN/i });
    await user.click(loadDemoBtn);

    await waitFor(() => {
      expect(screen.getByText("Demo download network error")).toBeInTheDocument();
    });
  });

  it("handles compile failure and displays error", async () => {
    const user = userEvent.setup();
    vi.spyOn(client, "fetchTargets").mockResolvedValueOnce(mockTargets);
    vi.spyOn(client, "compileModel").mockRejectedValueOnce(
      new Error("Storage limit reached (507)"),
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("NVIDIA Jetson Orin Nano")).toBeInTheDocument();
    });

    const input = screen.getByLabelText("ONNX model");
    const testFile = new File([new Uint8Array([1, 2, 3])], "test.onnx");
    await user.upload(input, testFile);

    const consentCb = screen.getByRole("checkbox", { name: /Save model and evidence locally/i });
    await user.click(consentCb);

    const compileBtn = screen.getByRole("button", { name: /Compile on local CPU/i });
    await user.click(compileBtn);

    await waitFor(() => {
      expect(screen.getByText("Storage limit reached (507)")).toBeInTheDocument();
    });
  });

  it("handles error when viewing a historical run", async () => {
    const user = userEvent.setup();
    vi.spyOn(client, "fetchTargets").mockResolvedValueOnce(mockTargets);
    const mockSummary = {
      id: "a0000000-0000-4000-8000-000000000001",
      created_at: "2026-09-22T14:30:00Z",
      model_sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      status: "compiled_unverified" as const,
      compiler_version: "2026.4.0",
      device_name: "Intel CPU",
      evaluation_key: "d".repeat(64),
      summary: "Historical run summary",
    };

    vi.spyOn(client, "fetchRuns").mockResolvedValueOnce([mockSummary]);
    vi.spyOn(client, "fetchRun").mockRejectedValueOnce(new Error("Run details not found"));

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Historical run summary")).toBeInTheDocument();
    });

    const viewBtn = screen.getByRole("button", { name: /View Evidence/i });
    await user.click(viewBtn);

    await waitFor(() => {
      expect(screen.getByText("Run details not found")).toBeInTheDocument();
    });
  });

  it("handles error when deleting a run", async () => {
    const user = userEvent.setup();
    vi.spyOn(client, "fetchTargets").mockResolvedValueOnce(mockTargets);
    const mockSummary = {
      id: "a0000000-0000-4000-8000-000000000001",
      created_at: "2026-09-22T14:30:00Z",
      model_sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      status: "compiled_unverified" as const,
      compiler_version: "2026.4.0",
      device_name: "Intel CPU",
      evaluation_key: "d".repeat(64),
      summary: "Historical run summary",
    };

    vi.spyOn(client, "fetchRuns").mockResolvedValueOnce([mockSummary]);
    vi.spyOn(window, "confirm").mockReturnValueOnce(true);
    vi.spyOn(client, "deleteRun").mockRejectedValueOnce(new Error("Cannot delete run"));

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Historical run summary")).toBeInTheDocument();
    });

    const deleteBtn = screen.getByRole("button", { name: /Delete/i });
    await user.click(deleteBtn);

    await waitFor(() => {
      expect(screen.getByText("Cannot delete run")).toBeInTheDocument();
    });
  });

  it("aborts in-flight compile on unmount", async () => {
    const user = userEvent.setup();
    vi.spyOn(client, "fetchTargets").mockResolvedValueOnce(mockTargets);

    let compileAborted = false;
    vi.spyOn(client, "compileModel").mockImplementation((_file, signal) => {
      signal?.addEventListener("abort", () => {
        compileAborted = true;
      });
      return new Promise((resolve) => {
        const timer = setTimeout(resolve, 10000);
        signal?.addEventListener("abort", () => {
          clearTimeout(timer);
        });
      });
    });

    const { unmount } = render(<App />);

    await waitFor(() => {
      expect(screen.getByText("NVIDIA Jetson Orin Nano")).toBeInTheDocument();
    });

    const input = screen.getByLabelText("ONNX model");
    const file1 = new File([new Uint8Array([1])], "model1.onnx");
    await user.upload(input, file1);

    const consentCb = screen.getByRole("checkbox", { name: /Save model and evidence locally/i });
    await user.click(consentCb);

    const compileBtn = screen.getByRole("button", { name: /Compile on local CPU/i });
    await user.click(compileBtn);

    expect(compileAborted).toBe(false);
    unmount();
    expect(compileAborted).toBe(true);
  });

  it("clears viewed historical run when that same run is deleted", async () => {
    const user = userEvent.setup();
    vi.spyOn(client, "fetchTargets").mockResolvedValueOnce(mockTargets);
    const mockSummary = {
      id: "a0000000-0000-4000-8000-000000000001",
      created_at: "2026-09-22T14:30:00Z",
      model_sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      status: "compiled_unverified" as const,
      compiler_version: "2026.4.0",
      device_name: "Intel CPU",
      evaluation_key: "d".repeat(64),
      summary: "Historical run summary",
    };

    vi.spyOn(client, "fetchRuns").mockResolvedValueOnce([mockSummary]).mockResolvedValueOnce([]);
    vi.spyOn(client, "fetchRun").mockResolvedValueOnce(mockCompileRun);
    vi.spyOn(client, "deleteRun").mockResolvedValueOnce();
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Historical run summary")).toBeInTheDocument();
    });

    // View it
    const viewBtn = screen.getByRole("button", { name: /View Evidence/i });
    await user.click(viewBtn);

    await waitFor(() => {
      expect(screen.getByText(/Saved Historical Run/i)).toBeInTheDocument();
    });

    // Delete it while open
    const deleteBtn = screen.getByRole("button", { name: /Delete/i });
    await user.click(deleteBtn);

    await waitFor(() => {
      expect(screen.queryByText(/Saved Historical Run/i)).not.toBeInTheDocument();
    });
  });

  it("clears compileRecord if current compiled run is deleted from history", async () => {
    const user = userEvent.setup();
    vi.spyOn(client, "fetchTargets").mockResolvedValueOnce(mockTargets);
    const mockSummary = {
      id: "a0000000-0000-4000-8000-000000000001",
      created_at: "2026-09-22T14:30:00Z",
      model_sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      status: "compiled_unverified" as const,
      compiler_version: "2026.4.0",
      device_name: "AMD Ryzen 9 7950X3D",
      evaluation_key: "d".repeat(64),
      summary: "Historical run summary",
    };

    vi.spyOn(client, "fetchRuns")
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([mockSummary])
      .mockResolvedValueOnce([]);
    vi.spyOn(client, "compileModel").mockResolvedValueOnce(mockCompileRun);
    vi.spyOn(client, "deleteRun").mockResolvedValueOnce();
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("NVIDIA Jetson Orin Nano")).toBeInTheDocument();
    });

    const input = screen.getByLabelText("ONNX model");
    const testFile = new File([new Uint8Array([1, 2, 3])], "test.onnx");
    await user.upload(input, testFile);

    const consentCb = screen.getByRole("checkbox", { name: /Save model and evidence locally/i });
    await user.click(consentCb);

    const compileBtn = screen.getByRole("button", { name: /Compile on local CPU/i });
    await user.click(compileBtn);

    await waitFor(() => {
      expect(screen.getByRole("link", { name: /Download Full JSON Report/i })).toBeInTheDocument();
    });

    // Delete that run from history
    const deleteBtn = screen.getByRole("button", { name: /Delete/i });
    await user.click(deleteBtn);

    // Active compileRecord should be cleared, leaving no ghost download links
    await waitFor(() => {
      expect(
        screen.queryByRole("link", { name: /Download Full JSON Report/i }),
      ).not.toBeInTheDocument();
    });
  });

  it("discards stale historical fetch if user views another run before the first resolves", async () => {
    const user = userEvent.setup();
    vi.spyOn(client, "fetchTargets").mockResolvedValueOnce(mockTargets);

    const summaryA = {
      id: "a0000000-0000-4000-8000-000000000001",
      created_at: "2026-09-22T14:30:00Z",
      model_sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      status: "compiled_unverified" as const,
      compiler_version: "2026.4.0",
      device_name: "AMD Ryzen 9 7950X3D",
      evaluation_key: "d".repeat(64),
      summary: "Run A Summary",
    };
    const summaryB = {
      id: "a0000000-0000-4000-8000-000000000002",
      created_at: "2026-09-22T14:35:00Z",
      model_sha256: "1123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      status: "compiled_unverified" as const,
      compiler_version: "2026.4.0",
      device_name: "AMD Ryzen 9 7950X3D",
      evaluation_key: "e".repeat(64),
      summary: "Run B Summary",
    };

    vi.spyOn(client, "fetchRuns").mockResolvedValueOnce([summaryA, summaryB]);

    let resolveRunA: ((run: typeof mockCompileRun) => void) | undefined;
    let resolveRunB: ((run: typeof mockCompileRun) => void) | undefined;

    vi.spyOn(client, "fetchRun").mockImplementation((id) => {
      if (id.endsWith("0001")) {
        return new Promise((resolve) => {
          resolveRunA = resolve;
        });
      }
      return new Promise((resolve) => {
        resolveRunB = resolve;
      });
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Run A Summary")).toBeInTheDocument();
      expect(screen.getByText("Run B Summary")).toBeInTheDocument();
    });

    const viewButtons = screen.getAllByRole("button", { name: /View Evidence/i });
    const viewBtnA = viewButtons[0];
    const viewBtnB = viewButtons[1];
    if (!viewBtnA || !viewBtnB) {
      throw new Error("Missing view buttons");
    }

    // Click View A then View B
    await user.click(viewBtnA);
    await user.click(viewBtnB);

    // Resolve B first
    const runB = {
      ...mockCompileRun,
      id: "a0000000-0000-4000-8000-000000000002",
      summary: "Run B Summary Detail",
    };
    resolveRunB?.(runB);

    await waitFor(() => {
      expect(screen.getByText("Run B Summary Detail")).toBeInTheDocument();
    });

    // Now resolve A late
    const runA = {
      ...mockCompileRun,
      id: "a0000000-0000-4000-8000-000000000001",
      summary: "Run A Summary Detail",
    };
    resolveRunA?.(runA);

    // Ensure A did not overwrite B
    expect(screen.getByText("Run B Summary Detail")).toBeInTheDocument();
    expect(screen.queryByText("Run A Summary Detail")).not.toBeInTheDocument();
  });

  it("handles non-Error exceptions gracefully in demo load, compile, and run actions", async () => {
    const user = userEvent.setup();
    vi.spyOn(client, "fetchTargets").mockResolvedValueOnce(mockTargets);

    // Non-Error in demo
    vi.spyOn(client, "fetchDemo").mockRejectedValueOnce("Plain string error");
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("NVIDIA Jetson Orin Nano")).toBeInTheDocument();
    });

    const loadDemoBtn = screen.getByRole("button", { name: /Load supported CNN/i });
    await user.click(loadDemoBtn);

    await waitFor(() => {
      expect(screen.getByText("Failed to load demonstration model")).toBeInTheDocument();
    });

    // Non-Error in compile
    const input = screen.getByLabelText("ONNX model");
    const testFile = new File([new Uint8Array([1, 2, 3])], "test.onnx");
    await user.upload(input, testFile);

    const consentCb = screen.getByRole("checkbox", { name: /Save model and evidence locally/i });
    await user.click(consentCb);

    vi.spyOn(client, "compileModel").mockRejectedValueOnce("Plain string error");
    const compileBtn = screen.getByRole("button", { name: /Compile on local CPU/i });
    await user.click(compileBtn);

    await waitFor(() => {
      expect(screen.getByText("Compilation failed")).toBeInTheDocument();
    });
  });

  it("handles AbortError cleanly during compile", async () => {
    const user = userEvent.setup();
    vi.spyOn(client, "fetchTargets").mockResolvedValueOnce(mockTargets);
    vi.spyOn(client, "compileModel").mockRejectedValueOnce(
      new DOMException("Aborted", "AbortError"),
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("NVIDIA Jetson Orin Nano")).toBeInTheDocument();
    });

    const input = screen.getByLabelText("ONNX model");
    const testFile = new File([new Uint8Array([1, 2, 3])], "test.onnx");
    await user.upload(input, testFile);

    const consentCb = screen.getByRole("checkbox", { name: /Save model and evidence locally/i });
    await user.click(consentCb);

    const compileBtn = screen.getByRole("button", { name: /Compile on local CPU/i });
    await user.click(compileBtn);

    // Should finish without showing error
    await waitFor(() => {
      expect(compileBtn).toBeEnabled();
    });
    expect(screen.queryByText("Compilation failed")).not.toBeInTheDocument();
  });
});
