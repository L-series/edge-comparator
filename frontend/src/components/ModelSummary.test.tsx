import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ModelSummary } from "./ModelSummary";
import type { ModelInfo } from "../types/api";

const mockModel: ModelInfo = {
  sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  format: "onnx",
  ir_version: 8,
  opsets: { "": 17, "ai.onnx.ml": 2 },
  inputs: [
    {
      name: "images",
      dtype: "float32",
      shape: [1, 3, 640, 640],
    },
  ],
  outputs: [
    {
      name: "output0",
      dtype: "float32",
      shape: [1, 84, 8400],
    },
  ],
  operations: [
    { index: 0, name: "Conv_0", domain: "", op_type: "Conv" },
    { index: 1, name: "Relu_1", domain: "", op_type: "Relu" },
  ],
  node_count: 2,
};

describe("ModelSummary", () => {
  it("renders evidence label Static inferred / preflight", () => {
    render(<ModelSummary model={mockModel} evidenceType="static_inferred" stage="preflight" />);

    expect(screen.getByText("Static inferred / preflight")).toBeInTheDocument();
  });

  it("renders SHA256, format, and IR version", () => {
    render(<ModelSummary model={mockModel} evidenceType="static_inferred" stage="preflight" />);

    expect(screen.getByText(mockModel.sha256)).toBeInTheDocument();
    expect(screen.getByText(/ONNX \(IR v8\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Node count: 2/i)).toBeInTheDocument();
  });

  it("renders input and output signatures", () => {
    render(<ModelSummary model={mockModel} evidenceType="static_inferred" stage="preflight" />);

    expect(screen.getByText("images")).toBeInTheDocument();
    expect(screen.getAllByText("float32")).toHaveLength(2);
    expect(screen.getByText("[1, 3, 640, 640]")).toBeInTheDocument();

    expect(screen.getByText("output0")).toBeInTheDocument();
    expect(screen.getByText("[1, 84, 8400]")).toBeInTheDocument();
  });

  it("renders opsets with default domain clarity", () => {
    render(<ModelSummary model={mockModel} evidenceType="static_inferred" stage="preflight" />);

    expect(screen.getByText(/default \(ai\.onnx\): v17/i)).toBeInTheDocument();
    expect(screen.getByText(/ai\.onnx\.ml: v2/i)).toBeInTheDocument();
  });

  it("renders operations inventory", () => {
    render(<ModelSummary model={mockModel} evidenceType="static_inferred" stage="preflight" />);

    expect(screen.getByText("Conv_0")).toBeInTheDocument();
    expect(screen.getByText("Conv")).toBeInTheDocument();
    expect(screen.getByText("Relu_1")).toBeInTheDocument();
    expect(screen.getByText("Relu")).toBeInTheDocument();
  });

  it("handles non-default evidence types and dynamic/null dimensions in shape", () => {
    const dynamicModel: ModelInfo = {
      ...mockModel,
      inputs: [{ name: "dynamic_in", dtype: "float32", shape: [null, 3, 224, 224] }],
    };
    render(<ModelSummary model={dynamicModel} evidenceType="custom" stage="evaluation" />);

    expect(screen.getByText("custom / evaluation")).toBeInTheDocument();
    expect(screen.getByText("[?, 3, 224, 224]")).toBeInTheDocument();
  });
});
