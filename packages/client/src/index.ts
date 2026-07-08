import { readFile } from "node:fs/promises";
import { lookup as lookupMime } from "mime-types";
import { bundleReport } from "./assets.js";

export interface PublishReportOptions {
  entryFile: string;
  baseUrl?: string;
  token?: string;
  title?: string;
  metadata?: Record<string, unknown>;
  assetRoot?: string;
}

export interface PublishedReport {
  id: string;
  url: string;
  title?: string;
  createdAt: string;
}

export async function publishReport(options: PublishReportOptions): Promise<PublishedReport> {
  const baseUrl = options.baseUrl ?? process.env.REPORTDOCK_BASE_URL;
  const token = options.token ?? process.env.REPORTDOCK_TOKEN ?? process.env.REPORTDOCK_ADMIN_TOKEN;

  if (!baseUrl) {
    throw new Error("Missing ReportDock base URL. Pass --base-url or set REPORTDOCK_BASE_URL.");
  }

  if (!token) {
    throw new Error("Missing ReportDock token. Pass --token or set REPORTDOCK_TOKEN.");
  }

  const bundle = await bundleReport(options);
  const manifest = {
    entry: bundle.entry,
    title: bundle.title,
    metadata: bundle.metadata,
    assets: bundle.assets.map((asset) => ({
      path: asset.path,
      field: asset.field,
      size: asset.size,
      sha256: asset.sha256
    }))
  };

  const form = new FormData();
  form.append(
    "manifest",
    new Blob([JSON.stringify(manifest)], { type: "application/json" }),
    "manifest.json"
  );
  form.append("html", new Blob([toArrayBuffer(bundle.html)], { type: "text/html; charset=utf-8" }), "index.html");

  for (const asset of bundle.assets) {
    const bytes = await readFile(asset.absolutePath);
    form.append(
      asset.field,
      new Blob([toArrayBuffer(bytes)], { type: asset.contentType || lookupMime(asset.path) || "application/octet-stream" }),
      asset.path.split("/").at(-1) ?? asset.field
    );
  }

  const response = await fetch(new URL("/api/reports", normalizeBaseUrl(baseUrl)), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: form
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`ReportDock publish failed (${response.status}): ${body}`);
  }

  return (await response.json()) as PublishedReport;
}

function normalizeBaseUrl(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  const arrayBuffer = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(arrayBuffer).set(buffer);
  return arrayBuffer;
}

export { bundleReport, discoverAssetsFromHtml } from "./assets.js";
export { normalizeReportPath } from "./path-validation.js";
