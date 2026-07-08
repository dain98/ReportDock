import path from "node:path";

export const REPORT_ID_PATTERN = /^[A-Za-z0-9_-]{20,64}$/;

const URL_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const CONTROL_CHARS = /[\x00-\x1F\x7F]/;

export class PathValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathValidationError";
  }
}

export function validateReportId(id: string): string {
  if (!REPORT_ID_PATTERN.test(id)) {
    throw new PathValidationError("Invalid report ID.");
  }

  return id;
}

export function normalizeReportPath(input: string): string {
  if (typeof input !== "string") {
    throw new PathValidationError("Report path must be a string.");
  }

  if (input.length === 0) {
    throw new PathValidationError("Report path must not be empty.");
  }

  if (CONTROL_CHARS.test(input)) {
    throw new PathValidationError(`Report path contains control characters: ${input}`);
  }

  if (input.includes("\\")) {
    throw new PathValidationError(`Report path must use POSIX separators: ${input}`);
  }

  if (input.startsWith("/") || input.startsWith("//")) {
    throw new PathValidationError(`Report path must be relative: ${input}`);
  }

  if (URL_SCHEME.test(input)) {
    throw new PathValidationError(`Report path must not include a URL scheme: ${input}`);
  }

  if (input.includes("?") || input.includes("#")) {
    throw new PathValidationError(`Report path must not include query strings or fragments: ${input}`);
  }

  const parts = input.split("/");
  if (parts.some((part) => part.length === 0)) {
    throw new PathValidationError(`Report path must not contain empty segments: ${input}`);
  }

  if (parts.some((part) => part === "..")) {
    throw new PathValidationError(`Report path must not traverse directories: ${input}`);
  }

  const normalized = path.posix.normalize(input);
  if (normalized === "." || normalized.length === 0) {
    throw new PathValidationError(`Report path does not identify a file: ${input}`);
  }

  if (normalized.startsWith("../") || normalized === ".." || path.posix.isAbsolute(normalized)) {
    throw new PathValidationError(`Report path resolves outside the report: ${input}`);
  }

  return normalized;
}

export function safeDecodePath(input: string): string {
  try {
    return decodeURIComponent(input);
  } catch {
    throw new PathValidationError("Report path contains invalid URL encoding.");
  }
}

export function safeResolve(root: string, reportPath: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, reportPath);
  const relative = path.relative(resolvedRoot, resolved);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new PathValidationError("Report path resolves outside the report directory.");
  }

  return resolved;
}
