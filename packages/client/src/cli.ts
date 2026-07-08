import { spawn } from "node:child_process";
import { Command } from "commander";
import { publishReport } from "./index.js";

interface PublishCommandOptions {
  baseUrl?: string;
  token?: string;
  title?: string;
  metadata?: string[];
  assetRoot?: string;
  json?: boolean;
  open?: boolean;
}

const program = new Command();

program
  .name("reportdock")
  .description("Publish one-page HTML reports to a self-hosted ReportDock server.")
  .version("0.1.3");

program
  .command("publish")
  .argument("<entry-html>", "HTML entry file to publish")
  .option("--base-url <url>", "ReportDock server URL")
  .option("--token <token>", "ReportDock API token")
  .option("--title <title>", "Report title")
  .option("--metadata <key=value>", "Metadata entry", collectMetadata, [])
  .option("--asset-root <dir>", "Root directory for relative assets")
  .option("--json", "Print machine-readable JSON")
  .option("--open", "Open the published report in the default browser")
  .action(async (entryFile: string, options: PublishCommandOptions) => {
    try {
      const result = await publishReport({
        entryFile,
        baseUrl: options.baseUrl,
        token: options.token,
        title: options.title,
        metadata: parseMetadata(options.metadata ?? []),
        assetRoot: options.assetRoot
      });

      if (options.json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      } else {
        process.stdout.write(`Published: ${result.url}\n`);
      }

      if (options.open) {
        openUrl(result.url);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`reportdock: ${message}\n`);
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);

function collectMetadata(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

function parseMetadata(entries: string[]): Record<string, string> {
  const metadata: Record<string, string> = {};

  for (const entry of entries) {
    const equalsIndex = entry.indexOf("=");
    if (equalsIndex <= 0) {
      throw new Error(`Metadata must be in key=value format: ${entry}`);
    }

    metadata[entry.slice(0, equalsIndex)] = entry.slice(equalsIndex + 1);
  }

  return metadata;
}

function openUrl(url: string): void {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
}
