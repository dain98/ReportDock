import { chmod, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(root, "packages/client/dist/cli.js");
const contents = await readFile(cliPath, "utf8");

if (!contents.startsWith("#!/usr/bin/env node")) {
  await writeFile(cliPath, `#!/usr/bin/env node\n${contents}`);
}

await chmod(cliPath, 0o755);
