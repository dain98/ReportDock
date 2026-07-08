import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, it } from "vitest";
import { TEST_TOKEN, startTestServer, type TestServer } from "./helpers.js";

let reportdockServer: TestServer | undefined;
let mcpClient: Client | undefined;

afterEach(async () => {
  await mcpClient?.close();
  mcpClient = undefined;
  await reportdockServer?.close();
  reportdockServer = undefined;
});

describe("ReportDock MCP server", () => {
  it("exposes publish_report with a clear description", async () => {
    mcpClient = await startMcpClient();

    const tools = await mcpClient.listTools();

    expect(tools.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "publish_report",
          description: expect.stringContaining("Publish")
        }),
        expect.objectContaining({
          name: "update_report",
          description: expect.stringContaining("Update")
        })
      ])
    );
  });

  it("publishes a local HTML report through publish_report", async () => {
    reportdockServer = await startTestServer();
    const root = await makeTempDir();
    await mkdir(path.join(root, "assets"), { recursive: true });
    await writeFile(path.join(root, "report.html"), "<!doctype html><title>MCP Report</title><img src=\"assets/a.txt\">");
    await writeFile(path.join(root, "assets/a.txt"), "hello from mcp");

    mcpClient = await startMcpClient({
      REPORTDOCK_BASE_URL: reportdockServer.baseUrl,
      REPORTDOCK_TOKEN: TEST_TOKEN
    });

    const result = await mcpClient.callTool({
      name: "publish_report",
      arguments: {
        entryFile: path.join(root, "report.html"),
        metadata: {
          source: "mcp-test"
        }
      }
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      title: "MCP Report",
      url: expect.stringMatching(new RegExp(`^${escapeRegExp(reportdockServer.baseUrl)}/r/[A-Za-z0-9_-]+/$`))
    });

    const content = result.content as Array<{ type: string; text?: string }>;
    const text = content[0]?.type === "text" ? (content[0].text ?? "") : "";
    expect(text).toContain("Published report:");
    expect(text).toContain((result.structuredContent as { url: string }).url);
  });

  it("updates a local HTML report through update_report", async () => {
    reportdockServer = await startTestServer();
    const root = await makeTempDir();
    await writeFile(path.join(root, "first.html"), "<!doctype html><title>First MCP</title><h1>First MCP</h1>");
    await writeFile(path.join(root, "second.html"), "<!doctype html><title>Second MCP</title><h1>Second MCP</h1>");

    mcpClient = await startMcpClient({
      REPORTDOCK_BASE_URL: reportdockServer.baseUrl,
      REPORTDOCK_TOKEN: TEST_TOKEN
    });

    const published = await mcpClient.callTool({
      name: "publish_report",
      arguments: {
        entryFile: path.join(root, "first.html")
      }
    });
    const publishedContent = published.structuredContent as { id: string; url: string };

    const updated = await mcpClient.callTool({
      name: "update_report",
      arguments: {
        id: publishedContent.id,
        entryFile: path.join(root, "second.html")
      }
    });

    expect(updated.isError).not.toBe(true);
    expect(updated.structuredContent).toMatchObject({
      id: publishedContent.id,
      url: publishedContent.url,
      version: 2
    });

    const html = await fetch(publishedContent.url);
    expect(await html.text()).toContain("Second MCP");
  });
});

async function startMcpClient(env: Record<string, string> = {}): Promise<Client> {
  const client = new Client({ name: "reportdock-test-client", version: "0.0.0" });
  const transport = new StdioClientTransport({
    command: path.join(process.cwd(), "node_modules/.bin/tsx"),
    args: [path.join(process.cwd(), "packages/client/src/cli.ts"), "mcp"],
    env: {
      ...process.env,
      ...env
    } as Record<string, string>,
    stderr: "pipe"
  });
  await client.connect(transport);
  return client;
}

async function makeTempDir(): Promise<string> {
  return await import("node:fs/promises").then((fs) => fs.mkdtemp(path.join(os.tmpdir(), "reportdock-mcp-")));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
