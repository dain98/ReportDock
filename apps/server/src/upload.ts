import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { once } from "node:events";
import path from "node:path";
import type { FastifyRequest } from "fastify";
import type { MultipartFile } from "@fastify/multipart";
import type { ReportDockConfig } from "./config.js";
import type { ReportDatabase, ReportRecord } from "./db.js";
import { generateNonce, generateReportId } from "./ids.js";
import { normalizeReportPath, safeResolve, validateReportId } from "./path-validation.js";

export class UploadError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = "UploadError";
  }
}

interface ManifestAsset {
  path: string;
  field: string;
  size: number;
  sha256: string;
}

interface UploadManifest {
  entry: string;
  title?: string;
  metadata?: Record<string, unknown>;
  assets: ManifestAsset[];
}

interface UploadedPart {
  field: string;
  tmpPath: string;
  size: number;
  sha256: string;
  mimetype: string;
}

interface UploadedReport {
  report: ReportRecord;
  directory: string;
}

const FILE_FIELD = /^(?:manifest|html|asset_\d+)$/;
const ASSET_FIELD = /^asset_\d+$/;
const SHA256 = /^[a-f0-9]{64}$/;

export async function processReportUpload(
  request: FastifyRequest,
  config: ReportDockConfig,
  db: ReportDatabase
): Promise<UploadedReport> {
  const id = validateReportId(generateReportId());
  const stagingDir = path.join(config.tmpDir, `upload-${id}-${generateNonce()}`);
  const uploadDir = path.join(stagingDir, ".uploads");
  let insertedMetadata = false;

  await mkdir(uploadDir, { recursive: true });

  try {
    const parsed = await parseMultipartUpload(request, uploadDir, config);
    const manifest = parseManifest(parsed.manifestRaw, config);
    const prepared = await prepareStagingDirectory(stagingDir, parsed.files, manifest, config);
    const createdAt = new Date().toISOString();

    db.insertReport({
      id,
      title: manifest.title,
      createdAt,
      sizeBytes: prepared.sizeBytes,
      assetCount: manifest.assets.length,
      metadata: manifest.metadata ?? {},
      entryPath: "index.html"
    });
    insertedMetadata = true;

    const finalDir = path.join(config.reportsDir, id);
    await mkdir(config.reportsDir, { recursive: true });
    await rename(stagingDir, finalDir);

    return {
      report: {
        id,
        title: manifest.title,
        createdAt,
        sizeBytes: prepared.sizeBytes,
        assetCount: manifest.assets.length,
        metadata: manifest.metadata ?? {},
        entryPath: "index.html"
      },
      directory: finalDir
    };
  } catch (error) {
    if (insertedMetadata) {
      db.markDeleted(id, new Date().toISOString());
    }
    await rm(stagingDir, { recursive: true, force: true });
    throw error;
  }
}

async function parseMultipartUpload(
  request: FastifyRequest,
  uploadDir: string,
  config: ReportDockConfig
): Promise<{ manifestRaw: string; files: Map<string, UploadedPart> }> {
  const files = new Map<string, UploadedPart>();
  let manifestRaw: string | undefined;
  let totalBytes = 0;

  for await (const part of request.parts()) {
    if (part.type === "field") {
      if (part.fieldname !== "manifest") {
        throw new UploadError(400, `Unexpected multipart field: ${part.fieldname}`);
      }
      if (manifestRaw !== undefined) {
        throw new UploadError(400, "Duplicate manifest field.");
      }
      manifestRaw = readManifestField(part.value, config);
      totalBytes += Buffer.byteLength(manifestRaw);
      if (totalBytes > config.maxUploadBytes) {
        throw new UploadError(413, "Upload exceeds REPORTDOCK_MAX_UPLOAD_BYTES.");
      }
      continue;
    }

    if (!FILE_FIELD.test(part.fieldname)) {
      throw new UploadError(400, `Unexpected multipart file field: ${part.fieldname}`);
    }

    if (part.fieldname === "manifest") {
      if (manifestRaw !== undefined) {
        throw new UploadError(400, "Duplicate manifest field.");
      }
      const manifestFile = await readSmallFilePart(part, config.maxMetadataBytes, (bytes) => {
        totalBytes += bytes;
        if (totalBytes > config.maxUploadBytes) {
          throw new UploadError(413, "Upload exceeds REPORTDOCK_MAX_UPLOAD_BYTES.");
        }
      });
      manifestRaw = manifestFile.toString("utf8");
      continue;
    }

    if (files.has(part.fieldname)) {
      throw new UploadError(400, `Duplicate file field: ${part.fieldname}`);
    }

    const maxPartBytes = part.fieldname === "html" ? config.maxHtmlBytes : config.maxUploadBytes;
    const tmpPath = path.join(uploadDir, `${part.fieldname}.upload`);
    const written = await writeFilePart(part, tmpPath, maxPartBytes, (chunkBytes) => {
      totalBytes += chunkBytes;
      if (totalBytes > config.maxUploadBytes) {
        throw new UploadError(413, "Upload exceeds REPORTDOCK_MAX_UPLOAD_BYTES.");
      }
    });

    files.set(part.fieldname, {
      field: part.fieldname,
      tmpPath,
      size: written.size,
      sha256: written.sha256,
      mimetype: part.mimetype
    });
  }

  if (!manifestRaw) {
    throw new UploadError(400, "Missing manifest field.");
  }

  return { manifestRaw, files };
}

function readManifestField(value: unknown, config: ReportDockConfig): string {
  if (typeof value !== "string") {
    throw new UploadError(400, "Manifest field must be a JSON string.");
  }

  if (Buffer.byteLength(value) > config.maxMetadataBytes) {
    throw new UploadError(413, "Manifest exceeds REPORTDOCK_MAX_METADATA_BYTES.");
  }

  return value;
}

async function readSmallFilePart(
  part: MultipartFile,
  maxBytes: number,
  addTotalBytes: (bytes: number) => void
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of part.file) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) {
      throw new UploadError(413, "Manifest exceeds REPORTDOCK_MAX_METADATA_BYTES.");
    }
    addTotalBytes(buffer.length);
    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}

async function writeFilePart(
  part: MultipartFile,
  destination: string,
  maxBytes: number,
  addTotalBytes: (bytes: number) => void
): Promise<{ size: number; sha256: string }> {
  const output = createWriteStream(destination, { flags: "wx" });
  const hash = createHash("sha256");
  let size = 0;

  try {
    for await (const chunk of part.file) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > maxBytes) {
        throw new UploadError(413, `${part.fieldname} exceeds configured size limits.`);
      }
      addTotalBytes(buffer.length);
      hash.update(buffer);

      if (!output.write(buffer)) {
        await once(output, "drain");
      }
    }

    output.end();
    await once(output, "finish");
  } catch (error) {
    output.destroy();
    throw error;
  }

  return { size, sha256: hash.digest("hex") };
}

function parseManifest(raw: string, config: ReportDockConfig): UploadManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new UploadError(400, "Manifest must be valid JSON.");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new UploadError(400, "Manifest must be a JSON object.");
  }

  const manifest = parsed as Partial<UploadManifest>;
  if (manifest.entry !== "index.html") {
    throw new UploadError(400, "Manifest entry must be index.html.");
  }

  if (manifest.title !== undefined && typeof manifest.title !== "string") {
    throw new UploadError(400, "Manifest title must be a string.");
  }

  if (manifest.metadata !== undefined && !isPlainObject(manifest.metadata)) {
    throw new UploadError(400, "Manifest metadata must be an object.");
  }

  const metadataJson = JSON.stringify(manifest.metadata ?? {});
  if (Buffer.byteLength(metadataJson) > config.maxMetadataBytes) {
    throw new UploadError(413, "Metadata exceeds REPORTDOCK_MAX_METADATA_BYTES.");
  }

  if (!Array.isArray(manifest.assets)) {
    throw new UploadError(400, "Manifest assets must be an array.");
  }

  if (manifest.assets.length > config.maxAssetCount) {
    throw new UploadError(413, "Manifest exceeds REPORTDOCK_MAX_ASSET_COUNT.");
  }

  const normalizedAssets: ManifestAsset[] = [];
  const seenPaths = new Set<string>();
  const seenFields = new Set<string>();

  for (const rawAsset of manifest.assets) {
    if (!rawAsset || typeof rawAsset !== "object") {
      throw new UploadError(400, "Manifest asset entries must be objects.");
    }

    const asset = rawAsset as Partial<ManifestAsset>;
    if (typeof asset.field !== "string" || !ASSET_FIELD.test(asset.field)) {
      throw new UploadError(400, "Manifest asset field must be asset_N.");
    }
    if (typeof asset.path !== "string") {
      throw new UploadError(400, "Manifest asset path must be a string.");
    }
    if (typeof asset.size !== "number" || !Number.isSafeInteger(asset.size) || asset.size < 0) {
      throw new UploadError(400, "Manifest asset size must be a non-negative integer.");
    }
    if (typeof asset.sha256 !== "string" || !SHA256.test(asset.sha256)) {
      throw new UploadError(400, "Manifest asset sha256 must be a lowercase hex digest.");
    }

    const normalizedPath = normalizeReportPath(asset.path);
    if (normalizedPath === "index.html") {
      throw new UploadError(400, "Asset path must not overwrite index.html.");
    }
    if (seenPaths.has(normalizedPath)) {
      throw new UploadError(400, `Duplicate manifest asset path: ${normalizedPath}`);
    }
    if (seenFields.has(asset.field)) {
      throw new UploadError(400, `Duplicate manifest asset field: ${asset.field}`);
    }

    seenPaths.add(normalizedPath);
    seenFields.add(asset.field);
    normalizedAssets.push({
      path: normalizedPath,
      field: asset.field,
      size: asset.size,
      sha256: asset.sha256
    });
  }

  return {
    entry: "index.html",
    title: manifest.title,
    metadata: manifest.metadata ?? {},
    assets: normalizedAssets
  };
}

async function prepareStagingDirectory(
  stagingDir: string,
  files: Map<string, UploadedPart>,
  manifest: UploadManifest,
  config: ReportDockConfig
): Promise<{ sizeBytes: number }> {
  const html = files.get("html");
  if (!html) {
    throw new UploadError(400, "Missing html file field.");
  }

  if (html.size > config.maxHtmlBytes) {
    throw new UploadError(413, "HTML exceeds REPORTDOCK_MAX_HTML_BYTES.");
  }

  const expectedAssetFields = new Set(manifest.assets.map((asset) => asset.field));
  for (const field of files.keys()) {
    if (field !== "html" && !expectedAssetFields.has(field)) {
      throw new UploadError(400, `Uploaded file field is not declared in manifest: ${field}`);
    }
  }

  let sizeBytes = html.size;
  await rename(html.tmpPath, path.join(stagingDir, "index.html"));

  for (const asset of manifest.assets) {
    const uploaded = files.get(asset.field);
    if (!uploaded) {
      throw new UploadError(400, `Manifest asset missing uploaded file: ${asset.field}`);
    }
    if (uploaded.size !== asset.size) {
      throw new UploadError(400, `Manifest size mismatch for ${asset.path}.`);
    }
    if (uploaded.sha256 !== asset.sha256) {
      throw new UploadError(400, `Manifest sha256 mismatch for ${asset.path}.`);
    }

    sizeBytes += uploaded.size;
    if (sizeBytes > config.maxReportBytes) {
      throw new UploadError(413, "Report exceeds REPORTDOCK_MAX_REPORT_BYTES.");
    }

    const target = safeResolve(stagingDir, asset.path);
    await mkdir(path.dirname(target), { recursive: true });
    await rename(uploaded.tmpPath, target);
  }

  await writeFile(
    path.join(stagingDir, "manifest.json"),
    `${JSON.stringify(
      {
        entry: "index.html",
        title: manifest.title,
        metadata: manifest.metadata ?? {},
        assets: manifest.assets,
        sizeBytes
      },
      null,
      2
    )}\n`
  );
  await rm(path.join(stagingDir, ".uploads"), { recursive: true, force: true });

  return { sizeBytes };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
