import { readdir } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TEST_TOKEN, makeReportForm, postReport, startTestServer, type TestServer } from "./helpers.js";

let server: TestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe("server API and public report behavior", () => {
  it("rejects unauthenticated publishes before parsing uploads", async () => {
    server = await startTestServer();
    const response = await postReport(server.baseUrl, "wrong-token", await makeReportForm("<h1>Nope</h1>"));

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("publishes a valid report and serves HTML with sandbox headers and assets with immutable caching", async () => {
    server = await startTestServer();
    const form = await makeReportForm(`<title>OK</title><img src="screenshots/a.svg">`, [
      { path: "screenshots/a.svg", field: "asset_0", bytes: "<svg></svg>" }
    ]);

    const publish = await postReport(server.baseUrl, TEST_TOKEN, form);
    expect(publish.status).toBe(201);
    const body = (await publish.json()) as { id: string; url: string };
    expect(body.id).toMatch(/^[A-Za-z0-9_-]{20,64}$/);
    expect(body.url).toBe(`${server.baseUrl}/r/${body.id}/`);

    const html = await fetch(body.url);
    expect(html.status).toBe(200);
    expect(html.headers.get("content-security-policy")).toContain("sandbox allow-scripts");
    expect(html.headers.get("content-security-policy")).not.toContain("allow-same-origin");
    expect(html.headers.get("cache-control")).toBe("no-store");
    expect(html.headers.get("access-control-allow-origin")).toBeNull();

    const asset = await fetch(`${body.url}screenshots/a.svg`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });

  it("rejects invalid IDs and traversal attempts", async () => {
    server = await startTestServer();

    const api = await fetch(new URL("/api/reports/bad", server.baseUrl), {
      headers: { Authorization: `Bearer ${TEST_TOKEN}` }
    });
    expect(api.status).toBe(400);

    const publicRoute = await fetch(new URL("/r/bad/", server.baseUrl));
    expect(publicRoute.status).toBe(404);
  });

  it("rejects manifest/file mismatches and cleans staging directories", async () => {
    server = await startTestServer();
    const form = await makeReportForm(`<img src="screenshots/a.svg">`, [
      { path: "screenshots/a.svg", field: "asset_0", bytes: "<svg></svg>" }
    ]);
    form.append("asset_99", new Blob(["unexpected"]), "unexpected.txt");

    const response = await postReport(server.baseUrl, TEST_TOKEN, form);

    expect(response.status).toBe(400);
    await expectDirectoryEmpty(path.join(server.dataDir, "tmp"));
    await expectDirectoryEmpty(path.join(server.dataDir, "reports"));
  });

  it("rejects missing manifest assets", async () => {
    server = await startTestServer();
    const form = await makeReportForm(`<img src="screenshots/a.svg">`, [], {
      assets: [
        {
          path: "screenshots/a.svg",
          field: "asset_0",
          size: 11,
          sha256: "a".repeat(64)
        }
      ]
    });

    const response = await postReport(server.baseUrl, TEST_TOKEN, form);

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("missing uploaded file");
  });

  it("rejects oversize HTML", async () => {
    server = await startTestServer({ maxHtmlBytes: 5, maxUploadBytes: 1000 });
    const response = await postReport(server.baseUrl, TEST_TOKEN, await makeReportForm("<h1>too long</h1>"));

    expect(response.status).toBe(413);
  });

  it("hard-deletes reports idempotently and returns 404 publicly after deletion", async () => {
    server = await startTestServer();
    const publish = await postReport(server.baseUrl, TEST_TOKEN, await makeReportForm("<h1>Delete me</h1>"));
    const body = (await publish.json()) as { id: string; url: string };

    for (let index = 0; index < 2; index += 1) {
      const deleted = await fetch(new URL(`/api/reports/${body.id}`, server.baseUrl), {
        method: "DELETE",
        headers: { Authorization: `Bearer ${TEST_TOKEN}` }
      });
      expect(deleted.status).toBe(200);
    }

    expect((await fetch(body.url)).status).toBe(404);
  });

  it("uses REPORTDOCK_REPORT_BASE_URL in returned public URLs", async () => {
    server = await startTestServer({ reportBaseUrl: "https://reports.example.com" });
    const publish = await postReport(server.baseUrl, TEST_TOKEN, await makeReportForm("<h1>Report origin</h1>"));
    const body = (await publish.json()) as { id: string; url: string };

    expect(body.url).toBe(`https://reports.example.com/r/${body.id}/`);
  });
});

async function expectDirectoryEmpty(directory: string): Promise<void> {
  const entries = await readdir(directory).catch(() => []);
  expect(entries).toEqual([]);
}
