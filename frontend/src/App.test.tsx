import { render, screen, waitFor } from "@testing-library/react";
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
    name: "Intel Core Ultra (OpenVINO CPU)",
    vendor: "Intel",
    accelerator: "x86_64 CPU (AVX2/VNNI)",
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
  });

  it("fetches target catalog on mount and selects all targets initially", async () => {
    vi.spyOn(client, "fetchTargets").mockResolvedValueOnce(mockTargets);

    render(<App />);

    expect(screen.getByText(/Loading target catalog/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("NVIDIA Jetson Orin Nano")).toBeInTheDocument();
      expect(screen.getByText("Intel Core Ultra (OpenVINO CPU)")).toBeInTheDocument();
      expect(screen.getByText("NXP i.MX93 Ethos-U65")).toBeInTheDocument();
    });

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(3);
    for (const cb of checkboxes) {
      expect(cb).toBeChecked();
    }
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
});
