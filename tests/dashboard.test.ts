import { afterEach, describe, expect, it } from "vitest";
import { TEST_TOKEN, startTestServer, type TestServer } from "./helpers.js";

let server: TestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe("admin dashboard authentication", () => {
  it("redirects the root URL to the dashboard", async () => {
    server = await startTestServer();
    const response = await fetch(new URL("/", server.baseUrl), { redirect: "manual" });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/admin");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("does not accept tokens in URLs", async () => {
    server = await startTestServer();
    const response = await fetch(new URL(`/admin?token=${encodeURIComponent(TEST_TOKEN)}`, server.baseUrl));

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Admin token");
  });

  it("does not reveal the expected token on failed login", async () => {
    server = await startTestServer();
    const response = await fetch(new URL("/admin/login", server.baseUrl), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: "wrong" })
    });

    const body = await response.text();
    expect(response.status).toBe(401);
    expect(body).not.toContain(TEST_TOKEN);
  });

  it("sets HttpOnly, SameSite, and Secure cookie attributes in production mode", async () => {
    server = await startTestServer({ secureCookies: true });
    const response = await fetch(new URL("/admin/login", server.baseUrl), {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: TEST_TOKEN })
    });

    const cookie = response.headers.get("set-cookie") ?? "";
    expect(response.status).toBe(303);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Secure");
  });
});
