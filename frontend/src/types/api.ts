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
