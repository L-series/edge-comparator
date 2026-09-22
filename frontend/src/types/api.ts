import { z } from "zod";

export const TargetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  vendor: z.string().min(1),
  accelerator: z.string().min(1),
  source_url: z.url(),
  configuration_status: z.literal("catalog_only"),
});

export type Target = z.infer<typeof TargetSchema>;

export const TargetCatalogSchema = z.array(TargetSchema);
export type TargetCatalog = z.infer<typeof TargetCatalogSchema>;

export const ModelTensorSchema = z.object({
  name: z.string(),
  dtype: z.string(),
  shape: z.array(z.union([z.number(), z.string(), z.null()])),
});

export type ModelTensor = z.infer<typeof ModelTensorSchema>;

export const ModelOperationSchema = z.object({
  index: z.number(),
  name: z.string(),
  domain: z.string(),
  op_type: z.string(),
});

export type ModelOperation = z.infer<typeof ModelOperationSchema>;

export const ModelInfoSchema = z.object({
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  format: z.literal("onnx"),
  ir_version: z.number(),
  opsets: z.record(z.string(), z.number()),
  inputs: z.array(ModelTensorSchema),
  outputs: z.array(ModelTensorSchema),
  operations: z.array(ModelOperationSchema),
  node_count: z.number(),
});

export type ModelInfo = z.infer<typeof ModelInfoSchema>;

export const InspectResultSchema = z.object({
  target_id: z.string(),
  status: z.literal("not_tested"),
  reason: z.string(),
});

export type InspectResult = z.infer<typeof InspectResultSchema>;

export const InspectResponseSchema = z.object({
  evidence_type: z.literal("static_inferred"),
  stage: z.literal("preflight"),
  model: ModelInfoSchema,
  results: z.array(InspectResultSchema),
});

export type InspectResponse = z.infer<typeof InspectResponseSchema>;

export const ApiErrorSchema = z.object({
  detail: z.string(),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;

export const OutcomeSchema = z.enum(["compiled_unverified", "compile_failed", "inconclusive"]);
export type Outcome = z.infer<typeof OutcomeSchema>;

export const StageSchema = z.enum(["environment", "import", "query", "compile", "worker"]);
export type Stage = z.infer<typeof StageSchema>;

export const ArtifactNameSchema = z.enum([
  "model.onnx",
  "worker.stdout.json",
  "worker.stderr.txt",
  "diagnostics.txt",
  "uv.lock",
]);
export type ArtifactName = z.infer<typeof ArtifactNameSchema>;

export const CompilerConfigurationSchema = z.object({
  adapter: z.literal("openvino-cpu"),
  adapter_version: z.literal("1"),
  requested_version: z.string().min(1),
  compiler_version: z.string().nullable().optional(),
  compiler_build: z.string().nullable().optional(),
  plugin_version: z.string().nullable().optional(),
  device: z.literal("CPU"),
  reader: z.literal("onnx_frontend"),
  cpu_affinity: z.literal("one_allowed_logical_cpu"),
  device_name: z.string().nullable().optional(),
  precision: z.literal("f32"),
  options: z.record(z.string(), z.union([z.string(), z.number()])),
  fallback_policy: z.literal("none"),
  os: z.string(),
  architecture: z.string(),
  python_version: z.string(),
  adapter_sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  dependency_lock_sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  container_digest: z.string().nullable().optional(),
  telemetry: z.literal("disabled"),
  worker_command: z.array(z.string()).nullable().optional(),
  wall_time_limit_seconds: z.number().nullable().optional(),
});
export type CompilerConfiguration = z.infer<typeof CompilerConfigurationSchema>;

export const QueryPlacementSchema = z.object({
  name: z.string(),
  operation: z.string(),
  device: z.string().nullable().optional(),
});
export type QueryPlacement = z.infer<typeof QueryPlacementSchema>;

export const EvidenceArtifactSchema = z.object({
  name: ArtifactNameSchema,
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  size_bytes: z.number().nonnegative(),
  media_type: z.string(),
});
export type EvidenceArtifact = z.infer<typeof EvidenceArtifactSchema>;

export const CompilationRunSchema = z.object({
  schema_version: z.literal(1),
  id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
  created_at: z.string(),
  model: ModelInfoSchema,
  target_id: z.literal("intel-openvino-cpu"),
  status: OutcomeSchema,
  stage: StageSchema,
  evidence_type: z.enum(["compiler_reported", "infrastructure_observed"]),
  summary: z.string(),
  diagnostics: z.string(),
  configuration: CompilerConfigurationSchema,
  evaluation_key: z.string().regex(/^[a-f0-9]{64}$/i),
  placement_scope: z.literal("openvino_imported_graph_query"),
  query_placements: z.array(QueryPlacementSchema),
  artifacts: z.array(EvidenceArtifactSchema),
});
export type CompilationRun = z.infer<typeof CompilationRunSchema>;

export const RunSummarySchema = z.object({
  id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
  created_at: z.string(),
  model_sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  status: OutcomeSchema,
  compiler_version: z.string().nullable().optional(),
  device_name: z.string().nullable().optional(),
  evaluation_key: z.string().regex(/^[a-f0-9]{64}$/i),
  summary: z.string(),
});
export type RunSummary = z.infer<typeof RunSummarySchema>;

export const DemoIdSchema = z.enum(["supported-cnn", "unsupported-op"]);
export type DemoId = z.infer<typeof DemoIdSchema>;
