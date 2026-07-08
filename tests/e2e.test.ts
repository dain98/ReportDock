import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { publishReport, updateReport } from "../packages/client/src/index.js";
import { TEST_TOKEN, startTestServer, type TestServer } from "./helpers.js";

let server: TestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe("end-to-end publishing", () => {
  it("publishes the committed fixture report and renders referenced images", async () => {
    server = await startTestServer();
    const fixtureRoot = path.join(process.cwd(), "tests/fixtures/basic-report");

    const result = await publishReport({
      entryFile: path.join(fixtureRoot, "index.html"),
      assetRoot: fixtureRoot,
      baseUrl: server.baseUrl,
      token: TEST_TOKEN,
      metadata: { source: "fixture" }
    });

    expect(result.id).toMatch(/^[A-Za-z0-9_-]{20,64}$/);
    expect(result.url).toBe(`${server.baseUrl}/r/${result.id}/`);

    const html = await fetch(result.url);
    expect(html.status).toBe(200);
    expect(await html.text()).toContain("Fixture Report");

    const image = await fetch(`${result.url}screenshots/home.svg?cache=1`);
    expect(image.status).toBe(200);
    expect(await image.text()).toContain("<svg");
  });

  it("updates a published report through the client API", async () => {
    server = await startTestServer();
    const fixtureRoot = path.join(process.cwd(), "tests/fixtures/basic-report");
    const result = await publishReport({
      entryFile: path.join(fixtureRoot, "index.html"),
      assetRoot: fixtureRoot,
      baseUrl: server.baseUrl,
      token: TEST_TOKEN
    });

    const updateRoot = await mkdtemp(path.join(os.tmpdir(), "reportdock-update-"));
    await writeFile(path.join(updateRoot, "updated.html"), "<!doctype html><title>Updated</title><h1>Updated via client</h1>");

    const updated = await updateReport({
      id: result.id,
      entryFile: path.join(updateRoot, "updated.html"),
      baseUrl: server.baseUrl,
      token: TEST_TOKEN,
      metadata: { source: "client-update" }
    });

    expect(updated.id).toBe(result.id);
    expect(updated.url).toBe(result.url);
    expect(updated.version).toBe(2);

    const html = await fetch(result.url);
    expect(html.status).toBe(200);
    expect(await html.text()).toContain("Updated via client");
  });

  it.skipIf(
    !existsSync("/home/dain/saiq-backend/testing/ui-test-plans/pr-674-688-crm-ui-test-tracker.html")
  )("can publish the local SAIQ acceptance report when it exists", async () => {
    const localReport = "/home/dain/saiq-backend/testing/ui-test-plans/pr-674-688-crm-ui-test-tracker.html";
    const localRoot = "/home/dain/saiq-backend/testing/ui-test-plans";

    server = await startTestServer({ maxReportBytes: 50 * 1024 * 1024, maxUploadBytes: 50 * 1024 * 1024 });
    const result = await publishReport({
      entryFile: localReport,
      assetRoot: localRoot,
      baseUrl: server.baseUrl,
      token: TEST_TOKEN,
      metadata: { source: "local-saiq-acceptance" }
    });

    const html = await fetch(result.url);
    expect(html.status).toBe(200);
    expect(await html.text()).toContain("SAIQ CRM Develop UI Test Tracker");
  });
});
