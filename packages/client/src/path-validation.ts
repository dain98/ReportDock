import path from "node:path";

const URL_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const CONTROL_CHARS = /[\x00-\x1F\x7F]/;

export class PathValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathValidationError";
  }
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

export function isExternalReference(value: string): boolean {
  const trimmed = value.trim();
  return URL_SCHEME.test(trimmed) || trimmed.startsWith("//");
}

export function stripReferenceSuffix(value: string): string {
  const queryIndex = value.indexOf("?");
  const hashIndex = value.indexOf("#");
  const indexes = [queryIndex, hashIndex].filter((index) => index >= 0);
  if (indexes.length === 0) {
    return value;
  }

  return value.slice(0, Math.min(...indexes));
}

export function safeDecodeReferencePath(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    throw new PathValidationError(`Report path has invalid URL encoding: ${value}`);
  }
}
