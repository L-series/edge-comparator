import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { ModelUploader } from "./ModelUploader";

describe("ModelUploader", () => {
  it("renders accessible file input and disabled inspect button initially", () => {
    render(<ModelUploader onInspect={vi.fn()} isLoading={false} error={null} />);

    expect(screen.getByLabelText("ONNX model")).toBeInTheDocument();
    const btn = screen.getByRole("button", { name: /Inspect model/i });
    expect(btn).toBeDisabled();
  });

  it("validates file extension and rejects non-.onnx files", () => {
    render(<ModelUploader onInspect={vi.fn()} isLoading={false} error={null} />);

    const file = new File(["dummy content"], "model.txt", { type: "text/plain" });
    const input = screen.getByLabelText("ONNX model");

    fireEvent.change(input, { target: { files: [file] } });

    expect(screen.getByText("File must have a .onnx extension.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Inspect model/i })).toBeDisabled();
  });

  it("validates empty file and shows error", async () => {
    const user = userEvent.setup();
    render(<ModelUploader onInspect={vi.fn()} isLoading={false} error={null} />);

    const file = new File([], "empty.onnx");
    const input = screen.getByLabelText("ONNX model");

    await user.upload(input, file);

    expect(screen.getByText("File cannot be empty.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Inspect model/i })).toBeDisabled();
  });

  it("validates file size > 16MiB and shows error", async () => {
    const user = userEvent.setup();
    render(<ModelUploader onInspect={vi.fn()} isLoading={false} error={null} />);

    const largeFile = new File([new Uint8Array(16 * 1024 * 1024 + 1)], "toolarge.onnx");
    const input = screen.getByLabelText("ONNX model");

    await user.upload(input, largeFile);

    expect(screen.getByText("File size exceeds 16 MiB limit.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Inspect model/i })).toBeDisabled();
  });

  it("enables button for valid file and calls onInspect on click", async () => {
    const user = userEvent.setup();
    const onInspect = vi.fn();
    render(<ModelUploader onInspect={onInspect} isLoading={false} error={null} />);

    const file = new File([new Uint8Array([1, 2, 3, 4])], "valid_model.onnx");
    const input = screen.getByLabelText("ONNX model");

    await user.upload(input, file);

    expect(screen.getByText(/valid_model\.onnx/)).toBeInTheDocument();
    const btn = screen.getByRole("button", { name: /Inspect model/i });
    expect(btn).not.toBeDisabled();

    await user.click(btn);
    expect(onInspect).toHaveBeenCalledWith(file);
  });

  it("disables button and displays live status during loading", () => {
    render(<ModelUploader onInspect={vi.fn()} isLoading={true} error={null} />);

    const btn = screen.getByRole("button", { name: /Inspect model/i });
    expect(btn).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(/Inspecting model/i);
  });

  it("displays inspect error if provided", () => {
    render(
      <ModelUploader onInspect={vi.fn()} isLoading={false} error="Unsupported ONNX IR version 9" />,
    );

    expect(screen.getByText("Unsupported ONNX IR version 9")).toBeInTheDocument();
  });

  it("handles cleared file selection and calls onFileSelect with null", () => {
    const onFileSelect = vi.fn();
    render(
      <ModelUploader
        onInspect={vi.fn()}
        onFileSelect={onFileSelect}
        isLoading={false}
        error={null}
      />,
    );

    const input = screen.getByLabelText("ONNX model");
    fireEvent.change(input, { target: { files: [] } });

    expect(onFileSelect).toHaveBeenCalledWith(null);
  });
});
