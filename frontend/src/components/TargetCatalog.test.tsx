import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { TargetCatalog } from "./TargetCatalog";
import type { Target } from "../types/api";

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
  {
    id: "nxp-imx93-ethos-u65",
    name: "NXP i.MX93 Ethos-U65",
    vendor: "NXP",
    accelerator: "Arm Ethos-U65 NPU",
    source_url: "https://example.com/imx93",
    configuration_status: "catalog_only",
  },
];

describe("TargetCatalog", () => {
  it("renders target items with vendor, accelerator, and documentation links", () => {
    render(
      <TargetCatalog
        targets={mockTargets}
        selectedTargetIds={new Set(["nvidia-jetson-orin-nano"])}
        onToggleTarget={vi.fn()}
        onSelectAll={vi.fn()}
        onDeselectAll={vi.fn()}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText("NVIDIA Jetson Orin Nano")).toBeInTheDocument();
    expect(screen.getByText(/Ampere GPU/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /NVIDIA Jetson Orin Nano source/i });
    expect(link).toHaveAttribute("href", "https://example.com/jetson");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("calls onToggleTarget when checkbox is clicked", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();

    render(
      <TargetCatalog
        targets={mockTargets}
        selectedTargetIds={new Set(["nvidia-jetson-orin-nano"])}
        onToggleTarget={onToggle}
        onSelectAll={vi.fn()}
        onDeselectAll={vi.fn()}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
      />,
    );

    const checkbox = screen.getByRole("checkbox", { name: /NVIDIA Jetson Orin Nano/i });
    expect(checkbox).toBeChecked();
    await user.click(checkbox);
    expect(onToggle).toHaveBeenCalledWith("nvidia-jetson-orin-nano");
  });

  it("shows accessible warning alert when no targets are selected", () => {
    render(
      <TargetCatalog
        targets={mockTargets}
        selectedTargetIds={new Set()}
        onToggleTarget={vi.fn()}
        onSelectAll={vi.fn()}
        onDeselectAll={vi.fn()}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("No targets selected for comparison.");
  });

  it("handles loading state", () => {
    render(
      <TargetCatalog
        targets={[]}
        selectedTargetIds={new Set()}
        onToggleTarget={vi.fn()}
        onSelectAll={vi.fn()}
        onDeselectAll={vi.fn()}
        isLoading={true}
        error={null}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText(/Loading target catalog/i)).toBeInTheDocument();
  });

  it("handles error state and triggers retry", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();

    render(
      <TargetCatalog
        targets={[]}
        selectedTargetIds={new Set()}
        onToggleTarget={vi.fn()}
        onSelectAll={vi.fn()}
        onDeselectAll={vi.fn()}
        isLoading={false}
        error="Failed to load target catalog"
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText("Failed to load target catalog")).toBeInTheDocument();
    const retryBtn = screen.getByRole("button", { name: /Retry/i });
    await user.click(retryBtn);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("handles Select All and Deselect All buttons", async () => {
    const user = userEvent.setup();
    const onSelectAll = vi.fn();
    const onDeselectAll = vi.fn();

    render(
      <TargetCatalog
        targets={mockTargets}
        selectedTargetIds={new Set(["nvidia-jetson-orin-nano"])}
        onToggleTarget={vi.fn()}
        onSelectAll={onSelectAll}
        onDeselectAll={onDeselectAll}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /^Select All$/i }));
    expect(onSelectAll).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: /^Deselect All$/i }));
    expect(onDeselectAll).toHaveBeenCalledTimes(1);
  });
});
