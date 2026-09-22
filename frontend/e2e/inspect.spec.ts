import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const model = execFileSync(
  "uv",
  [
    "run",
    "--project",
    "../backend",
    "--frozen",
    "python",
    "-c",
    `import sys
from onnx import TensorProto, helper
graph = helper.make_graph(
    [helper.make_node("Relu", ["input"], ["output"], name="relu")],
    "public-test-fixture",
    [helper.make_tensor_value_info("input", TensorProto.FLOAT, ["batch", 3])],
    [helper.make_tensor_value_info("output", TensorProto.FLOAT, ["batch", 3])],
)
model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)])
sys.stdout.buffer.write(model.SerializeToString())
`,
  ],
  { env: { ...process.env, OPENBLAS_NUM_THREADS: "1" } },
);
const sha256 = createHash("sha256").update(model).digest("hex");

async function upload(page: Page, buffer = model): Promise<number> {
  await page.getByLabel("ONNX model", { exact: true }).setInputFiles({
    name: "public-fixture.onnx",
    mimeType: "application/octet-stream",
    buffer,
  });
  const response = page.waitForResponse(
    (candidate) =>
      candidate.url().endsWith("/api/inspect") && candidate.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Inspect model", exact: true }).click();
  return (await response).status();
}

test("real ONNX bytes produce exact identity, accessible inventory, and unevaluated targets", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Edge AI Comparator", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(3);
  expect(await upload(page)).toBe(200);
  await expect(page.getByText(sha256, { exact: true })).toBeVisible();
  await expect(page.getByText("Static inferred / preflight", { exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Relu", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "[batch, 3]", exact: true })).toHaveCount(2);
  const matrix = page.getByRole("table", { name: "Compatibility matrix", exact: true });
  await expect(matrix.getByRole("cell", { name: "Not tested", exact: true })).toHaveCount(3);
  await expect(matrix.getByRole("cell", { name: "Not selected", exact: true })).toHaveCount(3);

  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);

  await page.getByRole("checkbox", { name: /Intel/ }).uncheck();
  await expect(matrix.getByRole("cell", { name: "Not tested", exact: true })).toHaveCount(2);
  await page.getByRole("button", { name: "Deselect All", exact: true }).click();
  await expect(page.getByText("No targets selected to display in matrix.")).toBeVisible();
});

test("rejected uploads never retain another model's evidence and can recover", async ({ page }) => {
  await page.goto("/");
  expect(await upload(page)).toBe(200);
  await expect(page.getByText(sha256, { exact: true })).toBeVisible();
  expect(await upload(page, Buffer.from("not an ONNX protobuf"))).toBe(422);
  await expect(page.getByRole("alert")).toContainText("Failed to deserialize");
  await expect(page.getByText(sha256, { exact: true })).toHaveCount(0);
  await expect(page.getByRole("table", { name: "Compatibility matrix" })).toHaveCount(0);
  expect(await upload(page)).toBe(200);
  await expect(page.getByText(sha256, { exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
