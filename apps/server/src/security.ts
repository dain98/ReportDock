import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { ReportDockConfig } from "./config.js";

export const ADMIN_COOKIE_NAME = "reportdock_admin";

export const REPORT_CSP =
  "sandbox allow-scripts; default-src 'self' data: blob:; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'";

export function setNoStore(reply: FastifyReply): void {
  reply.header("Cache-Control", "no-store");
}

export function setReportSecurityHeaders(reply: FastifyReply): void {
  reply.header("Content-Security-Policy", REPORT_CSP);
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("Referrer-Policy", "no-referrer");
}

export function readBearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (!header) {
    return undefined;
  }

  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1];
}

export function isValidToken(actual: string | undefined, expected: string): boolean {
  if (!actual) {
    return false;
  }

  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  if (actualBytes.length !== expectedBytes.length) {
    return false;
  }

  return timingSafeEqual(actualBytes, expectedBytes);
}

export function requireBearerAuth(
  request: FastifyRequest,
  reply: FastifyReply,
  config: ReportDockConfig
): boolean {
  if (isValidToken(readBearerToken(request), config.adminToken)) {
    return true;
  }

  setNoStore(reply);
  reply.code(401).send({ error: "Unauthorized" });
  return false;
}

export function adminSessionValue(config: ReportDockConfig): string {
  return createHmac("sha256", config.adminToken).update("reportdock-admin-session-v1").digest("base64url");
}

export function hasAdminSession(request: FastifyRequest, config: ReportDockConfig): boolean {
  const cookie = request.cookies[ADMIN_COOKIE_NAME];
  return isValidToken(cookie, adminSessionValue(config));
}

export function setAdminCookie(reply: FastifyReply, config: ReportDockConfig): void {
  reply.setCookie(ADMIN_COOKIE_NAME, adminSessionValue(config), {
    httpOnly: true,
    sameSite: "strict",
    secure: config.secureCookies,
    path: "/admin",
    maxAge: 60 * 60 * 12
  });
}

export function clearAdminCookie(reply: FastifyReply, config: ReportDockConfig): void {
  reply.clearCookie(ADMIN_COOKIE_NAME, {
    httpOnly: true,
    sameSite: "strict",
    secure: config.secureCookies,
    path: "/admin"
  });
}
