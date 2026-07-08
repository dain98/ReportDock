import path from "node:path";

export interface ReportDockConfig {
  baseUrl: string;
  reportBaseUrl?: string;
  adminToken: string;
  dataDir: string;
  reportsDir: string;
  tmpDir: string;
  databasePath: string;
  port: number;
  secureCookies: boolean;
  maxUploadBytes: number;
  maxReportBytes: number;
  maxAssetCount: number;
  maxMetadataBytes: number;
  maxHtmlBytes: number;
}

export interface ConfigOverrides {
  baseUrl?: string;
  reportBaseUrl?: string;
  adminToken?: string;
  dataDir?: string;
  port?: number;
  secureCookies?: boolean;
  maxUploadBytes?: number;
  maxReportBytes?: number;
  maxAssetCount?: number;
  maxMetadataBytes?: number;
  maxHtmlBytes?: number;
}

export function loadConfig(overrides: ConfigOverrides = {}): ReportDockConfig {
  const dataDir = path.resolve(overrides.dataDir ?? process.env.REPORTDOCK_DATA_DIR ?? "./data");
  const adminToken = overrides.adminToken ?? process.env.REPORTDOCK_ADMIN_TOKEN;

  if (!adminToken) {
    throw new Error("REPORTDOCK_ADMIN_TOKEN is required.");
  }

  const baseUrl = overrides.baseUrl ?? process.env.REPORTDOCK_BASE_URL ?? "http://localhost:3000";
  const reportBaseUrl = overrides.reportBaseUrl ?? emptyToUndefined(process.env.REPORTDOCK_REPORT_BASE_URL);

  return {
    baseUrl,
    reportBaseUrl,
    adminToken,
    dataDir,
    reportsDir: path.join(dataDir, "reports"),
    tmpDir: path.join(dataDir, "tmp"),
    databasePath: path.join(dataDir, "reportdock.sqlite"),
    port: overrides.port ?? parseIntegerEnv("PORT", 3000),
    secureCookies: overrides.secureCookies ?? process.env.NODE_ENV === "production",
    maxUploadBytes: overrides.maxUploadBytes ?? parseIntegerEnv("REPORTDOCK_MAX_UPLOAD_BYTES", 104857600),
    maxReportBytes: overrides.maxReportBytes ?? parseIntegerEnv("REPORTDOCK_MAX_REPORT_BYTES", 104857600),
    maxAssetCount: overrides.maxAssetCount ?? parseIntegerEnv("REPORTDOCK_MAX_ASSET_COUNT", 1000),
    maxMetadataBytes: overrides.maxMetadataBytes ?? parseIntegerEnv("REPORTDOCK_MAX_METADATA_BYTES", 65536),
    maxHtmlBytes: overrides.maxHtmlBytes ?? parseIntegerEnv("REPORTDOCK_MAX_HTML_BYTES", 10485760)
  };
}

function parseIntegerEnv(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw) {
    return defaultValue;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
}

function emptyToUndefined(value: string | undefined): string | undefined {
  return value && value.trim() ? value : undefined;
}
