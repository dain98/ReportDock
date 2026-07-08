import { randomBytes } from "node:crypto";

export function generateReportId(): string {
  return randomBytes(16).toString("base64url");
}

export function generateNonce(): string {
  return randomBytes(8).toString("base64url");
}
