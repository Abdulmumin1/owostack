import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => {
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
  const authInsertMock = vi.fn(() => ({
    values: authInsertValuesMock,
  }));

  const authDb = {
    insert: authInsertMock,
    query: {
      organizations: {
        findFirst: vi.fn(),
      },
      apiKeys: {
        findMany: vi.fn(async () => []),
      },
    },
  };

  return {
    businessDb,
    authDb,
    authInsertMock,
    authInsertValuesMock,
    authInsertReturningMock,
    getSessionMock: vi.fn(),
    generateApiKeyMock: vi.fn(() => "owo_sk_test_generated"),
    hashApiKeyMock: vi.fn(async () => "hashed-key"),
  };
});

const {
  businessDb,
  authDb,
  authInsertValuesMock,
  authInsertReturningMock,
  getSessionMock,
  generateApiKeyMock,
  hashApiKeyMock,
} = hoisted;

vi.mock("@owostack/db", async () => {
  const actual =
    await vi.importActual<typeof import("@owostack/db")>("@owostack/db");

  return {
    ...actual,
    createDb: (binding: unknown) => {
      if (binding === env.DB_AUTH) return authDb;
      return businessDb;
    },
  };
});

vi.mock("../src/lib/auth", () => ({
  auth: () => ({
    handler: () => new Response("Auth"),
    api: {
      getSession: getSessionMock,
    },
  }),
}));

vi.mock("../src/lib/api-keys", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/api-keys")>(
    "../src/lib/api-keys",
  );

  return {
    ...actual,
    generateApiKey: generateApiKeyMock,
    hashApiKey: hashApiKeyMock,
  };
});

vi.mock("../src/lib/webhooks", () => ({
  WebhookHandler: class {},
}));

const env = {
  DB: { name: "business" },
  DB_AUTH: { name: "auth" },
  BETTER_AUTH_SECRET: "secret",
  BETTER_AUTH_URL: "http://localhost",
  ENCRYPTION_KEY: "test_key",
  PAYSTACK_SECRET_KEY: "sk_test",
  PAYSTACK_WEBHOOK_SECRET: "wh_secret",
};

describe("Dashboard API keys", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    getSessionMock.mockResolvedValue({
      user: { id: "user_123" },
      session: { id: "session_123" },
    });

    authDb.query.organizations.findFirst.mockResolvedValue({
      id: "org_uuid_123",
      name: "Acme",
      slug: "acme",
      logo: null,
      metadata: null,
      createdAt: Date.now(),
    });

    businessDb.query.organizations.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

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
    const { app } = await import("../src/index");

    const res = await app.request(
      "/api/dashboard/keys",
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
    expect(authInsertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_uuid_123",
        name: "Primary",
        hash: "hashed-key",
      }),
    );
    expect(businessDb.insert).toHaveBeenCalled();
  });
});
