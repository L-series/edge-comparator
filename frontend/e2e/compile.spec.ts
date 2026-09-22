import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { CompilationRunSchema, type CompilationRun } from "../src/types/api";
import { expect, test } from "./fixtures";

async function compileDemo(page: Page, button: string): Promise<CompilationRun> {
  const demoResponse = page.waitForResponse((response) => response.url().includes("/api/demos/"));
  await page.getByRole("button", { name: button, exact: true }).click();
  const demo = await demoResponse;
  expect(demo.ok()).toBe(true);
  const uploaded = await (await page.request.get(demo.url())).body();
  expect(uploaded.length).toBeGreaterThan(0);
  const compile = page.getByRole("button", { name: "Compile on local CPU", exact: true });
  await expect(compile).toBeDisabled();
  await expect(
    page.getByRole("checkbox", { name: "Save model and evidence locally" }),
  ).toBeEnabled();
  await page.getByRole("checkbox", { name: "Save model and evidence locally" }).check();
  const response = page.waitForResponse(
    (candidate) =>
      candidate.url().endsWith("/api/compile") && candidate.request().method() === "POST",
  );
  await compile.click();
  const result = await response;
  expect(result.status()).toBe(200);
  const json: unknown = await result.json();
  const run = CompilationRunSchema.parse(json);
  expect(result.request().headers()["x-retain-evidence"]).toBe("true");
  expect(run.model.sha256).toBe(createHash("sha256").update(uploaded).digest("hex"));
  for (const artifact of run.artifacts) {
    const download = await page.request.get(`/api/runs/${run.id}/artifacts/${artifact.name}`);
    expect(download.ok()).toBe(true);
    expect(
      createHash("sha256")
        .update(await download.body())
        .digest("hex"),
    ).toBe(artifact.sha256);
  }
  return run;
}

test("real compiler evidence survives restart, reports rejection, and deletes only selected runs", async ({
  page,
  backend,
}) => {
  await page.goto("/");
  const compiled = await compileDemo(page, "Load supported CNN");
  const compiledId = compiled.id;
  const matrix = page.getByRole("table", { name: "Compatibility matrix", exact: true });
  await expect(
    matrix.getByRole("cell", { name: "Compiled — execution unverified", exact: true }),
  ).toBeVisible();
  await expect(matrix.getByRole("cell", { name: "Not tested", exact: true })).toHaveCount(2);
  await page.getByRole("button", { name: `View Evidence for run ${compiledId}` }).click();
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await page.getByRole("button", { name: "Close Historical View", exact: true }).click();
  const downloadedModel = page.waitForEvent("download");
  await page.getByRole("link", { name: /^model\.onnx \(/ }).click();
  const downloadPath = await (await downloadedModel).path();
  if (!downloadPath) throw new Error("Browser did not produce the model download");
  expect(
    createHash("sha256")
      .update(await readFile(downloadPath))
      .digest("hex"),
  ).toBe(compiled.model.sha256);

  const rejectedId = (await compileDemo(page, "Load unsupported operator")).id;
  await expect(matrix.getByRole("cell", { name: "Compile failed", exact: true })).toBeVisible();
  await page.getByText("Raw Diagnostics (available)", { exact: true }).click();
  await expect(page.locator(".diagnostics-pre")).toContainText("com.edge.demo.MysteryActivation");

  await backend.restart();
  await page.reload();
  await expect(
    page.getByRole("button", { name: `View Evidence for run ${compiledId}` }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: `View Evidence for run ${rejectedId}` }),
  ).toBeVisible();
  await page.getByRole("button", { name: `View Evidence for run ${compiledId}` }).click();
  await expect(page.getByRole("region", { name: "Saved Run Detail" })).toContainText(compiledId);
  await expect(matrix).toHaveCount(0);

  page.once("dialog", (dialog) => {
    void dialog.accept();
  });
  await page.getByRole("button", { name: `Delete run ${compiledId}` }).click();
  await expect(
    page.getByRole("button", { name: `View Evidence for run ${compiledId}` }),
  ).toHaveCount(0);
  expect((await page.request.get(`/api/runs/${compiledId}`)).status()).toBe(404);
  expect((await page.request.get(`/api/runs/${rejectedId}`)).ok()).toBe(true);
  page.once("dialog", (dialog) => {
    void dialog.accept();
  });
  await page.getByRole("button", { name: `Delete run ${rejectedId}` }).click();
  await expect(
    page.getByRole("button", { name: `View Evidence for run ${rejectedId}` }),
  ).toHaveCount(0);
});
