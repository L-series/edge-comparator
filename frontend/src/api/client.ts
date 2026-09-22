import { z } from "zod";
import {
  ApiErrorSchema,
  CompilationRunSchema,
  InspectResponseSchema,
  RunSummarySchema,
  TargetCatalogSchema,
  type CompilationRun,
  type DemoId,
  type InspectResponse,
  type RunSummary,
  type TargetCatalog,
} from "../types/api";

const MAX_FILE_SIZE_BYTES = 16 * 1024 * 1024; // 16 MiB

export function validateOnnxFile(file: File): string | null {
  if (!file.name.toLowerCase().endsWith(".onnx")) {
    return "File must have a .onnx extension.";
  }
  if (file.size === 0) {
    return "File cannot be empty.";
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return "File size exceeds 16 MiB limit.";
  }
  return null;
}

async function handleApiError(response: Response): Promise<never> {
  const statusInfo = response.statusText ? `: ${response.statusText}` : "";
  let message = `HTTP ${String(response.status)}${statusInfo}`;

  try {
    const errorJson: unknown = await response.json();
    const parsed = ApiErrorSchema.safeParse(errorJson);
    if (parsed.success) {
      message = parsed.data.detail;
    }
  } catch (err: unknown) {
    if (err instanceof SyntaxError) {
      throw new Error(`HTTP ${String(response.status)}${statusInfo} (non-JSON response)`, {
        cause: err,
      });
    }
    throw err;
  }
  throw new Error(message);
}

export async function fetchTargets(signal?: AbortSignal): Promise<TargetCatalog> {
  const response = await fetch("/api/targets", { signal });
  if (!response.ok) {
    await handleApiError(response);
  }
  const data: unknown = await response.json();
  const parsed = TargetCatalogSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(`Invalid target catalog schema: ${parsed.error.message}`);
  }
  return parsed.data;
}

export async function inspectModel(file: File, signal?: AbortSignal): Promise<InspectResponse> {
  const validationError = validateOnnxFile(file);
  if (validationError) {
    throw new Error(validationError);
  }

  const response = await fetch("/api/inspect", {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
    },
    body: file,
    signal,
  });

  if (!response.ok) {
    await handleApiError(response);
  }

  const data: unknown = await response.json();
  const parsed = InspectResponseSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(`Invalid inspect response schema: ${parsed.error.message}`);
  }
  return parsed.data;
}

export async function fetchDemo(demoId: DemoId, signal?: AbortSignal): Promise<File> {
  const response = await fetch(`/api/demos/${demoId}`, { signal });
  if (!response.ok) {
    await handleApiError(response);
  }
  const blob = await response.blob();
  const filename =
    demoId === "supported-cnn" ? "demo_supported_cnn.onnx" : "demo_unsupported_op.onnx";
  return new File([blob], filename, { type: "application/octet-stream" });
}

export async function compileModel(file: File, signal?: AbortSignal): Promise<CompilationRun> {
  const validationError = validateOnnxFile(file);
  if (validationError) {
    throw new Error(validationError);
  }

  const response = await fetch("/api/compile", {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Retain-Evidence": "true",
    },
    body: file,
    signal,
  });

  if (!response.ok) {
    await handleApiError(response);
  }

  const data: unknown = await response.json();
  const parsed = CompilationRunSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(`Invalid compile response schema: ${parsed.error.message}`);
  }
  return parsed.data;
}

export async function fetchRuns(signal?: AbortSignal): Promise<RunSummary[]> {
  const response = await fetch("/api/runs", { signal });
  if (!response.ok) {
    await handleApiError(response);
  }
  const data: unknown = await response.json();
  const parsed = z.array(RunSummarySchema).safeParse(data);
  if (!parsed.success) {
    throw new Error(`Invalid runs list schema: ${parsed.error.message}`);
  }
  return parsed.data;
}

export async function fetchRun(id: string, signal?: AbortSignal): Promise<CompilationRun> {
  const response = await fetch(`/api/runs/${encodeURIComponent(id)}`, { signal });
  if (!response.ok) {
    await handleApiError(response);
  }
  const data: unknown = await response.json();
  const parsed = CompilationRunSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(`Invalid run response schema: ${parsed.error.message}`);
  }
  return parsed.data;
}

export async function deleteRun(id: string, signal?: AbortSignal): Promise<void> {
  const response = await fetch(`/api/runs/${encodeURIComponent(id)}`, {
    method: "DELETE",
    signal,
  });
  if (!response.ok) {
    await handleApiError(response);
  }
}
