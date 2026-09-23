import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fetchCreditPacks, fetchCreditSystems, fetchPlans } from "./api.js";
import { isCliError } from "./errors.js";

/**
 * The fetch helpers are run against a real local HTTP server so the error
 * mapping (status/body -> CliError code, exit code, hint) is exercised on the
 * wire rather than through a stubbed fetch.
 */
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    const auth = req.headers.authorization ?? "";

    if (auth.includes("owo_sk_test_wronghost")) {
      res.statusCode = 401;
      res.end(
        JSON.stringify({
          success: false,
          error: {
            code: "environment_mismatch",
            message: "This API key is scoped to the sandbox environment…",
          },
          environment: "live",
        }),
      );
      return;
    }
    if (auth.includes("owo_sk_bad")) {
      res.statusCode = 401;
      res.end(JSON.stringify({ success: false, error: "Invalid API Key" }));
      return;
    }
    if (req.url?.startsWith("/api/v1/credit-systems")) {
      if (auth.includes("owo_sk_boom")) {
        res.statusCode = 500;
        res.end(JSON.stringify({ success: false, error: "boom" }));
        return;
      }
      res.end(
        JSON.stringify({ success: true, creditSystems: [{ slug: "ai" }] }),
      );
      return;
    }
    if (req.url?.startsWith("/api/v1/credit-packs")) {
      res.end(JSON.stringify({ success: true, data: [{ slug: "pack" }] }));
      return;
    }
    if (req.url?.startsWith("/api/v1/plans")) {
      res.end(
        JSON.stringify({
          success: true,
          plans: [{ slug: "pro", q: req.url.split("?")[1] ?? "" }],
        }),
      );
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ success: false, error: "not found" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected rejection");
}

describe("catalog fetches", () => {
  it("returns the payloads on success and forwards plan filters", async () => {
    await expect(fetchCreditSystems("owo_sk_ok", baseUrl)).resolves.toEqual([
      { slug: "ai" },
    ]);
    await expect(fetchCreditPacks("owo_sk_ok", baseUrl)).resolves.toEqual([
      { slug: "pack" },
    ]);
    const plans = await fetchPlans({
      apiKey: "owo_sk_ok",
      apiUrl: baseUrl,
      group: "main",
      includeInactive: true,
    });
    expect(plans).toEqual([
      { slug: "pro", q: "group=main&includeInactive=true" },
    ]);
  });

  it("fails with a usage error (exit 2) when the key is missing, without a request", async () => {
    const error = await rejection(fetchCreditSystems("", baseUrl));
    expect(isCliError(error) && error.code).toBe("missing_api_key");
    expect(isCliError(error) && error.exitCode).toBe(2);
  });

  it("maps API failures to api_error with exit 1 instead of exiting the process", async () => {
    const error = await rejection(fetchCreditSystems("owo_sk_boom", baseUrl));
    expect(isCliError(error) && error.code).toBe("api_error");
    expect(isCliError(error) && error.exitCode).toBe(1);
    expect((error as Error).message).toContain("boom");
  });

  it("explains an environment_mismatch 401 in terms of --mode", async () => {
    const error = await rejection(
      fetchPlans({ apiKey: "owo_sk_test_wronghost", apiUrl: baseUrl }),
    );
    expect(isCliError(error) && error.code).toBe("api_error");
    expect(isCliError(error) && error.hint).toContain("--mode");
    expect((error as Error).message).toContain("scoped to the sandbox");
  });

  it("hints at the key for a plain 401", async () => {
    const error = await rejection(fetchCreditPacks("owo_sk_bad", baseUrl));
    expect(isCliError(error) && error.hint).toContain("API key");
  });

  it("maps unreachable hosts to network_error with the host in the message", async () => {
    // Port 9 (discard) is reliably closed on dev machines.
    const error = await rejection(
      fetchCreditPacks("owo_sk_ok", "http://127.0.0.1:9/api/v1"),
    );
    expect(isCliError(error) && error.code).toBe("network_error");
    expect(isCliError(error) && error.exitCode).toBe(1);
    expect((error as Error).message).toContain("127.0.0.1:9");
  });
});
