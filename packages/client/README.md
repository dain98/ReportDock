# reportdock

CLI and JS client for publishing one-page HTML reports to a self-hosted ReportDock server.

```sh
npm install -g reportdock
reportdock publish ./report.html --base-url https://reportdock.example.com --token "$REPORTDOCK_TOKEN"
```

The client discovers referenced local assets from the HTML, uploads a multipart report bundle, and prints the immutable hosted URL.

```ts
import { publishReport } from "reportdock";

const result = await publishReport({
  entryFile: "./report.html",
  baseUrl: process.env.REPORTDOCK_BASE_URL,
  token: process.env.REPORTDOCK_TOKEN
});

console.log(result.url);
```
