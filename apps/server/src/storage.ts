import path from "node:path";
import type { ReportDockConfig } from "./config.js";
import type { ReportRecord } from "./db.js";

export function reportLegacyDirectory(config: ReportDockConfig, id: string): string {
  return path.join(config.reportsDir, id);
}

export function reportVersionsDirectory(config: ReportDockConfig, id: string): string {
  return path.join(config.reportsDir, ".versions", id);
}

export function reportVersionDirectory(config: ReportDockConfig, id: string, version: number): string {
  return path.join(reportVersionsDirectory(config, id), String(version));
}

export function reportContentDirectory(config: ReportDockConfig, report: ReportRecord): string {
  if (report.version > 1) {
    return reportVersionDirectory(config, report.id, report.version);
  }

  return reportLegacyDirectory(config, report.id);
}
