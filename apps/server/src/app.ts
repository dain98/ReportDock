import { createReadStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import cookie from "@fastify/cookie";
import formBody from "@fastify/formbody";
import multipart from "@fastify/multipart";
import fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { lookup as lookupMime } from "mime-types";
import { type ConfigOverrides, loadConfig, type ReportDockConfig } from "./config.js";
import { ReportDatabase, type ReportRecord } from "./db.js";
import { normalizeReportPath, safeDecodePath, safeResolve, validateReportId } from "./path-validation.js";
import {
  clearAdminCookie,
  hasAdminSession,
  isValidToken,
  readBearerToken,
  requireBearerAuth,
  setAdminCookie,
  setNoStore,
  setReportSecurityHeaders
} from "./security.js";
import { reportContentDirectory, reportLegacyDirectory, reportVersionsDirectory } from "./storage.js";
import { processReportUpdate, processReportUpload, UploadError } from "./upload.js";

interface AppOptions extends ConfigOverrides {
  logger?: boolean;
}

export async function createApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const config = loadConfig(options);
  await mkdir(config.reportsDir, { recursive: true });
  await mkdir(config.tmpDir, { recursive: true });
  const db = await ReportDatabase.open(config);

  const app = fastify({
    logger: options.logger ?? false,
    bodyLimit: config.maxUploadBytes + config.maxMetadataBytes
  });

  await app.register(cookie);
  await app.register(formBody);
  await app.register(multipart, {
    limits: {
      fileSize: config.maxUploadBytes,
      files: config.maxAssetCount + 2,
      fields: 2,
      parts: config.maxAssetCount + 4
    }
  });

  app.addHook("onClose", () => {
    db.close();
  });

  app.get("/healthz", async (_request, reply) => {
    setNoStore(reply);
    return { ok: true };
  });

  app.get("/", async (_request, reply) => {
    setNoStore(reply);
    reply.redirect("/admin", 302);
    return reply;
  });

  registerApiRoutes(app, config, db);
  registerPublicReportRoutes(app, config, db);
  registerAdminRoutes(app, config, db);

  app.setNotFoundHandler((_request, reply) => {
    setNoStore(reply);
    reply.code(404).send({ error: "Not found" });
  });

  app.setErrorHandler((error, _request, reply) => {
    setNoStore(reply);
    if (error instanceof UploadError) {
      reply.code(error.statusCode).send({ error: error.message });
      return;
    }

    if (error instanceof Error && error.message === "Invalid pagination cursor.") {
      reply.code(400).send({ error: error.message });
      return;
    }

    reply.code(500).send({ error: "Internal server error" });
  });

  return app;
}

function registerApiRoutes(app: FastifyInstance, config: ReportDockConfig, db: ReportDatabase): void {
  app.post("/api/reports", async (request, reply) => {
    setNoStore(reply);
    if (!requireBearerAuth(request, reply, config)) {
      return reply;
    }

    const uploaded = await processReportUpload(request, config, db);
    const response = publicReportResponse(uploaded.report, config);
    reply.code(201).send(response);
    return reply;
  });

  app.put("/api/reports/:id", async (request, reply) => {
    setNoStore(reply);
    if (!requireBearerAuth(request, reply, config)) {
      return reply;
    }

    const id = getValidatedId(request, reply);
    if (!id) {
      return reply;
    }

    const uploaded = await processReportUpdate(request, id, config, db);
    return detailedReportResponse(uploaded.report, config);
  });

  app.get("/api/reports", async (request, reply) => {
    setNoStore(reply);
    if (!requireBearerAuth(request, reply, config)) {
      return reply;
    }

    const query = request.query as { limit?: string; cursor?: string };
    const limit = query.limit ? Number.parseInt(query.limit, 10) : 50;
    const page = db.listReports(Number.isFinite(limit) ? limit : 50, query.cursor);
    return {
      reports: page.reports.map((report) => detailedReportResponse(report, config)),
      nextCursor: page.nextCursor
    };
  });

  app.get("/api/reports/:id", async (request, reply) => {
    setNoStore(reply);
    if (!requireBearerAuth(request, reply, config)) {
      return reply;
    }

    const id = getValidatedId(request, reply);
    if (!id) {
      return reply;
    }

    const report = db.getReport(id);
    if (!report) {
      reply.code(404).send({ error: "Report not found" });
      return reply;
    }

    return detailedReportResponse(report, config);
  });

  app.delete("/api/reports/:id", async (request, reply) => {
    setNoStore(reply);
    if (!requireBearerAuth(request, reply, config)) {
      return reply;
    }

    const id = getValidatedId(request, reply);
    if (!id) {
      return reply;
    }

    await deleteReport(id, config, db);
    return { ok: true };
  });
}

function registerPublicReportRoutes(
  app: FastifyInstance,
  config: ReportDockConfig,
  db: ReportDatabase
): void {
  app.get("/r/:id", async (request, reply) => {
    const id = getValidatedId(request, reply, true);
    if (!id) {
      return reply;
    }
    reply.redirect(`/r/${id}/`, 302);
    return reply;
  });

  app.get("/r/:id/", async (request, reply) => {
    const id = getValidatedId(request, reply, true);
    if (!id) {
      return reply;
    }

    return sendReportFile(id, "index.html", true, reply, config, db);
  });

  app.get("/r/:id/*", async (request, reply) => {
    const id = getValidatedId(request, reply, true);
    if (!id) {
      return reply;
    }

    const params = request.params as { "*": string };
    const decodedPath = safeDecodePath(params["*"] ?? "");
    const reportPath = normalizeReportPath(decodedPath);
    return sendReportFile(id, reportPath, reportPath === "index.html", reply, config, db);
  });
}

function registerAdminRoutes(app: FastifyInstance, config: ReportDockConfig, db: ReportDatabase): void {
  app.get("/admin", async (request, reply) => {
    setNoStore(reply);
    reply.type("text/html; charset=utf-8");
    if (!hasAdminSession(request, config)) {
      return renderLoginPage();
    }

    const page = db.listReports(50);
    return renderAdminPage(page.reports, config);
  });

  app.post("/admin/login", async (request, reply) => {
    setNoStore(reply);
    const body = request.body as { token?: string } | undefined;
    if (!isValidToken(body?.token, config.adminToken)) {
      reply.code(401).type("text/html; charset=utf-8").send(renderLoginPage("Invalid token."));
      return reply;
    }

    setAdminCookie(reply, config);
    reply.redirect("/admin", 303);
    return reply;
  });

  app.post("/admin/logout", async (_request, reply) => {
    setNoStore(reply);
    clearAdminCookie(reply, config);
    reply.redirect("/admin", 303);
    return reply;
  });

  app.post("/admin/reports/:id/delete", async (request, reply) => {
    setNoStore(reply);
    if (!hasAdminSession(request, config)) {
      reply.code(401).type("text/html; charset=utf-8").send(renderLoginPage());
      return reply;
    }

    const id = getValidatedId(request, reply);
    if (!id) {
      return reply;
    }

    await deleteReport(id, config, db);
    reply.redirect("/admin", 303);
    return reply;
  });
}

async function sendReportFile(
  id: string,
  reportPath: string,
  isHtml: boolean,
  reply: FastifyReply,
  config: ReportDockConfig,
  db: ReportDatabase
): Promise<FastifyReply> {
  const report = db.getActiveReport(id);
  if (!report) {
    setNoStore(reply);
    reply.code(404).send({ error: "Report not found" });
    return reply;
  }

  const root = reportContentDirectory(config, report);
  const filePath = safeResolve(root, reportPath);
  const info = await stat(filePath).catch(() => undefined);
  if (!info?.isFile()) {
    setNoStore(reply);
    reply.code(404).send({ error: "Report asset not found" });
    return reply;
  }

  setReportSecurityHeaders(reply);
  if (isHtml) {
    reply.header("Cache-Control", "no-store");
    reply.type("text/html; charset=utf-8");
  } else {
    reply.header("Cache-Control", "public, max-age=31536000, immutable");
    reply.type(lookupMime(filePath) || "application/octet-stream");
  }

  return reply.send(createReadStream(filePath));
}

async function deleteReport(id: string, config: ReportDockConfig, db: ReportDatabase): Promise<void> {
  db.markDeleted(id, new Date().toISOString());
  await Promise.all([
    rm(reportLegacyDirectory(config, id), { recursive: true, force: true }),
    rm(reportVersionsDirectory(config, id), { recursive: true, force: true })
  ]);
}

function getValidatedId(
  request: FastifyRequest,
  reply: FastifyReply,
  notFoundOnInvalid = false
): string | undefined {
  const params = request.params as { id?: string };
  try {
    return validateReportId(params.id ?? "");
  } catch {
    setNoStore(reply);
    reply.code(notFoundOnInvalid ? 404 : 400).send({ error: notFoundOnInvalid ? "Not found" : "Invalid report ID" });
    return undefined;
  }
}

function publicReportResponse(report: ReportRecord, config: ReportDockConfig): {
  id: string;
  url: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
} {
  return {
    id: report.id,
    url: buildReportUrl(report.id, config),
    title: report.title,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
    version: report.version
  };
}

function detailedReportResponse(report: ReportRecord, config: ReportDockConfig): Record<string, unknown> {
  return {
    ...publicReportResponse(report, config),
    deletedAt: report.deletedAt,
    sizeBytes: report.sizeBytes,
    assetCount: report.assetCount,
    metadata: report.metadata,
    entryPath: report.entryPath
  };
}

function buildReportUrl(id: string, config: ReportDockConfig): string {
  const base = config.reportBaseUrl ?? config.baseUrl;
  return new URL(`/r/${id}/`, base.endsWith("/") ? base : `${base}/`).toString();
}

function renderLoginPage(error?: string): string {
  return htmlDocument(
    "ReportDock Admin",
    `
      <main class="login">
        <section class="login-panel">
          <h1>ReportDock</h1>
          ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
          <form method="post" action="/admin/login">
            <label>
              Admin token
              <input name="token" type="password" autocomplete="current-password" required>
            </label>
            <button type="submit">Log in</button>
          </form>
        </section>
      </main>
    `
  );
}

function renderAdminPage(reports: ReportRecord[], config: ReportDockConfig): string {
  const rows = reports
    .map((report) => {
      const url = buildReportUrl(report.id, config);
      return `
        <tr>
          <td><a href="${escapeHtml(url)}">${escapeHtml(report.title ?? report.id)}</a></td>
          <td><code>${escapeHtml(report.id)}</code></td>
          <td>${escapeHtml(report.createdAt)}</td>
          <td>${report.assetCount}</td>
          <td>${formatBytes(report.sizeBytes)}</td>
          <td><input readonly value="${escapeHtml(url)}"></td>
          <td>
            <form method="post" action="/admin/reports/${escapeHtml(report.id)}/delete">
              <button type="submit">Delete</button>
            </form>
          </td>
        </tr>
      `;
    })
    .join("");

  return htmlDocument(
    "ReportDock Admin",
    `
      <main>
        <header>
          <h1>ReportDock</h1>
          <form method="post" action="/admin/logout"><button type="submit">Log out</button></form>
        </header>
        <table>
          <thead>
            <tr>
              <th>Report</th>
              <th>ID</th>
              <th>Created</th>
              <th>Assets</th>
              <th>Size</th>
              <th>URL</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${rows || `<tr><td colspan="7" class="empty">No reports published yet.</td></tr>`}
          </tbody>
        </table>
      </main>
    `
  );
}

function htmlDocument(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
    body { margin: 0; background: #f6f8fa; color: #182230; }
    main { width: min(1120px, calc(100% - 32px)); margin: 32px auto; }
    header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
    h1 { margin: 0; font-size: 24px; line-height: 1.2; }
    table { width: 100%; border-collapse: collapse; background: white; border: 1px solid #d9e2ec; }
    th, td { padding: 10px 12px; border-bottom: 1px solid #e6edf3; text-align: left; vertical-align: middle; }
    th { font-size: 12px; text-transform: uppercase; color: #52606d; background: #f8fafc; }
    input { width: min(360px, 100%); padding: 7px 8px; border: 1px solid #bcccdc; border-radius: 4px; font: inherit; }
    button { padding: 7px 10px; border: 1px solid #9fb3c8; border-radius: 4px; background: #fff; color: #182230; font: inherit; cursor: pointer; }
    a { color: #0b5cad; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
    .login { max-width: 392px; }
    .login-panel { display: grid; gap: 18px; padding: 20px; background: white; border: 1px solid #d9e2ec; }
    .login form { display: grid; gap: 12px; }
    .login label { display: grid; gap: 6px; }
    .error { color: #b42318; }
    .empty { color: #52606d; text-align: center; padding: 28px; }
    @media (prefers-color-scheme: dark) {
      body { background: #0b1018; color: #eef4ff; }
      table, .login-panel { background: #121a26; border-color: #263448; }
      th, td { border-color: #263448; }
      th { color: #a7b3c5; background: #162131; }
      input, button { background: #0b1018; color: #eef4ff; border-color: #364a63; }
      a { color: #8ab4ff; }
    }
  </style>
</head>
<body>
${body}
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
