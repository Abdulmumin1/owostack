import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDashboardKeysRoute,
  type DashboardKeysDependencies,
} from "../src/routes/dashboard/keys";
import { createDashboardShell } from "../src/routes/dashboard/shell";
import { createRouteTestApp } from "./helpers/route-harness";

describe("Dashboard API keys", () => {
  const businessDb = {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoNothing: vi.fn(async () => undefined),
      })),
    })),
    query: {
      organizations: {
        findFirst: vi.fn(),
      },
    },
  };

  const authInsertReturningMock = vi.fn();
  const authInsertValuesMock = vi.fn(() => ({
    returning: authInsertReturningMock,
  }));
  const authDb = {
    insert: vi.fn(() => ({
      values: authInsertValuesMock,
    })),
    query: {
      organizations: {
        findFirst: vi.fn(),
      },
      apiKeys: {
        findMany: vi.fn(async () => []),
      },
    },
  };

  const generateApiKeyMock = vi.fn(() => "owo_sk_test_generated");
  const hashApiKeyMock = vi.fn(async () => "hashed-key");
  const getSessionMock = vi.fn(async () => ({
    user: { id: "user_123" },
    session: { id: "session_123" },
  }));
  const resolveOrganizationIdMock = vi.fn(async () => null);
  const keyDeps: DashboardKeysDependencies = {
    generateApiKey:
      generateApiKeyMock as unknown as DashboardKeysDependencies["generateApiKey"],
    hashApiKey:
      hashApiKeyMock as unknown as DashboardKeysDependencies["hashApiKey"],
  };

  const dashboardApp = createDashboardShell({
    getSession: getSessionMock,
    resolveOrganizationId: resolveOrganizationIdMock,
  });
  dashboardApp.route("/keys", createDashboardKeysRoute(keyDeps));

  const app = createRouteTestApp(dashboardApp, {
    db: businessDb,
    authDb,
  });

  const env = {
    ENCRYPTION_KEY: "test_key",
    PAYSTACK_SECRET_KEY: "sk_test",
    PAYSTACK_WEBHOOK_SECRET: "wh_secret",
  };

  beforeEach(() => {
    vi.clearAllMocks();

    authDb.query.organizations.findFirst.mockResolvedValue({
      id: "org_uuid_123",
      name: "Acme",
      slug: "acme",
      logo: null,
      metadata: null,
      createdAt: Date.now(),
    });

    businessDb.query.organizations.findFirst.mockResolvedValue(null);

    authInsertReturningMock.mockResolvedValue([
      {
        id: "key_123",
        organizationId: "org_uuid_123",
        name: "Primary",
        prefix: "owo_sk_",
        createdAt: Date.now(),
      },
    ]);
  });

  it("resolves an organization slug through auth DB before inserting the API key", async () => {
    const res = await app.request(
      "/keys",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          organizationId: "acme",
          name: "Primary",
        }),
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(resolveOrganizationIdMock).not.toHaveBeenCalled();
    expect(authInsertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_uuid_123",
        name: "Primary",
        hash: "hashed-key",
      }),
    );
    expect(businessDb.insert).toHaveBeenCalled();
    expect(generateApiKeyMock).toHaveBeenCalledTimes(1);
    expect(hashApiKeyMock).toHaveBeenCalledWith("owo_sk_test_generated");
  });
});
