![ReportDock](docs/assets/reportdock-banner.png)

ReportDock is a self-hosted service for publishing one-page HTML reports from agents, tests, and CI jobs. A client uploads an HTML entry file plus referenced local assets, and the server returns a stable public-unlisted URL that can be updated in place.

## Quick Start

Create a `docker-compose.yml` file:

```yaml
services:
  reportdock:
    image: ghcr.io/dain98/reportdock:v0.1.5
    ports:
      - "3000:3000"
    environment:
      REPORTDOCK_BASE_URL: "http://localhost:3000"
      REPORTDOCK_REPORT_BASE_URL: ""
      REPORTDOCK_SECURE_COOKIES: "auto"
      REPORTDOCK_ADMIN_TOKEN: "${REPORTDOCK_ADMIN_TOKEN}"
      REPORTDOCK_DATA_DIR: "/data"
    volumes:
      - reportdock_data:/data
    restart: unless-stopped

volumes:
  reportdock_data:
```

Create an `.env` file beside it:

```txt
REPORTDOCK_ADMIN_TOKEN=replace-with-a-long-random-token
```

Start ReportDock:

```sh
docker compose up -d
```

The server listens on `http://localhost:3000` by default. Opening that URL redirects to the admin dashboard at `/admin`.

## Docker Images

Published images are available at:

```txt
ghcr.io/dain98/reportdock
```

Tags:

```txt
latest       Published from main
vX.Y.Z       Published from matching release tags
X.Y.Z        Semver alias for release tags
X.Y          Major/minor alias for release tags
sha-<short>  Published for every workflow run
```

The GitHub Actions workflow builds and pushes multi-architecture images for `linux/amd64` and `linux/arm64`. To publish a release image, push a tag such as `v0.1.5`.

Important environment variables:

```txt
REPORTDOCK_BASE_URL=http://localhost:3000
REPORTDOCK_REPORT_BASE_URL=
REPORTDOCK_SECURE_COOKIES=auto
REPORTDOCK_ADMIN_TOKEN=replace-with-a-long-random-token
REPORTDOCK_DATA_DIR=/data
PORT=3000
REPORTDOCK_MAX_UPLOAD_BYTES=104857600
REPORTDOCK_MAX_REPORT_BYTES=104857600
REPORTDOCK_MAX_ASSET_COUNT=1000
REPORTDOCK_MAX_METADATA_BYTES=65536
REPORTDOCK_MAX_HTML_BYTES=10485760
```

`REPORTDOCK_REPORT_BASE_URL` is optional. Set it when public reports are served from a separate origin, such as `https://reports.example.com`, while admin/API traffic remains on `REPORTDOCK_BASE_URL`.

`REPORTDOCK_SECURE_COOKIES=auto` sets Secure dashboard cookies only when `REPORTDOCK_BASE_URL` starts with `https://`. Use `true` to always require HTTPS cookies or `false` for plain HTTP-only deployments.

## Publishing Reports

The `reportdock` package exposes both a CLI and a JS API.

```sh
npm install -g reportdock
reportdock publish ./report.html \
  --base-url https://reportdock.example.com \
  --token "$REPORTDOCK_TOKEN"

reportdock update <report-id> ./updated-report.html \
  --base-url https://reportdock.example.com \
  --token "$REPORTDOCK_TOKEN"
```

Flags override environment variables:

```txt
--base-url or REPORTDOCK_BASE_URL
--token or REPORTDOCK_TOKEN or REPORTDOCK_ADMIN_TOKEN
```

Useful options:

```txt
--title <title>
--metadata key=value
--asset-root <dir>
--json
--open
```

## MCP Server

The `reportdock` package also includes a local stdio MCP server for agents. It exposes `publish_report` and `update_report` tools that upload local HTML reports through the same ReportDock API as the CLI.

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

Codex `~/.codex/config.toml`:

```toml
[mcp_servers.reportdock]
command = "npx"
args = ["-y", "reportdock@latest", "mcp"]
env_vars = ["REPORTDOCK_BASE_URL", "REPORTDOCK_TOKEN"]
```

For committed Claude Code project config, keep secrets in environment variables:

```json
{
  "mcpServers": {
    "reportdock": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "reportdock@latest", "mcp"],
      "env": {
        "REPORTDOCK_BASE_URL": "${REPORTDOCK_BASE_URL}",
        "REPORTDOCK_TOKEN": "${REPORTDOCK_TOKEN}"
      }
    }
  }
}
```

JS API:

```ts
import { publishReport, updateReport } from "reportdock";

const report = await publishReport({
  entryFile: "./report.html",
  baseUrl: process.env.REPORTDOCK_BASE_URL,
  token: process.env.REPORTDOCK_TOKEN,
  metadata: { commit: process.env.GITHUB_SHA }
});

console.log(report.url);

await updateReport({
  id: report.id,
  entryFile: "./updated-report.html",
  baseUrl: process.env.REPORTDOCK_BASE_URL,
  token: process.env.REPORTDOCK_TOKEN
});
```

## npm Package

The CLI/client package is published as:

```txt
reportdock
```

Release publishing is handled by `.github/workflows/npm.yml` when a `v*` tag is pushed. Before the first publish, create an npm automation token, or a granular npm access token with 2FA bypass enabled, and add it to the GitHub repository as `NPM_TOKEN`.

The workflow checks that the Git tag matches `packages/client/package.json`. For example, package version `0.1.5` must be released with tag `v0.1.5`.

## Upload Model

Every publish creates a high-entropy report ID and stores:

```txt
data/
  reportdock.sqlite
  reports/<id>/index.html
  reports/.versions/<id>/<version>/index.html
  reports/<id>/...
  tmp/
```

Publishing creates version 1 at `/r/<id>/`. Updating a report replaces the content served at the same public URL after the new bundle has been staged and promoted; the URL remains stable.

The client parses the HTML and bundles local assets referenced by common HTML attributes such as `src`, `srcset`, `poster`, relevant `link[href]`, `object[data]`, and `embed[src]`.

V1 intentionally does not recursively discover `url(...)` references inside CSS files. External network URLs are not bundled or fetched by the server and are blocked by the default report CSP.

## Security

Admin/API routes require `Authorization: Bearer <token>`. The dashboard uses a token login form and an HttpOnly SameSite cookie. Tokens are not accepted through query strings.

Uploaded reports are treated as untrusted content. Public report HTML is served with a CSP sandbox, no same-origin privilege, no form submission, no top navigation, no API CORS access, and `Cache-Control: no-store`. Report assets are immutable and served with long-lived cache headers.

Do not add `allow-same-origin` to same-origin report pages. For stronger production isolation, put reports on a separate origin with `REPORTDOCK_REPORT_BASE_URL`.

## Development

```sh
npm install
npm run typecheck
npm test
npm run build
REPORTDOCK_ADMIN_TOKEN=dev-token npm run dev:server
```

The repository is configured for `github.com/dain98/ReportDock`.

## V1 Non-Goals

V1 does not support zip uploads, named overwrites, private viewer auth, users/teams, search/tags, remote asset fetching, or Postgres/S3 adapters.
