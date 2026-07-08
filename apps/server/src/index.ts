import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = await createApp({
  baseUrl: config.baseUrl,
  reportBaseUrl: config.reportBaseUrl,
  adminToken: config.adminToken,
  dataDir: config.dataDir,
  port: config.port,
  secureCookies: config.secureCookies,
  maxUploadBytes: config.maxUploadBytes,
  maxReportBytes: config.maxReportBytes,
  maxAssetCount: config.maxAssetCount,
  maxMetadataBytes: config.maxMetadataBytes,
  maxHtmlBytes: config.maxHtmlBytes,
  logger: true
});

await app.listen({ host: "0.0.0.0", port: config.port });
