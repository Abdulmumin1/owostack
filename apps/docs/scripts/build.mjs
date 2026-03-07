import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { build } from "vite";

const logPath = resolve(process.cwd(), ".wrangler/logs/docs-build.log");

await mkdir(dirname(logPath), { recursive: true });

// TanStack Start prerender boots a Wrangler-backed preview server.
// Point Wrangler logs into the workspace so builds succeed in sandboxed CI.
if (!process.env.WRANGLER_LOG_PATH) {
  process.env.WRANGLER_LOG_PATH = logPath;
}

await build();
