import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { createApp } from "../apps/server/src/app.js";

export const TEST_TOKEN = "test-token-with-enough-entropy";

export interface TestServer {
  app: FastifyInstance;
  baseUrl: string;
  dataDir: string;
  close: () => Promise<void>;
}

export async function startTestServer(options: Record<string, unknown> = {}): Promise<TestServer> {
  const port = await getFreePort();
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "reportdock-server-"));
  const app = await createApp({
    adminToken: TEST_TOKEN,
    baseUrl: `http://127.0.0.1:${port}`,
    dataDir,
    port,
    ...options
  });

  await app.listen({ host: "127.0.0.1", port });

  return {
    app,
    baseUrl: `http://127.0.0.1:${port}`,
    dataDir,
    close: async () => {
      await app.close();
      await rm(dataDir, { recursive: true, force: true });
    }
  };
}

export async function makeReportForm(
  html: string,
  assets: Array<{ path: string; field: string; bytes: string | Buffer }> = [],
  extraManifest: Record<string, unknown> = {}
): Promise<FormData> {
  const form = new FormData();
  const manifest = {
    entry: "index.html",
    title: "Test Report",
    metadata: { branch: "main" },
    assets: assets.map((asset) => {
      const bytes = Buffer.isBuffer(asset.bytes) ? asset.bytes : Buffer.from(asset.bytes);
      return {
        path: asset.path,
        field: asset.field,
        size: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex")
      };
    }),
    ...extraManifest
  };

  form.append("manifest", new Blob([JSON.stringify(manifest)], { type: "application/json" }), "manifest.json");
  form.append("html", new Blob([toArrayBuffer(Buffer.from(html))], { type: "text/html" }), "index.html");

  for (const asset of assets) {
    const bytes = Buffer.isBuffer(asset.bytes) ? asset.bytes : Buffer.from(asset.bytes);
    form.append(asset.field, new Blob([toArrayBuffer(bytes)], { type: "application/octet-stream" }), asset.path);
  }

  return form;
}

export async function postReport(baseUrl: string, token: string, form: FormData): Promise<Response> {
  return fetch(new URL("/api/reports", baseUrl), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
}

export async function putReport(baseUrl: string, id: string, token: string, form: FormData): Promise<Response> {
  return fetch(new URL(`/api/reports/${id}`, baseUrl), {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
}

export async function readFixture(relativePath: string): Promise<Buffer> {
  return readFile(path.join(process.cwd(), "tests/fixtures/basic-report", relativePath));
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  const arrayBuffer = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(arrayBuffer).set(buffer);
  return arrayBuffer;
}

async function getFreePort(): Promise<number> {
  const net = await import("node:net");
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to allocate a test port."));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}
