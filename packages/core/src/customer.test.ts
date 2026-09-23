import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Owostack } from "./index";

/**
 * The SDK is exercised against a real HTTP server so the request line and
 * headers that reach the wire are what gets asserted, not a stubbed fetch.
 */
type Recorded = { method: string; url: string; authorization?: string };

let server: Server;
let baseUrl: string;
const recorded: Recorded[] = [];

beforeAll(async () => {
  server = createServer((req: IncomingMessage, res) => {
    recorded.push({
      method: req.method ?? "",
      url: req.url ?? "",
      authorization: req.headers.authorization,
    });

    const url = new URL(req.url ?? "/", "http://localhost");
    res.setHeader("Content-Type", "application/json");

    if (url.pathname === "/api/v1/customers") {
      res.end(
        JSON.stringify({
          success: true,
          data: [
            {
              id: "11111111-1111-4111-8111-111111111111",
              externalId:
                url.searchParams.get("externalId") ?? "workspace_alpha",
              email: "alpha-owner@example.com",
              name: "Alpha Workspace",
              metadata: null,
              createdAt: 1,
              updatedAt: 2,
            },
          ],
          total: 1,
          limit: Number(url.searchParams.get("limit") ?? 50),
          offset: Number(url.searchParams.get("offset") ?? 0),
        }),
      );
      return;
    }

    if (url.pathname.startsWith("/api/v1/customers/")) {
      const identifier = decodeURIComponent(
        url.pathname.slice("/api/v1/customers/".length),
      );
      if (identifier === "workspace_missing") {
        res.statusCode = 404;
        res.end(
          JSON.stringify({ success: false, error: "Customer not found" }),
        );
        return;
      }
      res.end(
        JSON.stringify({
          success: true,
          id: "11111111-1111-4111-8111-111111111111",
          externalId: "workspace_alpha",
          email: "alpha-owner@example.com",
          name: "Alpha Workspace",
          metadata: null,
          billing: { overageLimit: null, featureConfigs: [] },
          createdAt: 1,
          updatedAt: 2,
          resolvedFrom: identifier,
        }),
      );
      return;
    }

    res.statusCode = 500;
    res.end(JSON.stringify({ success: false, error: "unexpected route" }));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}/api/v1`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

describe("owo.customer reads", () => {
  const client = () =>
    new Owostack({ secretKey: "owo_sk_test_abc123", apiUrl: baseUrl });

  it("get() fetches by external id and by email with the id URL-encoded", async () => {
    recorded.length = 0;

    const byExternalId = await client().customer.get("workspace_alpha");
    expect(byExternalId).toMatchObject({
      id: "11111111-1111-4111-8111-111111111111",
      externalId: "workspace_alpha",
      email: "alpha-owner@example.com",
    });

    await client().customer.get("alpha-owner@example.com");
    await client().customer.get("team/ops");

    expect(recorded.map((r) => r.url)).toEqual([
      "/api/v1/customers/workspace_alpha",
      "/api/v1/customers/alpha-owner%40example.com",
      "/api/v1/customers/team%2Fops",
    ]);
    expect(recorded.every((r) => r.method === "GET")).toBe(true);
    expect(
      recorded.every((r) => r.authorization === "Bearer owo_sk_test_abc123"),
    ).toBe(true);
  });

  it("get() surfaces API errors as OwostackError", async () => {
    await expect(
      client().customer.get("workspace_missing"),
    ).rejects.toMatchObject({
      name: "OwostackError",
      message: "Customer not found",
    });
  });

  it("list() serialises only the filters that were provided", async () => {
    recorded.length = 0;

    const all = await client().customer.list();
    expect(all.total).toBe(1);
    expect(all.data[0].externalId).toBe("workspace_alpha");

    const filtered = await client().customer.list({
      limit: 10,
      offset: 20,
      externalId: "workspace_beta",
      search: "work space",
    });
    expect(filtered.limit).toBe(10);
    expect(filtered.offset).toBe(20);
    expect(filtered.data[0].externalId).toBe("workspace_beta");

    await client().customer.list({ email: "Alpha-Owner@example.com" });

    expect(recorded.map((r) => r.url)).toEqual([
      "/api/v1/customers",
      "/api/v1/customers?limit=10&offset=20&search=work+space&externalId=workspace_beta",
      "/api/v1/customers?email=Alpha-Owner%40example.com",
    ]);
  });
});
