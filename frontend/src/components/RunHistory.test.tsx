import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { RunHistory } from "./RunHistory";
import type { RunSummary } from "../types/api";

const mockRuns: RunSummary[] = [
  {
    id: "a0000000-0000-4000-8000-000000000001",
    created_at: "2026-09-22T14:30:00Z",
    model_sha256: "a".repeat(64),
    status: "compiled_unverified",
    compiler_version: "2026.4.0",
    device_name: "AMD Ryzen 9 7950X3D",
    evaluation_key: "d".repeat(64),
    summary: "Compiled successfully",
  },
  {
    id: "a0000000-0000-4000-8000-000000000002",
    created_at: "2026-09-22T14:35:00Z",
    model_sha256: "b".repeat(64),
    status: "compile_failed",
    compiler_version: "2026.4.0",
    device_name: null,
    evaluation_key: "e".repeat(64),
    summary: "Import failed on unknown operator",
  },
];

describe("RunHistory", () => {
  it("renders loading state when fetching history", () => {
    render(
      <RunHistory
        runs={[]}
        isLoading={true}
        error={null}
        onRetry={vi.fn()}
        onViewRun={vi.fn()}
        onDeleteRun={vi.fn()}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(/Loading persisted runs history/i);
  });

  it("renders error state with retry button when history fetch fails", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();

    render(
      <RunHistory
        runs={[]}
        isLoading={false}
        error="Failed to connect to runs API"
        onRetry={onRetry}
        onViewRun={vi.fn()}
        onDeleteRun={vi.fn()}
      />,
    );

    expect(screen.getByText("Failed to connect to runs API")).toBeInTheDocument();
    const retryBtn = screen.getByRole("button", { name: /Retry/i });
    await user.click(retryBtn);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders empty state when no runs exist", () => {
    render(
      <RunHistory
        runs={[]}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
        onViewRun={vi.fn()}
        onDeleteRun={vi.fn()}
      />,
    );

    expect(screen.getByText(/No persisted compiler runs found/i)).toBeInTheDocument();
  });

  it("renders list of persisted runs with metadata", () => {
    render(
      <RunHistory
        runs={mockRuns}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
        onViewRun={vi.fn()}
        onDeleteRun={vi.fn()}
      />,
    );

    expect(screen.getByText("Compiled — unverified")).toBeInTheDocument();
    expect(screen.getByText("Compile failed")).toBeInTheDocument();
    expect(screen.getByText("Compiled successfully")).toBeInTheDocument();
    expect(screen.getByText("Import failed on unknown operator")).toBeInTheDocument();
    expect(screen.getByText("AMD Ryzen 9 7950X3D")).toBeInTheDocument();
  });

  it("invokes onViewRun when View Evidence button is clicked", async () => {
    const user = userEvent.setup();
    const onViewRun = vi.fn();

    render(
      <RunHistory
        runs={mockRuns}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
        onViewRun={onViewRun}
        onDeleteRun={vi.fn()}
      />,
    );

    const viewButtons = screen.getAllByRole("button", { name: /View Evidence/i });
    const firstViewBtn = viewButtons[0];
    if (!firstViewBtn) {
      throw new Error("Missing view button");
    }
    await user.click(firstViewBtn);
    expect(onViewRun).toHaveBeenCalledWith("a0000000-0000-4000-8000-000000000001");
  });

  it("prompts window.confirm and calls onDeleteRun when confirmed", async () => {
    const user = userEvent.setup();
    const onDeleteRun = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValueOnce(true);

    render(
      <RunHistory
        runs={mockRuns}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
        onViewRun={vi.fn()}
        onDeleteRun={onDeleteRun}
      />,
    );

    const deleteButtons = screen.getAllByRole("button", { name: /Delete/i });
    const firstDeleteBtn = deleteButtons[0];
    if (!firstDeleteBtn) {
      throw new Error("Missing delete button");
    }
    await user.click(firstDeleteBtn);

    expect(confirmSpy).toHaveBeenCalled();
    expect(onDeleteRun).toHaveBeenCalledWith("a0000000-0000-4000-8000-000000000001");
  });

  it("does not call onDeleteRun when window.confirm is cancelled", async () => {
    const user = userEvent.setup();
    const onDeleteRun = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValueOnce(false);

    render(
      <RunHistory
        runs={mockRuns}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
        onViewRun={vi.fn()}
        onDeleteRun={onDeleteRun}
      />,
    );

    const deleteButtons = screen.getAllByRole("button", { name: /Delete/i });
    const firstDeleteBtn = deleteButtons[0];
    if (!firstDeleteBtn) {
      throw new Error("Missing delete button");
    }
    await user.click(firstDeleteBtn);

    expect(confirmSpy).toHaveBeenCalled();
    expect(onDeleteRun).not.toHaveBeenCalled();
  });

  it("renders inconclusive status and disabling during deletion", () => {
    const runsWithInconclusive: RunSummary[] = [
      {
        id: "a0000000-0000-4000-8000-000000000003",
        created_at: "2026-09-22T14:40:00Z",
        model_sha256: "c".repeat(64),
        status: "inconclusive",
        compiler_version: null,
        device_name: null,
        evaluation_key: "f".repeat(64),
        summary: "Execution unverified due to environment",
      },
    ];

    render(
      <RunHistory
        runs={runsWithInconclusive}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
        onViewRun={vi.fn()}
        onDeleteRun={vi.fn()}
        isDeletingId="a0000000-0000-4000-8000-000000000003"
      />,
    );

    expect(screen.getByText("Inconclusive")).toBeInTheDocument();
    expect(screen.getByText("Deleting...")).toBeDisabled();
    expect(screen.getByText("CPU")).toBeInTheDocument();
    expect(screen.getByText("(not reported)")).toBeInTheDocument();
  });
});
