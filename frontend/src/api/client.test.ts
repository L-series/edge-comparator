import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchTargets, inspectModel, validateOnnxFile } from "./client";

describe("api client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("validateOnnxFile", () => {
    it("returns null for valid onnx file within size limit", () => {
      const file = new File([new Uint8Array([1, 2, 3])], "model.onnx");
      expect(validateOnnxFile(file)).toBeNull();
    });

    it("returns error message when file does not have .onnx extension", () => {
      const file = new File([new Uint8Array([1, 2, 3])], "model.pb");
      expect(validateOnnxFile(file)).toBe("File must have a .onnx extension.");
    });

    it("returns error message when file is empty", () => {
      const file = new File([], "empty.onnx");
      expect(validateOnnxFile(file)).toBe("File cannot be empty.");
    });

    it("returns error message when file exceeds 16 MiB limit", () => {
      const file = new File([new Uint8Array(16 * 1024 * 1024 + 1)], "large.onnx");
      expect(validateOnnxFile(file)).toBe("File size exceeds 16 MiB limit.");
    });
  });

  describe("fetchTargets", () => {
    it("returns parsed targets on valid response", async () => {
      const mockTargets = [
        {
          id: "nvidia-jetson-orin-nano",
          name: "NVIDIA Jetson Orin Nano",
          vendor: "NVIDIA",
          accelerator: "Ampere GPU",
          source_url: "https://example.com/orin",
          configuration_status: "catalog_only",
        },
      ];

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockTargets), { status: 200 }),
      );

      const targets = await fetchTargets();
      expect(targets).toHaveLength(1);
      const firstTarget = targets[0];
      expect(firstTarget?.id).toBe("nvidia-jetson-orin-nano");
    });

    it("throws explicit error when backend returns detail in error response", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: "Database unavailable" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
      );

      await expect(fetchTargets()).rejects.toThrow("Database unavailable");
    });

    it("throws error when targets payload is malformed", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify([{ invalid: "data" }]), { status: 200 }),
      );

      await expect(fetchTargets()).rejects.toThrow(/Invalid target catalog schema/);
    });

    it("surfaces explicit non-JSON HTTP failure message when error response is HTML/text", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response("<html>Bad Gateway</html>", {
          status: 502,
          statusText: "Bad Gateway",
        }),
      );

      await expect(fetchTargets()).rejects.toThrow("HTTP 502: Bad Gateway (non-JSON response)");
    });

    it("propagates network or abort errors without swallowing them", async () => {
      const abortError = new DOMException("The operation was aborted.", "AbortError");
      const mockResponse = {
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: () => Promise.reject(abortError),
      } as unknown as Response;

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockResponse);

      await expect(fetchTargets()).rejects.toThrow(abortError);
    });
  });

  describe("inspectModel", () => {
    const validHex = "a".repeat(64);
    const validInspectResponse = {
      evidence_type: "static_inferred",
      stage: "preflight",
      model: {
        sha256: validHex,
        format: "onnx",
        ir_version: 8,
        opsets: { "": 17 },
        inputs: [{ name: "input0", dtype: "float32", shape: [1, 3, 224, 224] }],
        outputs: [{ name: "output0", dtype: "float32", shape: [1, 1000] }],
        operations: [{ index: 0, name: "conv1", domain: "", op_type: "Conv" }],
        node_count: 1,
      },
      results: [
        {
          target_id: "nvidia-jetson-orin-nano",
          status: "not_tested",
          reason: "Static preflight only",
        },
      ],
    };

    it("sends raw bytes with application/octet-stream content-type", async () => {
      const file = new File([new Uint8Array([1, 2, 3, 4])], "test_model.onnx", {
        type: "application/octet-stream",
      });

      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(new Response(JSON.stringify(validInspectResponse), { status: 200 }));

      const response = await inspectModel(file);

      expect(response.evidence_type).toBe("static_inferred");
      expect(response.stage).toBe("preflight");
      expect(response.model.sha256).toBe(validHex);
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/inspect",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: file,
        }),
      );
    });

    it("rejects non-.onnx files before sending request", async () => {
      const file = new File([new Uint8Array([1, 2, 3])], "model.tflite");
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      await expect(inspectModel(file)).rejects.toThrow("File must have a .onnx extension");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("rejects empty files before sending request", async () => {
      const file = new File([], "empty.onnx");
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      await expect(inspectModel(file)).rejects.toThrow("File cannot be empty");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("rejects files larger than 16 MiB before sending request", async () => {
      const largeFile = new File([new Uint8Array(16 * 1024 * 1024 + 1)], "large.onnx");
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      await expect(inspectModel(largeFile)).rejects.toThrow("File size exceeds 16 MiB limit.");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("throws detail message on HTTP 415/413/422/503 responses", async () => {
      const file = new File([new Uint8Array([1, 2])], "model.onnx");
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: "Unsupported ONNX IR version" }), {
          status: 422,
          headers: { "Content-Type": "application/json" },
        }),
      );

      await expect(inspectModel(file)).rejects.toThrow("Unsupported ONNX IR version");
    });

    it("falls back to status message when error response body is not JSON", async () => {
      const file = new File([new Uint8Array([1, 2])], "model.onnx");
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response("Gateway timeout", {
          status: 504,
          statusText: "Gateway Timeout",
        }),
      );

      await expect(inspectModel(file)).rejects.toThrow("HTTP 504: Gateway Timeout");
    });

    it("throws explicit error when inspect response has invalid shape", async () => {
      const file = new File([new Uint8Array([1, 2])], "model.onnx");
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ malformed: true }), { status: 200 }),
      );

      await expect(inspectModel(file)).rejects.toThrow(/Invalid inspect response schema/);
    });
  });
});
