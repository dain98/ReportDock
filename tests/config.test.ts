import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../apps/server/src/config.js";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("server config", () => {
  it("uses non-Secure cookies by default for HTTP base URLs", () => {
    process.env.REPORTDOCK_ADMIN_TOKEN = "token";
    process.env.REPORTDOCK_BASE_URL = "http://reportdock.local";
    delete process.env.REPORTDOCK_SECURE_COOKIES;

    expect(loadConfig().secureCookies).toBe(false);
  });

  it("uses Secure cookies by default for HTTPS base URLs", () => {
    process.env.REPORTDOCK_ADMIN_TOKEN = "token";
    process.env.REPORTDOCK_BASE_URL = "https://reportdock.example.com";
    delete process.env.REPORTDOCK_SECURE_COOKIES;

    expect(loadConfig().secureCookies).toBe(true);
  });

  it("allows REPORTDOCK_SECURE_COOKIES to override auto behavior", () => {
    process.env.REPORTDOCK_ADMIN_TOKEN = "token";
    process.env.REPORTDOCK_BASE_URL = "https://reportdock.example.com";
    process.env.REPORTDOCK_SECURE_COOKIES = "false";

    expect(loadConfig().secureCookies).toBe(false);

    process.env.REPORTDOCK_BASE_URL = "http://reportdock.local";
    process.env.REPORTDOCK_SECURE_COOKIES = "true";

    expect(loadConfig().secureCookies).toBe(true);
  });

  it("rejects invalid REPORTDOCK_SECURE_COOKIES values", () => {
    process.env.REPORTDOCK_ADMIN_TOKEN = "token";
    process.env.REPORTDOCK_SECURE_COOKIES = "sometimes";

    expect(() => loadConfig()).toThrow(/REPORTDOCK_SECURE_COOKIES/);
  });
});
