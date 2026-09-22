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

  it("renders synthetic demo options and calls onLoadDemo", async () => {
    const user = userEvent.setup();
    const onLoadDemo = vi.fn();

    render(
      <ModelUploader onInspect={vi.fn()} onLoadDemo={onLoadDemo} isLoading={false} error={null} />,
    );

    expect(screen.getByRole("button", { name: /Load supported CNN/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Load unsupported operator/i })).toBeInTheDocument();
    expect(
      screen.getByText(/Synthetic convolutional model supported by OpenVINO CPU/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Load supported CNN/i }));
    expect(onLoadDemo).toHaveBeenCalledWith("supported-cnn");
  });

  it("gates Compile on local CPU button by valid file, consent, OpenVINO selection, and busy state", async () => {
    const user = userEvent.setup();
    const onCompile = vi.fn();
    const validFile = new File([new Uint8Array([1, 2, 3])], "test.onnx");

    const { rerender } = render(
      <ModelUploader
        selectedFile={validFile}
        onInspect={vi.fn()}
        onCompile={onCompile}
        isOpenVinoSelected={true}
        isLoading={false}
        error={null}
      />,
    );

    const compileBtn = screen.getByRole("button", { name: /Compile on local CPU/i });
    expect(compileBtn).toBeDisabled();

    // Check the consent checkbox
    const consentCheckbox = screen.getByRole("checkbox", {
      name: /Save model and evidence locally/i,
    });
    expect(consentCheckbox).not.toBeChecked();
    expect(screen.getByText(/20 runs \/ 512 MiB total/i)).toBeInTheDocument();

    await user.click(consentCheckbox);
    expect(consentCheckbox).toBeChecked();
    expect(compileBtn).toBeEnabled();

    // When OpenVINO is deselected, compile button becomes disabled
    rerender(
      <ModelUploader
        selectedFile={validFile}
        onInspect={vi.fn()}
        onCompile={onCompile}
        isOpenVinoSelected={false}
        isLoading={false}
        error={null}
      />,
    );
    expect(compileBtn).toBeDisabled();

    // Re-enable OpenVINO and click compile
    rerender(
      <ModelUploader
        selectedFile={validFile}
        onInspect={vi.fn()}
        onCompile={onCompile}
        isOpenVinoSelected={true}
        isLoading={false}
        error={null}
      />,
    );
    expect(compileBtn).toBeEnabled();
    await user.click(compileBtn);
    expect(onCompile).toHaveBeenCalledWith(validFile);
  });

  it("calls onFileSelect with null when file selection is cleared", () => {
    const onFileSelect = vi.fn();
    render(
      <ModelUploader onInspect={vi.fn()} onFileSelect={onFileSelect} isOpenVinoSelected={true} />,
    );

    const input = screen.getByLabelText("ONNX model");
    // Trigger change with empty files list
    fireEvent.change(input, { target: { files: [] } });

    expect(onFileSelect).toHaveBeenCalledWith(null);
  });

  it("resets consent checkbox when a new file or demo is selected", async () => {
    const user = userEvent.setup();
    const file1 = new File([new Uint8Array([1, 2])], "model1.onnx");
    const file2 = new File([new Uint8Array([3, 4])], "model2.onnx");

    render(
      <ModelUploader
        onInspect={vi.fn()}
        isOpenVinoSelected={true}
        isLoading={false}
        error={null}
      />,
    );

    const input = screen.getByLabelText("ONNX model");
    await user.upload(input, file1);

    const consentCheckbox = screen.getByRole("checkbox", {
      name: /Save model and evidence locally/i,
    });
    await user.click(consentCheckbox);
    expect(consentCheckbox).toBeChecked();

    // Upload another file -> consent should reset
    await user.upload(input, file2);
    expect(consentCheckbox).not.toBeChecked();
  });

  it("displays compile loading state and compile error banner", () => {
    const validFile = new File([new Uint8Array([1, 2])], "model.onnx");
    render(
      <ModelUploader
        selectedFile={validFile}
        onInspect={vi.fn()}
        isCompileLoading={true}
        compileError="Compiler error: Graph verification failed"
      />,
    );

    expect(screen.getByText("Compiler error: Graph verification failed")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      /Compiling model on local CPU via OpenVINO/i,
    );
  });
});
