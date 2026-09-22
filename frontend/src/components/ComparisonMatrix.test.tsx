import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ComparisonMatrix } from "./ComparisonMatrix";
import type { Target, InspectResult } from "../types/api";

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
    name: "Intel Core Ultra (OpenVINO CPU)",
    vendor: "Intel",
    accelerator: "x86_64 CPU (AVX2/VNNI)",
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
    expect(screen.getByText("Intel Core Ultra (OpenVINO CPU)")).toBeInTheDocument();
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
});
