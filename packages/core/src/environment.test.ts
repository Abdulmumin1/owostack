import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Owostack, OwostackError } from "./index";
import {
  apiUrlForMode,
  inferModeFromSecretKey,
  resolveEnvironment,
} from "./environment";

describe("inferModeFromSecretKey", () => {
  it("reads the scope from the key prefix", () => {
    expect(inferModeFromSecretKey("owo_sk_test_abc")).toBe("sandbox");
    expect(inferModeFromSecretKey("owo_sk_live_abc")).toBe("live");
    expect(inferModeFromSecretKey("OWO_SK_LIVE_abc")).toBe("live");
  });

  it("returns null for legacy, foreign and missing keys", () => {
    expect(inferModeFromSecretKey("owo_sk_abc123")).toBeNull();
    expect(inferModeFromSecretKey("owo_sk_testabc")).toBeNull();
    expect(inferModeFromSecretKey("sk_test_abc")).toBeNull();
    expect(inferModeFromSecretKey("")).toBeNull();
    expect(inferModeFromSecretKey(undefined)).toBeNull();
  });
});

describe("resolveEnvironment", () => {
  it("uses an explicit mode", () => {
    expect(
      resolveEnvironment({ secretKey: "owo_sk_abc", mode: "sandbox" }),
    ).toEqual({
      mode: "sandbox",
      apiUrl: "https://sandbox.owostack.com/v1",
      source: "mode",
      error: null,
    });
    expect(
      resolveEnvironment({ secretKey: "owo_sk_abc", mode: "live" }).apiUrl,
    ).toBe("https://api.owostack.com/v1");
  });

  it("infers the environment from a scoped key when mode is omitted", () => {
    expect(resolveEnvironment({ secretKey: "owo_sk_test_abc" })).toEqual({
      mode: "sandbox",
      apiUrl: apiUrlForMode("sandbox"),
      source: "secretKey",
      error: null,
    });
    expect(resolveEnvironment({ secretKey: "owo_sk_live_abc" })).toMatchObject({
      mode: "live",
      apiUrl: "https://api.owostack.com/v1",
    });
  });

  it("refuses to pick an environment for a legacy key without mode", () => {
    const resolved = resolveEnvironment({ secretKey: "owo_sk_abc" });
    expect(resolved.mode).toBeNull();
    expect(resolved.apiUrl).toBeNull();
    expect(resolved.source).toBe("unresolved");
    expect(resolved.error).toContain('mode: "sandbox" | "live"');
    expect(resolved.error).toContain("will not default to live");
  });

  it("flags a mode that contradicts the key scope, even with a custom apiUrl", () => {
    const resolved = resolveEnvironment({
      secretKey: "owo_sk_test_abc",
      mode: "live",
      apiUrl: "http://localhost:8787/v1",
    });
    expect(resolved.apiUrl).toBeNull();
    expect(resolved.error).toContain('mode is "live"');
    expect(resolved.error).toContain("scoped to sandbox");
  });

  it("lets an explicit apiUrl stand in for mode (self-hosted / local)", () => {
    expect(
      resolveEnvironment({
        secretKey: "owo_sk_abc",
        apiUrl: "http://localhost:8787/api/v1",
      }),
    ).toEqual({
      mode: null,
      apiUrl: "http://localhost:8787/api/v1",
      source: "apiUrl",
      error: null,
    });
    expect(
      resolveEnvironment({
        secretKey: "owo_sk_live_abc",
        apiUrl: "https://billing.example.com/v1",
      }).mode,
    ).toBe("live");
  });
});

describe("Owostack client environment behaviour", () => {
  let server: Server;
  let baseUrl: string;
  const hits: string[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      hits.push(`${req.method} ${req.url} ${req.headers.authorization}`);
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          allowed: true,
          code: "access_granted",
          environment: "sandbox",
          unlimited: true,
          usage: 0,
          limit: null,
          balance: null,
          resetsAt: null,
          resetInterval: null,
          credits: null,
          details: { message: "ok" },
        }),
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it("constructs fine but fails the first request when the environment is unresolved", async () => {
    // Construction must not throw: CLI tooling loads configs whose key comes
    // from an env var that may be absent and overrides the URL afterwards.
    const owo = new Owostack({ secretKey: "owo_sk_legacy" });
    expect(owo.mode).toBeNull();
    expect(owo.apiUrl).toBeNull();

    hits.length = 0;
    await expect(
      owo.check({ customer: "user_1", feature: "turns" }),
    ).rejects.toMatchObject({
      name: "OwostackError",
      code: "config_error",
    });
    await expect(owo.customer.get("user_1")).rejects.toBeInstanceOf(
      OwostackError,
    );
    expect(hits).toHaveLength(0);
  });

  it("sends requests to the resolved URL once one is provided", async () => {
    const owo = new Owostack({ secretKey: "owo_sk_test_abc", apiUrl: baseUrl });
    expect(owo.mode).toBe("sandbox");

    hits.length = 0;
    const result = await owo.check({ customer: "user_1", feature: "turns" });
    expect(result).toMatchObject({
      allowed: true,
      environment: "sandbox",
      unlimited: true,
    });
    expect(hits).toEqual(["POST /v1/check Bearer owo_sk_test_abc"]);
  });

  it("re-resolves after setApiUrl / setSecretKey (CLI override path)", async () => {
    const owo = new Owostack({ secretKey: "owo_sk_legacy" });
    owo.setSecretKey("owo_sk_live_zzz");
    expect(owo.mode).toBe("live");
    expect(owo.apiUrl).toBe("https://api.owostack.com/v1");

    owo.setApiUrl(baseUrl);
    expect(owo.apiUrl).toBe(baseUrl);
    expect(owo.mode).toBe("live");

    hits.length = 0;
    await owo.track({ customer: "user_1", feature: "turns", value: 2 });
    expect(hits).toEqual(["POST /v1/track Bearer owo_sk_live_zzz"]);
  });

  it("surfaces a mode/key contradiction as a config_error before any request", async () => {
    const owo = new Owostack({ secretKey: "owo_sk_live_abc", mode: "sandbox" });
    hits.length = 0;
    await expect(
      owo.track({ customer: "user_1", feature: "turns" }),
    ).rejects.toMatchObject({
      code: "config_error",
      message: expect.stringContaining("scoped to live"),
    });
    expect(hits).toHaveLength(0);
  });
});
