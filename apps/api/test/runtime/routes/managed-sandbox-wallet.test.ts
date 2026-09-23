import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@owostack/db";
import { createWalletRoute } from "../../../src/routes/api/wallet";
import { createRouteTestApp } from "../../helpers/route-harness";
import { createRuntimeBusinessDb } from "../helpers/business-db";
import { insertApiKey, RUNTIME_ROUTE_ENV } from "../helpers/catalog-runtime";
import {
  jsonResponse,
  SequencedFetchTransport,
  withFetchTransport,
} from "../helpers/fetch-transport";
import {
  insertCustomer,
  insertOrganization,
  insertProviderAccount,
} from "../helpers/workflow-runtime";

/**
 * Real wallet route + real Paystack adapter over a captured HTTP transport.
 * Proves that an organization with zero provider_accounts rows can transact
 * on the sandbox worker using Owostack's shared test credentials, and that the
 * live worker never does.
 */

const MANAGED_PAYSTACK_KEY = "sk_test_owostack_managed_paystack";
const MANAGED_SECRET = JSON.stringify({
  paystack: { secretKey: MANAGED_PAYSTACK_KEY, publicKey: "pk_test_managed" },
});
const API_KEY = "owo_sk_test_0123456789abcdef0123456789abcdef01234567";

describe("Managed sandbox provider accounts (wallet setup runtime)", () => {
  let businessDb: ReturnType<typeof createRuntimeBusinessDb>;
  let app: ReturnType<
    typeof createRouteTestApp<{ db: any; authDb: any }>
  >;

  beforeEach(async () => {
    businessDb = createRuntimeBusinessDb();
    await insertOrganization(businessDb.d1, { id: "org_managed" });
    await insertApiKey(businessDb.d1, {
      id: "key_managed",
      organizationId: "org_managed",
      apiKey: API_KEY,
    });
    await insertCustomer(businessDb.d1, {
      id: "cust_managed",
      organizationId: "org_managed",
      email: "sandbox@example.com",
    });
    app = createRouteTestApp(createWalletRoute(), {
      db: businessDb.db,
      authDb: businessDb.db,
    });
  });

  afterEach(() => {
    businessDb.close();
  });

  function setupWallet(env: Record<string, unknown>) {
    return app.request(
      "/wallet/setup",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ customer: "sandbox@example.com" }),
      },
      env,
    );
  }

  function paystackInitialize(expectedSecretKey: string) {
    return new SequencedFetchTransport([
      {
        name: "paystack initialize",
        method: "POST",
        origin: "https://api.paystack.co",
        path: "/transaction/initialize",
        assert: (request) => {
          expect(request.headers.authorization).toBe(
            `Bearer ${expectedSecretKey}`,
          );
          const body = request.json<{
            email: string;
            metadata: Record<string, unknown>;
          }>();
          expect(body.email).toBe("sandbox@example.com");
          // The org id stamped here is what the shared sandbox webhook uses to
          // route the resulting event back to this organization.
          expect(body.metadata.organization_id).toBe("org_managed");
        },
        respond: jsonResponse({
          status: true,
          data: {
            authorization_url: "https://checkout.paystack.com/managed",
            access_code: "ac_managed",
            reference: "ref_managed",
          },
        }),
      },
    ]);
  }

  it("transacts through the managed Paystack account when the organization has no provider rows", async () => {
    const rows = await businessDb.db.query.providerAccounts.findMany({
      where: eq(schema.providerAccounts.organizationId, "org_managed"),
    });
    expect(rows).toHaveLength(0);

    const transport = paystackInitialize(MANAGED_PAYSTACK_KEY);
    const response = await withFetchTransport(transport, () =>
      setupWallet({
        ...RUNTIME_ROUTE_ENV,
        ENVIRONMENT: "test",
        MANAGED_SANDBOX_PROVIDERS: MANAGED_SECRET,
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url: "https://checkout.paystack.com/managed",
      reference: "ref_managed",
    });
    transport.assertComplete();
  });

  it("prefers the organization's own test credentials over the managed account", async () => {
    await insertProviderAccount({
      db: businessDb.d1,
      id: "acct_own_paystack_test",
      organizationId: "org_managed",
      providerId: "paystack",
      environment: "test",
      secretKey: "sk_test_brought_my_own",
    });

    const transport = paystackInitialize("sk_test_brought_my_own");
    const response = await withFetchTransport(transport, () =>
      setupWallet({
        ...RUNTIME_ROUTE_ENV,
        ENVIRONMENT: "test",
        MANAGED_SANDBOX_PROVIDERS: MANAGED_SECRET,
      }),
    );

    expect(response.status).toBe(200);
    transport.assertComplete();
  });

  it("still requires a provider account on the sandbox worker when no managed credentials are configured", async () => {
    const transport = new SequencedFetchTransport([]);
    const response = await withFetchTransport(transport, () =>
      setupWallet({ ...RUNTIME_ROUTE_ENV, ENVIRONMENT: "test" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      success: false,
      error: "No payment provider configured",
    });
    transport.assertComplete();
  });

  it("never uses managed credentials on the live worker", async () => {
    const transport = new SequencedFetchTransport([]);
    const response = await withFetchTransport(transport, () =>
      setupWallet({
        ...RUNTIME_ROUTE_ENV,
        ENVIRONMENT: "live",
        MANAGED_SANDBOX_PROVIDERS: MANAGED_SECRET,
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      success: false,
      error: "No payment provider configured",
    });
    transport.assertComplete();

    const liveRows = await businessDb.db.query.providerAccounts.findMany({
      where: and(
        eq(schema.providerAccounts.organizationId, "org_managed"),
        eq(schema.providerAccounts.environment, "live"),
      ),
    });
    expect(liveRows).toHaveLength(0);
  });
});
