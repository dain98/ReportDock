import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import { lookup as lookupMime } from "mime-types";
import {
  isExternalReference,
  normalizeReportPath,
  safeDecodeReferencePath,
  stripReferenceSuffix
} from "./path-validation.js";

export interface BundledAsset {
  path: string;
  field: string;
  size: number;
  sha256: string;
  absolutePath: string;
  contentType: string;
}

export interface ReportBundle {
  entry: "index.html";
  title?: string;
  metadata: Record<string, unknown>;
  html: Buffer;
  assets: BundledAsset[];
}

export interface BundleReportOptions {
  entryFile: string;
  title?: string;
  metadata?: Record<string, unknown>;
  assetRoot?: string;
}

const SIMPLE_REF_SELECTORS: Array<[string, string]> = [
  ["img[src]", "src"],
  ["script[src]", "src"],
  ["source[src]", "src"],
  ["video[src]", "src"],
  ["video[poster]", "poster"],
  ["audio[src]", "src"],
  ["track[src]", "src"],
  ["object[data]", "data"],
  ["embed[src]", "src"]
];

const LINK_RELS_TO_BUNDLE = new Set([
  "apple-touch-icon",
  "icon",
  "manifest",
  "modulepreload",
  "preload",
  "stylesheet"
]);

export function discoverAssetsFromHtml(html: string): string[] {
  const $ = cheerio.load(html);
  const found = new Map<string, string>();

  const addReference = (rawValue: string | undefined): void => {
    if (!rawValue) {
      return;
    }

    const value = rawValue.trim();
    if (!value || value.startsWith("#") || isExternalReference(value)) {
      return;
    }

    const withoutSuffix = stripReferenceSuffix(value);
    if (!withoutSuffix) {
      return;
    }

    const decoded = safeDecodeReferencePath(withoutSuffix);
    const normalized = normalizeReportPath(decoded);
    found.set(normalized, normalized);
  };

  for (const [selector, attr] of SIMPLE_REF_SELECTORS) {
    $(selector).each((_, element) => addReference($(element).attr(attr)));
  }

  $("link[href]").each((_, element) => {
    const rel = ($(element).attr("rel") ?? "")
      .split(/\s+/)
      .map((part) => part.toLowerCase())
      .filter(Boolean);

    if (rel.some((part) => LINK_RELS_TO_BUNDLE.has(part))) {
      addReference($(element).attr("href"));
    }
  });

  $("[srcset]").each((_, element) => {
    for (const candidate of parseSrcset($(element).attr("srcset") ?? "")) {
      addReference(candidate);
    }
  });

  return [...found.keys()].sort();
}

export function extractHtmlTitle(html: string): string | undefined {
  const $ = cheerio.load(html);
  const title = $("title").first().text().trim();
  return title.length > 0 ? title : undefined;
}

export async function bundleReport(options: BundleReportOptions): Promise<ReportBundle> {
  const entryFile = path.resolve(options.entryFile);
  const root = path.resolve(options.assetRoot ?? path.dirname(entryFile));
  const html = await readFile(entryFile);
  const htmlText = html.toString("utf8");
  const assetPaths = discoverAssetsFromHtml(htmlText);
  const assets: BundledAsset[] = [];

  for (const [index, assetPath] of assetPaths.entries()) {
    const absolutePath = resolveWithinRoot(root, assetPath);
    const info = await stat(absolutePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        throw new Error(`Referenced asset does not exist under assetRoot: ${assetPath}`);
      }
      throw error;
    });

    if (!info.isFile()) {
      throw new Error(`Referenced asset is not a file: ${assetPath}`);
    }

    const bytes = await readFile(absolutePath);
    assets.push({
      path: assetPath,
      field: `asset_${index}`,
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      absolutePath,
      contentType: lookupMime(assetPath) || "application/octet-stream"
    });
  }

  return {
    entry: "index.html",
    title: options.title ?? extractHtmlTitle(htmlText),
    metadata: options.metadata ?? {},
    html,
    assets
  };
}

function parseSrcset(srcset: string): string[] {
  return srcset
    .split(",")
    .map((candidate) => candidate.trim())
    .filter(Boolean)
    .map((candidate) => candidate.split(/\s+/, 1)[0])
    .filter((candidate): candidate is string => Boolean(candidate));
}

function resolveWithinRoot(root: string, reportPath: string): string {
  const resolved = path.resolve(root, reportPath);
  const relative = path.relative(root, resolved);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Referenced asset resolves outside assetRoot: ${reportPath}`);
  }

  return resolved;
}
