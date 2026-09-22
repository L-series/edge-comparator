import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  compileModel,
  deleteRun,
  fetchDemo,
  fetchRun,
  fetchRuns,
  fetchTargets,
  inspectModel,
  validateOnnxFile,
} from "./client";

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

  describe("fetchDemo", () => {
    it("fetches demo binary and returns a File with synthetic filename", async () => {
      const mockBytes = new Uint8Array([1, 2, 3, 4]);
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(mockBytes, {
          status: 200,
          headers: { "Content-Type": "application/octet-stream" },
        }),
      );

      const file = await fetchDemo("supported-cnn");
      expect(file).toBeInstanceOf(File);
      expect(file.name).toBe("demo_supported_cnn.onnx");
      expect(file.size).toBe(4);
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/demos/supported-cnn", expect.any(Object));
    });

    it("throws error when demo endpoint returns 404/500", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: "Demo not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }),
      );

      await expect(fetchDemo("unsupported-op")).rejects.toThrow("Demo not found");
    });
  });

  describe("compileModel", () => {
    const validHex = "a".repeat(64);
    const mockCompilationRun = {
      schema_version: 1,
      id: "11111111-1111-1111-1111-111111111111",
      created_at: "2026-09-22T12:00:00Z",
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
      target_id: "intel-openvino-cpu",
      status: "compiled_unverified",
      stage: "compile",
      evidence_type: "compiler_reported",
      summary: "Compiled successfully for CPU execution",
      diagnostics: "",
      configuration: {
        adapter: "openvino-cpu",
        adapter_version: "1",
        requested_version: "2026.4.0",
        compiler_version: "2026.4.0",
        compiler_build: "custom-build-1",
        plugin_version: "2026.4.0-plugin",
        device: "CPU",
        reader: "onnx_frontend",
        cpu_affinity: "one_allowed_logical_cpu",
        device_name: "AMD Ryzen 9 7950X3D",
        precision: "f32",
        options: {
          INFERENCE_PRECISION_HINT: "f32",
          INFERENCE_NUM_THREADS: 1,
          NUM_STREAMS: 1,
          PERFORMANCE_HINT: "LATENCY",
        },
        fallback_policy: "none",
        os: "Linux",
        architecture: "x86_64",
        python_version: "3.12.3",
        adapter_sha256: "b".repeat(64),
        dependency_lock_sha256: "c".repeat(64),
        container_digest: null,
        telemetry: "disabled",
        worker_command: ["/usr/bin/python3", "-m", "edge_comparator.compiler_worker"],
        wall_time_limit_seconds: 60.0,
      },
      evaluation_key: "d".repeat(64),
      placement_scope: "openvino_imported_graph_query",
      query_placements: [{ name: "conv1", operation: "Conv", device: "CPU" }],
      artifacts: [
        {
          name: "model.onnx",
          sha256: validHex,
          size_bytes: 4,
          media_type: "application/octet-stream",
        },
      ],
    };

    it("sends binary with X-Retain-Evidence header and returns CompilationRun", async () => {
      const file = new File([new Uint8Array([1, 2, 3, 4])], "test_model.onnx");
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(new Response(JSON.stringify(mockCompilationRun), { status: 200 }));

      const run = await compileModel(file);
      expect(run.status).toBe("compiled_unverified");
      expect(run.target_id).toBe("intel-openvino-cpu");
      expect(run.configuration.device).toBe("CPU");
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/compile",
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "X-Retain-Evidence": "true",
          },
          body: file,
        }),
      );
    });

    it("validates file before sending request", async () => {
      const invalidFile = new File([new Uint8Array([1, 2])], "model.txt");
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      await expect(compileModel(invalidFile)).rejects.toThrow("File must have a .onnx extension.");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("throws explicit error on storage capacity failure (429/507)", async () => {
      const file = new File([new Uint8Array([1, 2])], "model.onnx");
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({ detail: "Storage limit reached (20 runs / 512 MiB capacity)" }),
          {
            status: 507,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );

      await expect(compileModel(file)).rejects.toThrow("Storage limit reached");
    });

    it("throws explicit error on malformed compile response payload", async () => {
      const file = new File([new Uint8Array([1, 2])], "model.onnx");
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ malformed: true }), { status: 200 }),
      );

      await expect(compileModel(file)).rejects.toThrow(/Invalid compile response schema/);
    });
  });

  describe("fetchRuns", () => {
    it("returns list of run summaries", async () => {
      const mockSummaries = [
        {
          id: "11111111-1111-1111-1111-111111111111",
          created_at: "2026-09-22T12:00:00Z",
          model_sha256: "a".repeat(64),
          status: "compiled_unverified",
          compiler_version: "2026.4.0",
          device_name: "Intel CPU",
          evaluation_key: "d".repeat(64),
          summary: "Compiled successfully",
        },
      ];

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockSummaries), { status: 200 }),
      );

      const runs = await fetchRuns();
      expect(runs).toHaveLength(1);
      expect(runs[0]?.id).toBe("11111111-1111-1111-1111-111111111111");
    });

    it("throws error on non-OK response and malformed response", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: "Database unavailable" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
      );

      await expect(fetchRuns()).rejects.toThrow("Database unavailable");

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ notAnArray: true }), { status: 200 }),
      );

      await expect(fetchRuns()).rejects.toThrow(/Invalid runs list schema/);
    });
  });

  describe("fetchRun", () => {
    it("fetches single run by id", async () => {
      const mockRun = {
        schema_version: 1,
        id: "11111111-1111-1111-1111-111111111111",
        created_at: "2026-09-22T12:00:00Z",
        model: {
          sha256: "a".repeat(64),
          format: "onnx",
          ir_version: 8,
          opsets: { "": 17 },
          inputs: [],
          outputs: [],
          operations: [],
          node_count: 0,
        },
        target_id: "intel-openvino-cpu",
        status: "compile_failed",
        stage: "import",
        evidence_type: "compiler_reported",
        summary: "Unsupported operator: CustomOp",
        diagnostics: "Error during ONNX import: unknown operator",
        configuration: {
          adapter: "openvino-cpu",
          adapter_version: "1",
          requested_version: "2026.4.0",
          compiler_version: "2026.4.0",
          compiler_build: "build-1",
          plugin_version: "plugin-1",
          device: "CPU",
          reader: "onnx_frontend",
          cpu_affinity: "one_allowed_logical_cpu",
          device_name: "AMD Ryzen 9 7950X3D",
          precision: "f32",
          options: {},
          fallback_policy: "none",
          os: "Linux",
          architecture: "x86_64",
          python_version: "3.12.3",
          adapter_sha256: "b".repeat(64),
          dependency_lock_sha256: "c".repeat(64),
          container_digest: null,
          telemetry: "disabled",
          worker_command: null,
          wall_time_limit_seconds: null,
        },
        evaluation_key: "d".repeat(64),
        placement_scope: "openvino_imported_graph_query",
        query_placements: [],
        artifacts: [],
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockRun), { status: 200 }),
      );

      const run = await fetchRun("11111111-1111-1111-1111-111111111111");
      expect(run.status).toBe("compile_failed");
      expect(run.stage).toBe("import");
    });

    it("throws error on non-OK response or malformed payload", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: "Run record missing" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }),
      );

      await expect(fetchRun("11111111-1111-1111-1111-111111111111")).rejects.toThrow(
        "Run record missing",
      );

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ invalid: "run" }), { status: 200 }),
      );

      await expect(fetchRun("11111111-1111-1111-1111-111111111111")).rejects.toThrow(
        /Invalid run response schema/,
      );
    });
  });

  describe("deleteRun", () => {
    it("sends DELETE request and succeeds on 204", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(new Response(null, { status: 204 }));

      await deleteRun("11111111-1111-1111-1111-111111111111");
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/runs/11111111-1111-1111-1111-111111111111",
        expect.objectContaining({ method: "DELETE" }),
      );
    });

    it("throws error on failure", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: "Run not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }),
      );

      await expect(deleteRun("11111111-1111-1111-1111-111111111111")).rejects.toThrow(
        "Run not found",
      );
    });
  });
});
