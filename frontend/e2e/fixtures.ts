import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test as base } from "@playwright/test";

interface BackendControl {
  restart: () => Promise<void>;
}

export const test = base.extend<object, { backend: BackendControl }>({
  backend: [
    async ({ playwright }, provide) => {
      const directory = await mkdtemp(join(tmpdir(), "edge-browser-"));
      const request = await playwright.request.newContext({
        baseURL: "http://127.0.0.1:8000",
      });
      let process: ChildProcess | null = null;

      async function stop(): Promise<void> {
        if (process?.exitCode === null) {
          const stopped = once(process, "exit", { signal: AbortSignal.timeout(5000) });
          process.kill("SIGTERM");
          try {
            await stopped;
          } catch (error: unknown) {
            if (!(error instanceof Error && error.name === "AbortError")) throw error;
            const killed = once(process, "exit");
            process.kill("SIGKILL");
            await killed;
          }
        }
        process = null;
      }

      async function start(): Promise<void> {
        const probe = createServer();
        await new Promise<void>((resolveProbe, rejectProbe) => {
          probe.once("error", rejectProbe);
          probe.listen(8000, "127.0.0.1", () => {
            probe.close((error) => {
              if (error) rejectProbe(error);
              else resolveProbe();
            });
          });
        });
        const child = spawn(
          resolve("../backend/.venv/bin/python"),
          ["-m", "uvicorn", "edge_comparator.api:app", "--host", "127.0.0.1", "--port", "8000"],
          {
            cwd: resolve("../backend"),
            env: {
              ...globalThis.process.env,
              EDGE_COMPARATOR_DATA_DIR: join(directory, "evidence"),
              OPENBLAS_NUM_THREADS: "1",
            },
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        process = child;
        let logs = "";
        let startupError: Error | undefined;
        const record = (chunk: Buffer): void => {
          logs = (logs + chunk.toString("utf8")).slice(-8192);
        };
        child.stdout.on("data", record);
        child.stderr.on("data", record);
        child.on("error", (error) => {
          startupError = error;
        });
        await expect
          .poll(
            async () => {
              if (startupError) throw startupError;
              if (child.exitCode !== null) throw new Error(`Backend exited: ${logs}`);
              if (!logs.includes("Uvicorn running on")) return false;
              return (await request.get("/api/health")).ok();
            },
            { timeout: 15_000 },
          )
          .toBe(true);
      }

      try {
        await start();
        await provide({
          restart: async () => {
            await stop();
            await start();
          },
        });
      } finally {
        await stop();
        await request.dispose();
        await rm(directory, { recursive: true, force: true });
      }
    },
    { scope: "worker", auto: true },
  ],
});

export { expect } from "@playwright/test";
