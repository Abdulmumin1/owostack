import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { createRouteTestApp } from "./helpers/route-harness";
import { encrypt } from "../src/lib/encryption";

const hoisted = vi.hoisted(() => ({
  getProviderRegistryMock: vi.fn(),
  syncPlansToProviderMock: vi.fn(),
}));

vi.mock("../src/lib/providers", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/providers")>(
    "../src/lib/providers",
  );
  return {
    ...actual,
    getProviderRegistry: () => hoisted.getProviderRegistryMock(),
  };
});

vi.mock("../src/lib/plan-sync", () => ({
  syncPlansToProvider: (...args: unknown[]) =>
    hoisted.syncPlansToProviderMock(...args),
}));

interface ProviderAccountRow {
  id: string;
  organizationId: string;
  providerId: string;
  environment: "test" | "live";
  displayName: string | null;
  credentials: Record<string, unknown>;
  metadata: Record<string, unknown> | null;
  createdAt: number;
  updatedAt: number;
}

interface MockDb {
  insert: Mock;
  update: Mock;
  query: {
    providerAccounts: {
      findFirst: Mock;
      findMany: Mock;
    };
    providerRules: {
      findMany: Mock;
    };
  };
}

let app: ReturnType<
  typeof createRouteTestApp<{ db: MockDb; organizationId: string }>
>;
let insertedValues: ProviderAccountRow | null;
let updatedValues: Record<string, unknown> | null;

const insertReturningMock = vi.fn(async () => [
  {
    ...(insertedValues as ProviderAccountRow),
  },
]);
const insertValuesMock = vi.fn((values: ProviderAccountRow) => {
  insertedValues = values;
  return { returning: insertReturningMock };
});
const insertMock = vi.fn(() => ({ values: insertValuesMock }));

const updateReturningMock = vi.fn(async () => [
  {
    id: "acct_existing",
    organizationId: "org_123",
    providerId: "stripe",
    environment: "test",
    displayName: "Stripe Test",
    credentials: {},
    metadata: null,
    createdAt: 1000,
    updatedAt: 2000,
    ...(updatedValues || {}),
  },
]);
const updateWhereMock = vi.fn(() => ({ returning: updateReturningMock }));
const updateSetMock = vi.fn((values: Record<string, unknown>) => {
  updatedValues = values;
  return { where: updateWhereMock };
});
const updateMock = vi.fn(() => ({ set: updateSetMock }));

const mockDb: MockDb = {
  insert: insertMock,
  update: updateMock,
  query: {
    providerAccounts: {
      findFirst: vi.fn(),
      findMany: vi.fn(async () => []),
    },
    providerRules: {
      findMany: vi.fn(async () => []),
    },
  },
};

const env = {
  ENCRYPTION_KEY: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
  ENABLED_PROVIDERS: "paystack,stripe,dodopayments,polar",
};

describe("Dashboard provider validation", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    insertedValues = null;
    updatedValues = null;
    hoisted.getProviderRegistryMock.mockReturnValue({ get: () => undefined });
    hoisted.syncPlansToProviderMock.mockResolvedValue({
      synced: [],
      failed: [],
      skipped: 0,
    });
    vi.stubGlobal("fetch", vi.fn());

    const { default: providersRoute } =
      await import("../src/routes/dashboard/providers");
    app = createRouteTestApp(providersRoute, {
      db: mockDb,
      organizationId: "org_123",
    });
  });

  it("rejects Stripe environment mismatches before making a network call", async () => {
    mockDb.query.providerAccounts.findFirst.mockResolvedValueOnce(null);

    const response = await app.request(
      "/accounts",
      {
        method: "POST",
        body: JSON.stringify({
          organizationId: "org_123",
          providerId: "stripe",
          environment: "live",
          credentials: { secretKey: "sk_test_123" },
        }),
      },
      env,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      success: false,
      error: "Stripe live environment requires an sk_live_ secret key",
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("preflights provider validation without creating a provider account", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ livemode: false }), { status: 200 }),
    );

    const response = await app.request(
      "/validate",
      {
        method: "POST",
        body: JSON.stringify({
          providerId: "stripe",
          environment: "test",
          credentials: { secretKey: "sk_test_123" },
        }),
      },
      env,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.validation.status).toBe("verified");
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("creates a Stripe account only after a successful authenticated verification", async () => {
    mockDb.query.providerAccounts.findFirst.mockResolvedValueOnce(null);
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ livemode: false }), { status: 200 }),
    );

    const response = await app.request(
      "/accounts",
      {
        method: "POST",
        body: JSON.stringify({
          organizationId: "org_123",
          providerId: "stripe",
          environment: "test",
          credentials: {
            secretKey: " sk_test_123 ",
            publishableKey: "pk_test_123",
            webhookSecret: "whsec_123",
          },
        }),
      },
      env,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "https://api.stripe.com/v1/balance",
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: "Bearer sk_test_123" },
      }),
    );
    expect(insertedValues?.credentials.publishableKey).toBe("pk_test_123");
    expect(insertedValues?.credentials.webhookSecret).not.toBe("whsec_123");
    expect(insertedValues?.credentials.secretKey).not.toBe("sk_test_123");
    expect(insertedValues?.metadata).toMatchObject({
      providerValidation: {
        status: "verified",
        verificationLevel: "authentication_and_environment",
      },
    });
    expect(body.validation.status).toBe("verified");
  });

  it("merges incoming updates with existing encrypted credentials before validating", async () => {
    const encryptedSecretKey = await encrypt(
      "sk_test_existing",
      env.ENCRYPTION_KEY,
    );
    mockDb.query.providerAccounts.findFirst.mockResolvedValueOnce({
      id: "acct_existing",
      organizationId: "org_123",
      providerId: "stripe",
      environment: "test",
      displayName: "Stripe Test",
      credentials: {
        secretKey: encryptedSecretKey,
        webhookSecret: "whsec_existing",
      },
      metadata: { retained: true },
      createdAt: 1000,
      updatedAt: 2000,
    });
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ livemode: false }), { status: 200 }),
    );

    const response = await app.request(
      "/accounts/acct_existing",
      {
        method: "PATCH",
        body: JSON.stringify({
          organizationId: "org_123",
          credentials: {
            publishableKey: "pk_test_updated",
          },
        }),
      },
      env,
    );

    expect(response.status).toBe(200);
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "https://api.stripe.com/v1/balance",
      expect.objectContaining({
        headers: { Authorization: "Bearer sk_test_existing" },
      }),
    );
    expect(updatedValues?.credentials).toMatchObject({
      secretKey: encryptedSecretKey,
      webhookSecret: "whsec_existing",
      publishableKey: "pk_test_updated",
    });
    expect(updatedValues?.metadata).toMatchObject({
      retained: true,
      providerValidation: {
        status: "verified",
      },
    });
  });

  it("rejects Dodo Payments keys when the provider denies authentication", async () => {
    mockDb.query.providerAccounts.findFirst.mockResolvedValueOnce(null);
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: "Unauthorized" }), { status: 401 }),
    );

    const response = await app.request(
      "/accounts",
      {
        method: "POST",
        body: JSON.stringify({
          organizationId: "org_123",
          providerId: "dodopayments",
          environment: "test",
          credentials: { secretKey: "dodo_test_invalid" },
        }),
      },
      env,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      success: false,
      error: "Dodo Payments rejected the API key: Unauthorized",
    });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("rejects Polar tokens that are missing required resource permissions", async () => {
    mockDb.query.providerAccounts.findFirst.mockResolvedValueOnce(null);
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: "Forbidden" }), { status: 403 }),
      );

    const response = await app.request(
      "/accounts",
      {
        method: "POST",
        body: JSON.stringify({
          organizationId: "org_123",
          providerId: "polar",
          environment: "test",
          credentials: { secretKey: "polar_token" },
        }),
      },
      env,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      success: false,
      error: "Polar token is missing permission for customers: Forbidden",
    });
    expect(insertMock).not.toHaveBeenCalled();
  });
});
