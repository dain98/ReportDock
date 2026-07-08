import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bundleReport, discoverAssetsFromHtml, normalizeReportPath } from "../packages/client/src/index.js";

describe("client asset discovery", () => {
  it("discovers supported local references and ignores external URLs", () => {
    const html = `
      <link rel="stylesheet" href="assets/report.css">
      <link rel="icon" href="./assets/favicon.svg">
      <img src="screenshots/home.svg?cache=1">
      <img srcset="screenshots/detail.svg 1x, screenshots/detail@2x.svg 2x">
      <video poster="screenshots/poster.svg"></video>
      <img src="assets/with%20space.txt">
      <a href="https://example.com/report.css"></a>
      <img src="data:image/png;base64,abc">
      <a href="mailto:test@example.com"></a>
      <a href="tel:+15555555555"></a>
      <script src="//cdn.example.com/chart.js"></script>
    `;

    expect(discoverAssetsFromHtml(html)).toEqual([
      "assets/favicon.svg",
      "assets/report.css",
      "assets/with space.txt",
      "screenshots/detail.svg",
      "screenshots/detail@2x.svg",
      "screenshots/home.svg",
      "screenshots/poster.svg"
    ]);
  });

  it("deduplicates equivalent normalized paths", () => {
    expect(discoverAssetsFromHtml(`<img src="./foo.png"><img src="foo.png">`)).toEqual(["foo.png"]);
  });

  it("rejects unsafe local references", () => {
    expect(() => discoverAssetsFromHtml(`<img src="../secret.txt">`)).toThrow(/traverse/i);
    expect(() => normalizeReportPath("C:\\secret.txt")).toThrow(/POSIX/);
  });

  it("fails clearly when a referenced asset is outside the asset root", async () => {
    const root = await makeTempDir();
    const entryFile = path.join(root, "report.html");
    await writeFile(entryFile, `<img src="missing.png">`);

    await expect(bundleReport({ entryFile, assetRoot: root })).rejects.toThrow(/does not exist/);
  });

  it("bundles a report with title, sha256, sizes, and stable asset fields", async () => {
    const root = await makeTempDir();
    await mkdir(path.join(root, "assets"), { recursive: true });
    await writeFile(path.join(root, "index.html"), `<!doctype html><title>Bundled</title><img src="assets/a.txt">`);
    await writeFile(path.join(root, "assets/a.txt"), "hello");

    const bundle = await bundleReport({ entryFile: path.join(root, "index.html") });

    expect(bundle.title).toBe("Bundled");
    expect(bundle.assets).toMatchObject([
      {
        path: "assets/a.txt",
        field: "asset_0",
        size: 5
      }
    ]);
    expect(bundle.assets[0]?.sha256).toHaveLength(64);
  });
});

async function makeTempDir(): Promise<string> {
  return await import("node:fs/promises").then((fs) => fs.mkdtemp(path.join(os.tmpdir(), "reportdock-client-")));
}
