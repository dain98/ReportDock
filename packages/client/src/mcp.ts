import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  publishReport,
  updateReport,
  type PublishedReport,
  type PublishReportOptions,
  type UpdateReportOptions
} from "./index.js";

type PublishReportFn = (options: PublishReportOptions) => Promise<PublishedReport>;
type UpdateReportFn = (options: UpdateReportOptions) => Promise<PublishedReport>;

export function createReportDockMcpServer(
  publishReportFn: PublishReportFn = publishReport,
  updateReportFn: UpdateReportFn = updateReport
): McpServer {
  const server = new McpServer(
    {
      name: "reportdock",
      version: "0.1.5"
    },
    {
      instructions:
        "Publish and update generated one-page HTML reports on a self-hosted ReportDock instance. Use publish_report for new local HTML files and update_report to replace an existing report at the same URL. Credentials come from REPORTDOCK_BASE_URL and REPORTDOCK_TOKEN or REPORTDOCK_ADMIN_TOKEN."
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
        createdAt: z.string(),
        updatedAt: z.string(),
        version: z.number()
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

        return {
          structuredContent: structuredReport(report),
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

  server.registerTool(
    "update_report",
    {
      title: "Update Report",
      description: "Update an existing ReportDock report with a new local HTML bundle while keeping its public URL stable.",
      inputSchema: {
        id: z.string().min(20).max(64).describe("ReportDock report ID to update."),
        entryFile: z.string().min(1).describe("Path to the local HTML entry file to publish as the latest version."),
        title: z.string().min(1).optional().describe("Optional report title override."),
        metadata: z.record(z.string(), z.unknown()).optional().describe("Optional metadata to replace the report metadata."),
        assetRoot: z.string().min(1).optional().describe("Optional root directory for resolving relative assets.")
      },
      outputSchema: {
        id: z.string(),
        url: z.string().url(),
        title: z.string().optional(),
        createdAt: z.string(),
        updatedAt: z.string(),
        version: z.number()
      },
      annotations: {
        title: "Update Report",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async ({ id, entryFile, title, metadata, assetRoot }) => {
      try {
        const report = await updateReportFn({
          id,
          entryFile,
          title,
          metadata,
          assetRoot
        });

        return {
          structuredContent: structuredReport(report),
          content: [
            {
              type: "text",
              text: `Updated report: ${report.url}`
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
              text: `ReportDock update failed: ${message}`
            }
          ]
        };
      }
    }
  );

  return server;
}

function structuredReport(report: PublishedReport): Record<string, unknown> {
  const structuredContent: Record<string, unknown> = {
    id: report.id,
    url: report.url,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
    version: report.version
  };
  if (report.title) {
    structuredContent.title = report.title;
  }

  return structuredContent;
}

export async function runMcpServer(): Promise<void> {
  const server = createReportDockMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
