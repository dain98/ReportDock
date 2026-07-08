import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { publishReport, type PublishedReport, type PublishReportOptions } from "./index.js";

type PublishReportFn = (options: PublishReportOptions) => Promise<PublishedReport>;

export function createReportDockMcpServer(publishReportFn: PublishReportFn = publishReport): McpServer {
  const server = new McpServer(
    {
      name: "reportdock",
      version: "0.1.4"
    },
    {
      instructions:
        "Publish generated one-page HTML reports to a self-hosted ReportDock instance. Use publish_report for local HTML files; credentials come from REPORTDOCK_BASE_URL and REPORTDOCK_TOKEN or REPORTDOCK_ADMIN_TOKEN."
    }
  );

  server.registerTool(
    "publish_report",
    {
      title: "Publish Report",
      description: "Publish a local one-page HTML report to ReportDock and return its immutable public URL.",
      inputSchema: {
        entryFile: z.string().min(1).describe("Path to the local HTML entry file to publish."),
        title: z.string().min(1).optional().describe("Optional report title override."),
        metadata: z.record(z.string(), z.unknown()).optional().describe("Optional metadata to store with the report."),
        assetRoot: z.string().min(1).optional().describe("Optional root directory for resolving relative assets.")
      },
      outputSchema: {
        id: z.string(),
        url: z.string().url(),
        title: z.string().optional(),
        createdAt: z.string()
      },
      annotations: {
        title: "Publish Report",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async ({ entryFile, title, metadata, assetRoot }) => {
      try {
        const report = await publishReportFn({
          entryFile,
          title,
          metadata,
          assetRoot
        });
        const structuredContent: Record<string, unknown> = {
          id: report.id,
          url: report.url,
          createdAt: report.createdAt
        };
        if (report.title) {
          structuredContent.title = report.title;
        }

        return {
          structuredContent,
          content: [
            {
              type: "text",
              text: `Published report: ${report.url}`
            }
          ]
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `ReportDock publish failed: ${message}`
            }
          ]
        };
      }
    }
  );

  return server;
}

export async function runMcpServer(): Promise<void> {
  const server = createReportDockMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
