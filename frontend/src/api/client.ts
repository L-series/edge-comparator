import {
  ApiErrorSchema,
  InspectResponseSchema,
  TargetCatalogSchema,
  type InspectResponse,
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
