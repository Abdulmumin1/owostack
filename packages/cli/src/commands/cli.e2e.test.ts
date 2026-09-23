import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * End-to-end: the real CLI entrypoint is spawned as a child process against a
 * real local API server and a real owo.config.mjs on disk. This pins down the
 * contract CI scripts depend on: JSON-only stdout, exit codes, and — most
 * importantly — that the wrong environment is refused before any request.
 */
const CLI_ENTRY = resolve(__dirname, "../index.ts");
const TSX_BIN = resolve(__dirname, "../../node_modules/.bin/tsx");

let server: Server;
let host: string;
let configPath: string;
let fakeHome: string;
const requests: Array<{ method: string; url: string; auth: string }> = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    requests.push({
      method: req.method ?? "",
      url: req.url ?? "",
      auth: req.headers.authorization ?? "",
    });
    res.setHeader("Content-Type", "application/json");
    const url = req.url ?? "";

    if (url.startsWith("/api/v1/plans")) {
      res.end(JSON.stringify({ success: true, plans: [] }));
    } else if (url.startsWith("/api/v1/credit-systems")) {
      res.end(JSON.stringify({ success: true, creditSystems: [] }));
    } else if (url.startsWith("/api/v1/credit-packs")) {
      res.end(JSON.stringify({ success: true, data: [] }));
    } else if (url === "/api/v1/sync" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const payload = JSON.parse(body);
        res.end(
          JSON.stringify({
            success: true,
            features: {
              created: payload.features.map((f: any) => f.slug),
              updated: [],
              unchanged: [],
            },
            creditSystems: { created: [], updated: [], unchanged: [] },
            creditPacks: { created: [], updated: [], unchanged: [] },
            plans: {
              created: payload.plans.map((p: any) => p.slug),
              updated: [],
              unchanged: [],
            },
            warnings: [],
          }),
        );
      });
    } else {
      res.statusCode = 404;
      res.end(JSON.stringify({ success: false, error: "not found" }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  host = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const dir = await mkdtemp(join(tmpdir(), "owosk-e2e-"));
  fakeHome = await mkdtemp(join(tmpdir(), "owosk-home-"));
  configPath = join(dir, "owo.config.mjs");
  await writeFile(
    configPath,
    `import { Owostack, metered, plan } from "owostack";
const turns = metered("agent-turns", { name: "Agent turns" });
export default new Owostack({
  secretKey: process.env.OWOSTACK_SECRET_KEY || "owo_sk_placeholder",
  catalog: [
    plan("pro", { name: "Pro", price: 5000, currency: "USD", interval: "monthly", features: [turns.limit(100)] }),
  ],
});
`,
  );
}, 30_000);

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

function runCli(args: string[], env: Record<string, string> = {}) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolvePromise, reject) => {
      const child = spawn(TSX_BIN, [CLI_ENTRY, ...args], {
        env: {
          PATH: process.env.PATH ?? "",
          HOME: fakeHome,
          USERPROFILE: fakeHome,
          NO_COLOR: "1",
          OWOSTACK_API_URL: host,
          ...env,
        },
        cwd: resolve(__dirname, "../.."),
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("error", reject);
      child.on("close", (code) => resolvePromise({ code, stdout, stderr }));
    },
  );
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/;

describe("owosk end-to-end", () => {
  it("sync --dry-run --json prints a single JSON document and exits 0", async () => {
    requests.length = 0;
    const result = await runCli([
      "sync",
      "--json",
      "--dry-run",
      "--config",
      configPath,
      "--key",
      "owo_sk_test_e2e",
    ]);

    expect(result.code).toBe(0);
    expect(result.stdout).not.toMatch(ANSI);
    const doc = JSON.parse(result.stdout);
    expect(doc).toMatchObject({
      ok: true,
      command: "sync",
      mode: "sandbox",
      apiUrl: `${host}/api/v1`,
      dryRun: true,
      hasChanges: true,
      applied: false,
    });
    expect(doc.changes.plans.added).toEqual(["pro"]);
    expect(doc.changes.total).toBeGreaterThan(0);

    // Dry run reads but never writes.
    expect(requests.map((r) => r.method)).not.toContain("POST");
    expect(requests.every((r) => r.auth === "Bearer owo_sk_test_e2e")).toBe(
      true,
    );
  }, 30_000);

  it("refuses --mode live with a sandbox key before any request (exit 2)", async () => {
    requests.length = 0;
    const result = await runCli([
      "sync",
      "--json",
      "--yes",
      "--mode",
      "live",
      "--config",
      configPath,
      "--key",
      "owo_sk_test_e2e",
    ]);

    expect(result.code).toBe(2);
    const doc = JSON.parse(result.stdout);
    expect(doc.ok).toBe(false);
    expect(doc.error.code).toBe("mode_mismatch");
    expect(doc.error.message).toContain("scoped to sandbox");
    expect(requests).toHaveLength(0);
  }, 30_000);

  it("refuses to guess an environment for a legacy key (exit 2)", async () => {
    requests.length = 0;
    const result = await runCli([
      "sync",
      "--json",
      "--dry-run",
      "--config",
      configPath,
      "--key",
      "owo_sk_legacykey",
    ]);

    expect(result.code).toBe(2);
    expect(JSON.parse(result.stdout).error.code).toBe("missing_mode");
    expect(requests).toHaveLength(0);
  }, 30_000);

  it("accepts OWOSTACK_MODE and the deprecated --prod alias", async () => {
    const viaEnv = await runCli(
      ["diff", "--json", "--config", configPath, "--key", "owo_sk_legacykey"],
      { OWOSTACK_MODE: "live" },
    );
    expect(viaEnv.code).toBe(0);
    expect(JSON.parse(viaEnv.stdout).mode).toBe("live");

    const viaProd = await runCli([
      "--prod",
      "diff",
      "--json",
      "--config",
      configPath,
      "--key",
      "owo_sk_legacykey",
    ]);
    expect(viaProd.code).toBe(0);
    expect(JSON.parse(viaProd.stdout).mode).toBe("live");
  }, 30_000);

  it("diff --exit-code exits 3 when the catalogs differ", async () => {
    const result = await runCli([
      "diff",
      "--json",
      "--exit-code",
      "--config",
      configPath,
      "--key",
      "owo_sk_test_e2e",
    ]);
    expect(result.code).toBe(3);
    const doc = JSON.parse(result.stdout);
    expect(doc.command).toBe("diff");
    expect(doc.hasChanges).toBe(true);
  }, 30_000);

  it("sync --yes --json applies and reports the server result", async () => {
    requests.length = 0;
    const result = await runCli([
      "sync",
      "--json",
      "--yes",
      "--config",
      configPath,
      "--key",
      "owo_sk_test_e2e",
    ]);

    expect(result.code).toBe(0);
    const doc = JSON.parse(result.stdout);
    expect(doc).toMatchObject({ ok: true, applied: true, mode: "sandbox" });
    expect(doc.result.plans.created).toEqual(["pro"]);
    expect(doc.result.features.created).toEqual(["agent-turns"]);

    const syncCall = requests.find((r) => r.method === "POST");
    expect(syncCall?.url).toBe("/api/v1/sync");
    expect(syncCall?.auth).toBe("Bearer owo_sk_test_e2e");
  }, 30_000);

  it("sync --json without --yes refuses to prompt", async () => {
    const result = await runCli([
      "sync",
      "--json",
      "--config",
      configPath,
      "--key",
      "owo_sk_test_e2e",
    ]);
    expect(result.code).toBe(2);
    expect(JSON.parse(result.stdout).error.message).toContain("--yes");
  }, 30_000);

  it("reports a missing config file as a usage error (exit 2)", async () => {
    const result = await runCli([
      "sync",
      "--json",
      "--dry-run",
      "--config",
      join(fakeHome, "nope.config.ts"),
      "--key",
      "owo_sk_test_e2e",
    ]);
    expect(result.code).toBe(2);
    expect(JSON.parse(result.stdout).error.code).toBe("config_not_found");
  }, 30_000);
});
