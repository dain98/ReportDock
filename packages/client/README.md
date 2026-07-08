# reportdock

CLI and JS client for publishing one-page HTML reports to a self-hosted ReportDock server.

```sh
npm install -g reportdock
reportdock publish ./report.html --base-url https://reportdock.example.com --token "$REPORTDOCK_TOKEN"
reportdock update <report-id> ./updated-report.html --base-url https://reportdock.example.com --token "$REPORTDOCK_TOKEN"
```

The client discovers referenced local assets from the HTML, uploads a multipart report bundle, and prints the stable hosted URL.

## MCP

Run ReportDock as a local stdio MCP server:

```sh
reportdock mcp
```

Claude Code:

```sh
claude mcp add --scope user reportdock \
  --env REPORTDOCK_BASE_URL=https://reportdock.example.com \
  --env REPORTDOCK_TOKEN=your-token \
  -- npx -y reportdock@latest mcp
```

Codex:

```sh
codex mcp add reportdock \
  --env REPORTDOCK_BASE_URL=https://reportdock.example.com \
  --env REPORTDOCK_TOKEN=your-token \
  -- npx -y reportdock@latest mcp
```

The MCP server exposes:

```txt
publish_report(entryFile, title?, metadata?, assetRoot?)
update_report(id, entryFile, title?, metadata?, assetRoot?)
```

```ts
import { publishReport, updateReport } from "reportdock";

const result = await publishReport({
  entryFile: "./report.html",
  baseUrl: process.env.REPORTDOCK_BASE_URL,
  token: process.env.REPORTDOCK_TOKEN
});

console.log(result.url);

await updateReport({
  id: result.id,
  entryFile: "./updated-report.html",
  baseUrl: process.env.REPORTDOCK_BASE_URL,
  token: process.env.REPORTDOCK_TOKEN
});
```
