import { describe, expect, it } from "vitest";
import type {
  NormalizedWebhookEvent,
  ProviderAccount,
  ProviderAdapter,
  ProviderResult,
} from "@owostack/adapters";
import { getProviderRegistry } from "../../../src/lib/providers";
import {
  type CapturedFetchRequest,
  type ExpectedFetchCall,
  SequencedFetchTransport,
  jsonResponse,
  withFetchTransport,
} from "../helpers/fetch-transport";

const requiredScenarioNames = [
  "createCustomer",
  "createPlan",
  "createCheckoutSession",
  "createSubscription",
  "cancelSubscription",
  "chargeAuthorization",
  "fetchSubscription",
] as const;

const optionalScenarioNames = [
  "createProduct",
  "createCustomerSession",
  "updatePlan",
  "changePlan",
  "refundCharge",
] as const;

type RequiredScenarioName = (typeof requiredScenarioNames)[number];
type OptionalScenarioName = (typeof optionalScenarioNames)[number];
type ScenarioName = RequiredScenarioName | OptionalScenarioName;

interface AdapterScenario {
  createTransport(): SequencedFetchTransport;
  run(adapter: ProviderAdapter, account: ProviderAccount): Promise<unknown>;
  assert(
    result: unknown,
    transport: SequencedFetchTransport,
  ): void | Promise<void>;
}

interface SignedWebhookCase {
  payload: string;
  tamperedPayload: string;
  signature: string;
  secret: string;
  headers?: Record<string, string>;
}

interface ParseWebhookCase {
  name: string;
  payload: Record<string, unknown>;
  assert(event: NormalizedWebhookEvent): void;
}

interface AdapterContractFixture {
  buildAccount(): ProviderAccount;
  buildSignedWebhook(): Promise<SignedWebhookCase>;
  parseCases: ParseWebhookCase[];
  scenarios: Partial<Record<ScenarioName, AdapterScenario>>;
}

function buildAccount(params: {
  id: string;
  providerId: string;
  displayName: string;
  credentials: Record<string, unknown>;
  environment?: "test" | "live";
}): ProviderAccount {
  const now = Date.now();
  return {
    id: params.id,
    organizationId: "org_contract_1",
    providerId: params.providerId,
    environment: params.environment ?? "test",
    displayName: params.displayName,
    credentials: params.credentials,
    metadata: null,
    createdAt: now,
    updatedAt: now,
  };
}

function expectOk<T>(result: ProviderResult<T>): T {
  expect(result.isOk()).toBe(true);
  if (result.isErr()) {
    throw new Error(
      `Expected ok result but received ${result.error.code}: ${result.error.message}`,
    );
  }
  return result.value;
}

function expectErrCode<T>(
  result: ProviderResult<T>,
  code: string,
): ProviderResult<T> {
  expect(result.isErr()).toBe(true);
  if (result.isOk()) {
    throw new Error(`Expected error result with code ${code}`);
  }
  expect(result.error.code).toBe(code);
  return result;
}

function expectJsonRequest(
  request: CapturedFetchRequest,
  bearerToken: string,
): void {
  expect(request.headers.authorization).toBe(`Bearer ${bearerToken}`);
  expect(request.headers["content-type"]).toContain("application/json");
}

function expectFormRequest(
  request: CapturedFetchRequest,
  bearerToken: string,
): void {
  expect(request.headers.authorization).toBe(`Bearer ${bearerToken}`);
  expect(request.headers["content-type"]).toContain(
    "application/x-www-form-urlencoded",
  );
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeBase64Flexible(value: string): Uint8Array | null {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const paddingNeeded = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + "=".repeat(paddingNeeded);
  if (!/^[A-Za-z0-9+/=]+$/.test(padded)) {
    return null;
  }

  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

async function signHmac(
  keyBytes: Uint8Array,
  payload: string,
  algorithm: "SHA-256" | "SHA-512",
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: algorithm },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return new Uint8Array(signature);
}

async function signHexHmac(
  secret: string,
  payload: string,
  algorithm: "SHA-256" | "SHA-512",
): Promise<string> {
  const signature = await signHmac(
    new TextEncoder().encode(secret),
    payload,
    algorithm,
  );
  return Array.from(signature)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function decodeStandardWebhookSecret(secret: string): Uint8Array {
  const stripped = secret.startsWith("whsec_")
    ? secret.slice(6)
    : secret.startsWith("polar_whs_")
      ? secret.slice(10)
      : secret;

  const decoded = decodeBase64Flexible(stripped);
  return decoded ?? new TextEncoder().encode(stripped);
}

async function buildStandardWebhookSignature(params: {
  secret: string;
  payload: string;
  webhookId: string;
  webhookTimestamp: string;
}): Promise<string> {
  const signature = await signHmac(
    decodeStandardWebhookSecret(params.secret),
    `${params.webhookId}.${params.webhookTimestamp}.${params.payload}`,
    "SHA-256",
  );
  return `v1,${toBase64(signature)}`;
}

async function buildStripeSignature(
  secret: string,
  payload: string,
  timestamp: string,
): Promise<string> {
  const signature = await signHexHmac(
    secret,
    `${timestamp}.${payload}`,
    "SHA-256",
  );
  return `t=${timestamp},v1=${signature}`;
}

function createTransport(expectedCalls: ExpectedFetchCall[]) {
  return new SequencedFetchTransport(expectedCalls);
}

async function runScenario(
  adapter: ProviderAdapter,
  account: ProviderAccount,
  scenario: AdapterScenario,
) {
  const transport = scenario.createTransport();
  const result = await withFetchTransport(transport, async () => {
    return await scenario.run(adapter, account);
  });
  transport.assertComplete();
  await scenario.assert(result, transport);
}

async function withMutedConsoleError<T>(run: () => Promise<T>): Promise<T> {
  const original = console.error;
  console.error = () => {};

  try {
    return await run();
  } finally {
    console.error = original;
  }
}

function createPaystackFixture(): AdapterContractFixture {
  const secretKey = "sk_paystack_contract";

  return {
    buildAccount() {
      return buildAccount({
        id: "acct_paystack_contract",
        providerId: "paystack",
        displayName: "Paystack Contract",
        credentials: {
          secretKey,
        },
      });
    },
    async buildSignedWebhook() {
      const payload = JSON.stringify({
        event: "charge.success",
        data: {
          amount: 3000000,
          currency: "NGN",
          reference: "renew_ref_contract",
          paid_at: "2026-03-06T17:00:15.000Z",
        },
      });
      const secret = "paystack_contract_webhook_secret";
      return {
        payload,
        tamperedPayload: `${payload} `,
        signature: await signHexHmac(secret, payload, "SHA-512"),
        secret,
      };
    },
    parseCases: [
      {
        name: "normalizes renewal charge.success invoice details",
        payload: {
          event: "charge.success",
          data: {
            amount: 3000000,
            currency: "NGN",
            reference: "renew_ref_1",
            paid_at: "2026-03-06T17:00:15.000Z",
            metadata: { invoice_action: "update" },
            customer: {
              email: "customerx12@example.com",
              customer_code: "CUS_41uuf7daarvgkkw",
            },
            subscription: {
              subscription_code: "SUB_renew_1",
              current_period_start: "2026-03-06T17:00:15.000Z",
              next_payment_date: "2026-04-06T17:00:15.000Z",
              plan: {
                plan_code: "PLN_mfm3iy6fyattbda",
              },
            },
          },
        },
        assert(event) {
          expect(event.provider).toBe("paystack");
          expect(event.type).toBe("charge.success");
          expect(event.subscription?.providerCode).toBe("SUB_renew_1");
          expect(event.subscription?.startDate).toBe(
            "2026-03-06T17:00:15.000Z",
          );
          expect(event.subscription?.nextPaymentDate).toBe(
            "2026-04-06T17:00:15.000Z",
          );
          expect(event.plan?.providerPlanCode).toBe("PLN_mfm3iy6fyattbda");
        },
      },
      {
        name: "normalizes invoice payment failures",
        payload: {
          event: "invoice.payment_failed",
          data: {
            currency: "NGN",
            invoice_code: "INV_123",
            customer: {
              email: "customerx12@example.com",
              customer_code: "CUS_41uuf7daarvgkkw",
            },
            subscription: {
              subscription_code: "SUB_fail_1",
            },
          },
        },
        assert(event) {
          expect(event.type).toBe("charge.failed");
          expect(event.subscription?.providerCode).toBe("SUB_fail_1");
        },
      },
      {
        name: "uses invoice period_start when current_period_start is absent",
        payload: {
          event: "charge.success",
          data: {
            amount: 3000000,
            currency: "NGN",
            reference: "renew_ref_2",
            paid_at: "2026-03-06T17:00:15.000Z",
            period_start: "2026-03-06T00:00:00.000Z",
            customer: {
              email: "customerx12@example.com",
              customer_code: "CUS_41uuf7daarvgkkw",
            },
            subscription: {
              subscription_code: "SUB_renew_2",
              next_payment_date: "2026-04-06T17:00:15.000Z",
              plan: {
                plan_code: "PLN_mfm3iy6fyattbda",
              },
            },
          },
        },
        assert(event) {
          expect(event.subscription?.providerCode).toBe("SUB_renew_2");
          expect(event.subscription?.startDate).toBe(
            "2026-03-06T00:00:00.000Z",
          );
          expect(event.subscription?.nextPaymentDate).toBe(
            "2026-04-06T17:00:15.000Z",
          );
        },
      },
    ],
    scenarios: {
      createCustomer: {
        createTransport() {
          return createTransport([
            {
              method: "POST",
              origin: "https://api.paystack.co",
              path: "/customer",
              assert(request) {
                expectJsonRequest(request, secretKey);
                expect(request.json<Record<string, unknown>>()).toEqual({
                  email: "paystack-customer@example.com",
                  first_name: "Amina",
                  metadata: {
                    source: "contract",
                  },
                });
              },
              respond: jsonResponse({
                status: true,
                message: "Customer created",
                data: {
                  customer_code: "CUS_paystack_1",
                  email: "paystack-customer@example.com",
                },
              }),
            },
          ]);
        },
        async run(adapter, account) {
          return adapter.createCustomer({
            email: "paystack-customer@example.com",
            name: "Amina",
            metadata: { source: "contract" },
            environment: "test",
            account,
          });
        },
        assert(result) {
          const value = expectOk(result as ProviderResult<any>);
          expect(value).toEqual({
            id: "CUS_paystack_1",
            email: "paystack-customer@example.com",
            metadata: { source: "contract" },
          });
        },
      },
      createPlan: {
        createTransport() {
          return createTransport([
            {
              method: "POST",
              origin: "https://api.paystack.co",
              path: "/plan",
              assert(request) {
                expectJsonRequest(request, secretKey);
                expect(request.json<Record<string, unknown>>()).toEqual({
                  name: "Starter",
                  amount: 5000,
                  interval: "monthly",
                  description: "Starter plan",
                  currency: "NGN",
                });
              },
              respond: jsonResponse({
                status: true,
                message: "Plan created",
                data: {
                  plan_code: "PLN_paystack_1",
                },
              }),
            },
          ]);
        },
        async run(adapter, account) {
          return adapter.createPlan({
            name: "Starter",
            amount: 5000,
            interval: "monthly",
            currency: "NGN",
            description: "Starter plan",
            environment: "test",
            account,
          });
        },
        assert(result) {
          expect(expectOk(result as ProviderResult<any>)).toEqual({
            id: "PLN_paystack_1",
            metadata: {},
          });
        },
      },
      createCheckoutSession: {
        createTransport() {
          return createTransport([
            {
              method: "POST",
              origin: "https://api.paystack.co",
              path: "/transaction/initialize",
              assert(request) {
                expectJsonRequest(request, secretKey);
                expect(request.json<Record<string, unknown>>()).toEqual({
                  email: "paystack-checkout@example.com",
                  amount: "5000",
                  currency: "NGN",
                  reference: undefined,
                  callback_url: "https://example.com/paystack/success",
                  plan: "PLN_paystack_1",
                  metadata: {
                    type: "plan_checkout",
                    plan_id: "plan_local_1",
                  },
                  channels: ["card"],
                });
              },
              respond: jsonResponse({
                status: true,
                message: "Initialized",
                data: {
                  authorization_url: "https://checkout.paystack.com/pay/ref_1",
                  access_code: "ACCESS_paystack_1",
                  reference: "ref_paystack_1",
                },
              }),
            },
          ]);
        },
        async run(adapter, account) {
          return adapter.createCheckoutSession({
            customer: {
              id: "CUS_paystack_1",
              email: "paystack-checkout@example.com",
            },
            plan: { id: "PLN_paystack_1" },
            amount: 5000,
            currency: "NGN",
            callbackUrl: "https://example.com/paystack/success",
            metadata: {
              type: "plan_checkout",
              plan_id: "plan_local_1",
            },
            channels: ["card"],
            environment: "test",
            account,
          });
        },
        assert(result) {
          expect(expectOk(result as ProviderResult<any>)).toEqual({
            url: "https://checkout.paystack.com/pay/ref_1",
            reference: "ref_paystack_1",
            accessCode: "ACCESS_paystack_1",
          });
        },
      },
      createSubscription: {
        createTransport() {
          return createTransport([
            {
              method: "POST",
              origin: "https://api.paystack.co",
              path: "/subscription",
              assert(request) {
                expectJsonRequest(request, secretKey);
                expect(request.json<Record<string, unknown>>()).toEqual({
                  customer: "CUS_paystack_1",
                  plan: "PLN_paystack_1",
                  authorization: "AUTH_paystack_1",
                  start_date: "2027-05-01T00:00:00.000Z",
                });
              },
              respond: jsonResponse({
                status: true,
                message: "Subscription created",
                data: {
                  subscription_code: "SUB_paystack_1",
                  status: "active",
                },
              }),
            },
          ]);
        },
        async run(adapter, account) {
          return adapter.createSubscription({
            customer: {
              id: "CUS_paystack_1",
              email: "paystack-subscription@example.com",
            },
            plan: { id: "PLN_paystack_1" },
            authorizationCode: "AUTH_paystack_1",
            startDate: "2027-05-01T00:00:00.000Z",
            metadata: { origin: "contract" },
            environment: "test",
            account,
          });
        },
        assert(result) {
          expect(expectOk(result as ProviderResult<any>)).toEqual({
            id: "SUB_paystack_1",
            status: "active",
            metadata: { origin: "contract" },
          });
        },
      },
      cancelSubscription: {
        createTransport() {
          return createTransport([
            {
              method: "GET",
              origin: "https://api.paystack.co",
              path: "/subscription/SUB_paystack_1",
              assert(request) {
                expectJsonRequest(request, secretKey);
              },
              respond: jsonResponse({
                status: true,
                message: "Fetched",
                data: {
                  email_token: "email_token_1",
                  status: "active",
                  subscription_code: "SUB_paystack_1",
                  plan: { plan_code: "PLN_paystack_1" },
                  createdAt: "2026-03-01T00:00:00.000Z",
                  next_payment_date: "2026-04-01T00:00:00.000Z",
                },
              }),
            },
            {
              method: "POST",
              origin: "https://api.paystack.co",
              path: "/subscription/disable",
              assert(request) {
                expectJsonRequest(request, secretKey);
                expect(request.json<Record<string, unknown>>()).toEqual({
                  code: "SUB_paystack_1",
                  token: "email_token_1",
                });
              },
              respond: jsonResponse({
                status: true,
                message: "Disabled",
                data: { status: true },
              }),
            },
          ]);
        },
        async run(adapter, account) {
          return adapter.cancelSubscription({
            subscription: { id: "SUB_paystack_1", status: "active" },
            environment: "test",
            account,
          });
        },
        assert(result) {
          expect(expectOk(result as ProviderResult<any>)).toEqual({
            canceled: true,
          });
        },
      },
      chargeAuthorization: {
        createTransport() {
          return createTransport([
            {
              method: "POST",
              origin: "https://api.paystack.co",
              path: "/transaction/charge_authorization",
              assert(request) {
                expectJsonRequest(request, secretKey);
                expect(request.json<Record<string, unknown>>()).toEqual({
                  authorization_code: "AUTH_paystack_1",
                  email: "paystack-charge@example.com",
                  amount: "2500",
                  currency: "NGN",
                  reference: "inv_attempt_1",
                  metadata: {
                    invoice_id: "inv_1",
                  },
                });
              },
              respond: jsonResponse({
                status: true,
                message: "Charged",
                data: {
                  reference: "charge_ref_paystack_1",
                },
              }),
            },
          ]);
        },
        async run(adapter, account) {
          return adapter.chargeAuthorization({
            customer: {
              id: "CUS_paystack_1",
              email: "paystack-charge@example.com",
            },
            authorizationCode: "AUTH_paystack_1",
            amount: 2500,
            currency: "NGN",
            reference: "inv_attempt_1",
            metadata: { invoice_id: "inv_1" },
            environment: "test",
            account,
          });
        },
        assert(result) {
          expect(expectOk(result as ProviderResult<any>)).toEqual({
            reference: "charge_ref_paystack_1",
          });
        },
      },
      fetchSubscription: {
        createTransport() {
          return createTransport([
            {
              method: "GET",
              origin: "https://api.paystack.co",
              path: "/subscription/SUB_paystack_1",
              assert(request) {
                expectJsonRequest(request, secretKey);
              },
              respond: jsonResponse({
                status: true,
                message: "Fetched",
                data: {
                  email_token: "email_token_1",
                  status: "active",
                  subscription_code: "SUB_paystack_1",
                  plan: { plan_code: "PLN_paystack_1" },
                  createdAt: "2026-03-06T17:00:15.000Z",
                  next_payment_date: "2026-04-06T17:00:15.000Z",
                },
              }),
            },
          ]);
        },
        async run(adapter, account) {
          return adapter.fetchSubscription({
            subscriptionId: "SUB_paystack_1",
            environment: "test",
            account,
          });
        },
        assert(result) {
          expect(expectOk(result as ProviderResult<any>)).toEqual({
            id: "SUB_paystack_1",
            status: "active",
            planCode: "PLN_paystack_1",
            startDate: "2026-03-06T17:00:15.000Z",
            nextPaymentDate: "2026-04-06T17:00:15.000Z",
            cancelToken: "email_token_1",
            metadata: {},
          });
        },
      },
      updatePlan: {
        createTransport() {
          return createTransport([
            {
              method: "PUT",
              origin: "https://api.paystack.co",
              path: "/plan/PLN_paystack_1",
              assert(request) {
                expectJsonRequest(request, secretKey);
                expect(request.json<Record<string, unknown>>()).toEqual({
                  name: "Starter Plus",
                  amount: 6500,
                  interval: "monthly",
                  currency: "NGN",
                  description: "Updated starter plan",
                });
              },
              respond: jsonResponse({
                status: true,
                message: "Updated",
                data: { updated: true },
              }),
            },
          ]);
        },
        async run(adapter, account) {
          return adapter.updatePlan?.({
            planId: "PLN_paystack_1",
            name: "Starter Plus",
            amount: 6500,
            interval: "monthly",
            currency: "NGN",
            description: "Updated starter plan",
            environment: "test",
            account,
          });
        },
        assert(result) {
          expect(expectOk(result as ProviderResult<any>)).toEqual({
            updated: true,
          });
        },
      },
      refundCharge: {
        createTransport() {
          return createTransport([
            {
              method: "POST",
              origin: "https://api.paystack.co",
              path: "/refund",
              assert(request) {
                expectJsonRequest(request, secretKey);
                expect(request.json<Record<string, unknown>>()).toEqual({
                  transaction: "charge_ref_paystack_1",
                  amount: 1250,
                  currency: "NGN",
                  merchant_note: "duplicate charge",
                });
              },
              respond: jsonResponse({
                status: true,
                message: "Refunded",
                data: {
                  status: "success",
                  transaction: 42,
                  id: 7,
                },
              }),
            },
          ]);
        },
        async run(adapter, account) {
          return adapter.refundCharge?.({
            reference: "charge_ref_paystack_1",
            amount: 1250,
            currency: "NGN",
            reason: "duplicate charge",
            environment: "test",
            account,
          });
        },
        assert(result) {
          expect(expectOk(result as ProviderResult<any>)).toEqual({
            refunded: true,
            reference: "charge_ref_paystack_1",
          });
        },
      },
    },
  };
}

function createDodoFixture(): AdapterContractFixture {
  const secretKey = "dodo_contract_key";

  return {
    buildAccount() {
      return buildAccount({
        id: "acct_dodo_contract",
        providerId: "dodopayments",
        displayName: "Dodo Contract",
        credentials: {
          secretKey,
        },
      });
    },
    async buildSignedWebhook() {
      const payload = JSON.stringify({
        type: "subscription.active",
        data: {
          subscription_id: "sub_dodo_contract",
          customer: {
            customer_id: "cust_dodo_contract",
            email: "buyer@example.com",
          },
        },
      });
      const webhookId = "dodo-contract-webhook-id";
      const webhookTimestamp = String(Math.floor(Date.now() / 1000));
      const secret = `whsec_${toBase64(
        new TextEncoder().encode("dodo_contract_secret"),
      )}`;
      return {
        payload,
        tamperedPayload: `${payload}\n`,
        signature: await buildStandardWebhookSignature({
          secret,
          payload,
          webhookId,
          webhookTimestamp,
        }),
        secret,
        headers: {
          "webhook-id": webhookId,
          "webhook-timestamp": webhookTimestamp,
          "webhook-signature": await buildStandardWebhookSignature({
            secret,
            payload,
            webhookId,
            webhookTimestamp,
          }),
        },
      };
    },
    parseCases: [
      {
        name: "maps active subscription billing dates",
        payload: {
          type: "subscription.active",
          data: {
            subscription_id: "sub_dodo_123",
            customer: {
              customer_id: "cust_dodo_123",
              email: "buyer@example.com",
            },
            product_id: "prod_monthly_123",
            status: "active",
            previous_billing_date: "2026-03-11T16:20:29.000Z",
            next_billing_date: "2026-04-11T16:20:29.000Z",
            created_at: "2026-03-08T16:20:29.000Z",
            metadata: {
              is_trial: true,
              trial_ends_at: "2026-03-11T16:20:29.000Z",
            },
          },
        },
        assert(event) {
          expect(event.provider).toBe("dodopayments");
          expect(event.type).toBe("subscription.active");
          expect(event.subscription?.startDate).toBe(
            "2026-03-11T16:20:29.000Z",
          );
          expect(event.subscription?.nextPaymentDate).toBe(
            "2026-04-11T16:20:29.000Z",
          );
          expect(event.subscription?.trialEndDate).toBe(
            "2026-03-11T16:20:29.000Z",
          );
        },
      },
      {
        name: "maps cancel-at-next-billing updates to subscription.not_renew",
        payload: {
          type: "subscription.updated",
          data: {
            subscription_id: "sub_dodo_123",
            customer: {
              customer_id: "cust_dodo_123",
              email: "buyer@example.com",
            },
            product_id: "prod_monthly_123",
            status: "active",
            cancel_at_next_billing_date: true,
            previous_billing_date: "2026-03-11T16:20:29.000Z",
            next_billing_date: "2026-04-11T16:20:29.000Z",
          },
        },
        assert(event) {
          expect(event.type).toBe("subscription.not_renew");
          expect(event.subscription?.startDate).toBe(
            "2026-03-11T16:20:29.000Z",
          );
          expect(event.subscription?.nextPaymentDate).toBe(
            "2026-04-11T16:20:29.000Z",
          );
        },
      },
      {
        name: "maps on_hold updates to subscription.past_due",
        payload: {
          type: "subscription.updated",
          data: {
            subscription_id: "sub_dodo_123",
            customer: {
              customer_id: "cust_dodo_123",
              email: "buyer@example.com",
            },
            product_id: "prod_monthly_123",
            status: "on_hold",
            previous_billing_date: "2026-03-11T16:20:29.000Z",
            next_billing_date: "2026-04-11T16:20:29.000Z",
          },
        },
        assert(event) {
          expect(event.type).toBe("subscription.past_due");
          expect(event.subscription?.status).toBe("on_hold");
        },
      },
    ],
    scenarios: {
      createCustomer: {
        createTransport() {
          return createTransport([
            {
              method: "POST",
              origin: "https://test.dodopayments.com",
              path: "/customers",
              assert(request) {
                expectJsonRequest(request, secretKey);
                expect(request.json<Record<string, unknown>>()).toEqual({
                  email: "dodo-customer@example.com",
                  name: "Dodo Customer",
                  metadata: {
                    source: "contract",
                    retries: "2",
                  },
                });
              },
              respond: jsonResponse({
                customer_id: "cust_dodo_1",
                email: "dodo-customer@example.com",
                name: "Dodo Customer",
              }),
            },
          ]);
        },
        async run(adapter, account) {
          return adapter.createCustomer({
            email: "dodo-customer@example.com",
            name: "Dodo Customer",
            metadata: {
              source: "contract",
              retries: 2,
            },
            environment: "test",
            account,
          });
        },
        assert(result) {
          expect(expectOk(result as ProviderResult<any>)).toEqual({
            id: "cust_dodo_1",
            email: "dodo-customer@example.com",
            metadata: {
              source: "contract",
              retries: 2,
            },
          });
        },
      },
      createProduct: {
        createTransport() {
          return createTransport([
            {
              method: "POST",
              origin: "https://test.dodopayments.com",
              path: "/products",
              assert(request) {
                expectJsonRequest(request, secretKey);
                expect(request.json<Record<string, any>>()).toEqual({
                  name: "Credit Pack",
                  description: "One-time credits",
                  price: {
                    currency: "USD",
                    discount: 0,
                    purchasing_power_parity: false,
                    price: 2000,
                    type: "one_time_price",
                  },
                  tax_category: "digital_products",
                });
              },
              respond: jsonResponse({
                product_id: "prod_dodo_credit_1",
                price: { currency: "USD", price: 2000 },
              }),
            },
          ]);
        },
        async run(adapter, account) {
          return adapter.createProduct?.({
            name: "Credit Pack",
            description: "One-time credits",
            amount: 2000,
            currency: "USD",
            environment: "test",
            account,
          });
        },
        assert(result) {
          expect(expectOk(result as ProviderResult<any>)).toEqual({
            productId: "prod_dodo_credit_1",
            priceId: "prod_dodo_credit_1",
            metadata: {},
          });
        },
      },
      createPlan: {
        createTransport() {
          return createTransport([
            {
              method: "POST",
              origin: "https://test.dodopayments.com",
              path: "/products",
              assert(request) {
                expectJsonRequest(request, secretKey);
                expect(request.json<Record<string, any>>()).toEqual({
                  name: "Pro Monthly",
                  description: "Recurring access",
                  price: {
                    currency: "USD",
                    discount: 0,
                    purchasing_power_parity: false,
                    price: 4900,
                    type: "recurring_price",
                    payment_frequency_interval: "Month",
                    payment_frequency_count: 1,
                    subscription_period_interval: "Month",
                    subscription_period_count: 1,
                  },
                  tax_category: "digital_products",
                });
              },
              respond: jsonResponse({
                product_id: "prod_dodo_plan_1",
                price: { currency: "USD", price: 4900 },
              }),
            },
          ]);
        },
        async run(adapter, account) {
          return adapter.createPlan({
            name: "Pro Monthly",
            amount: 4900,
            interval: "monthly",
            currency: "USD",
            description: "Recurring access",
            environment: "test",
            account,
          });
        },
        assert(result) {
          expect(expectOk(result as ProviderResult<any>)).toEqual({
            id: "prod_dodo_plan_1",
            metadata: {},
          });
        },
      },
      createCheckoutSession: {
        createTransport() {
          return createTransport([
            {
              method: "POST",
              origin: "https://test.dodopayments.com",
              path: "/checkouts",
              assert(request) {
                expectJsonRequest(request, secretKey);
                expect(request.json<Record<string, any>>()).toEqual({
                  product_cart: [{ product_id: "prod_dodo_plan_1", quantity: 1 }],
                  customer: {
                    email: "dodo-checkout@example.com",
                    customer_id: "cust_dodo_1",
                  },
                  return_url: "https://example.com/dodo/success",
                  metadata: {
                    type: "plan_checkout",
                    is_trial: "true",
                  },
                  subscription_data: {
                    trial_period_days: 14,
                  },
                });
              },
              respond: jsonResponse({
                session_id: "sess_dodo_checkout_1",
                checkout_url: "https://checkout.dodopayments.com/session_1",
              }),
            },
          ]);
        },
        async run(adapter, account) {
          return adapter.createCheckoutSession({
            customer: {
              id: "cust_dodo_1",
              email: "dodo-checkout@example.com",
            },
            plan: { id: "prod_dodo_plan_1" },
            amount: 4900,
            currency: "USD",
            callbackUrl: "https://example.com/dodo/success",
            metadata: {
              type: "plan_checkout",
              is_trial: true,
            },
            trialDays: 14,
            environment: "test",
            account,
          });
        },
        assert(result) {
          expect(expectOk(result as ProviderResult<any>)).toEqual({
            url: "https://checkout.dodopayments.com/session_1",
            reference: "sess_dodo_checkout_1",
            accessCode: null,
          });
        },
      },
      createSubscription: {
        createTransport() {
          return createTransport([
            {
              method: "POST",
              origin: "https://test.dodopayments.com",
              path: "/checkouts",
              assert(request) {
                expectJsonRequest(request, secretKey);
                expect(request.json<Record<string, any>>()).toEqual({
                  product_cart: [{ product_id: "prod_dodo_plan_1", quantity: 1 }],
                  customer: {
                    email: "dodo-subscription@example.com",
                    customer_id: "cust_dodo_1",
                  },
                  metadata: {
                    origin: "contract",
                  },
                });
              },
              respond: jsonResponse({
                session_id: "sess_dodo_subscription_1",
                checkout_url: "https://checkout.dodopayments.com/subscription_1",
              }),
            },
          ]);
        },
        async run(adapter, account) {
          return adapter.createSubscription({
            customer: {
              id: "cust_dodo_1",
              email: "dodo-subscription@example.com",
            },
            plan: { id: "prod_dodo_plan_1" },
            metadata: { origin: "contract" },
            environment: "test",
            account,
          });
        },
        assert(result) {
          expect(expectOk(result as ProviderResult<any>)).toEqual({
            id: "sess_dodo_subscription_1",
            status: "pending",
            metadata: {
              checkout_url:
                "https://checkout.dodopayments.com/subscription_1",
              origin: "contract",
            },
          });
        },
      },
      cancelSubscription: {
        createTransport() {
          return createTransport([
            {
              method: "PATCH",
              origin: "https://test.dodopayments.com",
              path: "/subscriptions/sub_dodo_1",
              assert(request) {
                expectJsonRequest(request, secretKey);
                expect(request.json<Record<string, unknown>>()).toEqual({
                  status: "cancelled",
                });
              },
              respond: jsonResponse({
                subscription_id: "sub_dodo_1",
                status: "cancelled",
              }),
            },
          ]);
        },
        async run(adapter, account) {
          return adapter.cancelSubscription({
            subscription: { id: "sub_dodo_1", status: "active" },
            environment: "test",
            account,
          });
        },
        assert(result) {
          expect(expectOk(result as ProviderResult<any>)).toEqual({
            canceled: true,
          });
        },
      },
      chargeAuthorization: {
        createTransport() {
          return createTransport([
            {
              method: "POST",
              origin: "https://test.dodopayments.com",
              path: "/subscriptions/sub_dodo_charge_1/charge",
              assert(request) {
                expectJsonRequest(request, secretKey);
                expect(request.json<Record<string, any>>()).toEqual({
                  product_price: 2750,
                  product_currency: "USD",
                  metadata: {
                    invoice_id: "inv_1",
                    attempt: "2",
                  },
                });
              },
              respond: jsonResponse({
                payment_id: "pay_dodo_charge_1",
              }),
            },
          ]);
        },
        async run(adapter, account) {
          return adapter.chargeAuthorization({
            customer: {
              id: "cust_dodo_1",
              email: "dodo-charge@example.com",
            },
            authorizationCode: "sub_dodo_charge_1",
            amount: 2750,
            currency: "USD",
            metadata: {
              invoice_id: "inv_1",
              attempt: 2,
            },
            environment: "test",
            account,
          });
        },
        assert(result) {
          expect(expectOk(result as ProviderResult<any>)).toEqual({
            reference: "pay_dodo_charge_1",
          });
        },
      },
      fetchSubscription: {
        createTransport() {
          return createTransport([
            {
              method: "GET",
              origin: "https://test.dodopayments.com",
              path: "/subscriptions/sub_dodo_1",
              assert(request) {
                expectJsonRequest(request, secretKey);
              },
              respond: jsonResponse({
                subscription_id: "sub_dodo_1",
                status: "active",
                product_id: "prod_dodo_plan_1",
                created_at: "2026-03-08T16:20:29.000Z",
                previous_billing_date: "2026-03-11T16:20:29.000Z",
                next_billing_date: "2026-04-11T16:20:29.000Z",
                metadata: {
                  channel: "api",
                },
              }),
            },
          ]);
        },
        async run(adapter, account) {
          return adapter.fetchSubscription({
            subscriptionId: "sub_dodo_1",
            environment: "test",
            account,
          });
        },
        assert(result) {
          expect(expectOk(result as ProviderResult<any>)).toEqual({
            id: "sub_dodo_1",
            status: "active",
            planCode: "prod_dodo_plan_1",
            startDate: "2026-03-11T16:20:29.000Z",
            nextPaymentDate: "2026-04-11T16:20:29.000Z",
            trialEndDate: undefined,
            cancelToken: undefined,
            metadata: {
              channel: "api",
            },
          });
        },
      },
      updatePlan: {
        createTransport() {
          return createTransport([
            {
              method: "PATCH",
              origin: "https://test.dodopayments.com",
              path: "/products/prod_dodo_plan_1",
              assert(request) {
                expectJsonRequest(request, secretKey);
                expect(request.json<Record<string, any>>()).toEqual({
                  name: "Pro Plus",
                  description: "Updated Dodo plan",
                  price: {
                    type: "recurring_price",
                    currency: "USD",
                    price: 5900,
                    discount: 0,
                    purchasing_power_parity: false,
                    payment_frequency_interval: "Month",
                    payment_frequency_count: 1,
                    subscription_period_interval: "Month",
                    subscription_period_count: 1,
                  },
                });
              },
              respond: jsonResponse({ updated: true }),
            },
          ]);
        },
        async run(adapter, account) {
          return adapter.updatePlan?.({
            planId: "prod_dodo_plan_1",
            name: "Pro Plus",
            amount: 5900,
            interval: "monthly",
            currency: "USD",
            description: "Updated Dodo plan",
            environment: "test",
            account,
          });
        },
        assert(result) {
          expect(expectOk(result as ProviderResult<any>)).toEqual({
            updated: true,
          });
        },
      },
      changePlan: {
        createTransport() {
          return createTransport([
            {
              method: "POST",
              origin: "https://test.dodopayments.com",
              path: "/subscriptions/sub_dodo_1/change-plan",
              assert(request) {
                expectJsonRequest(request, secretKey);
                expect(request.json<Record<string, any>>()).toEqual({
                  product_id: "prod_dodo_plan_2",
                  proration_billing_mode: "difference_immediately",
                  quantity: 3,
                  metadata: {
                    origin: "contract",
                  },
                  on_payment_failure: "prevent_change",
                });
              },
              respond: jsonResponse({}),
            },
          ]);
        },
        async run(adapter, account) {
          return adapter.changePlan?.({
            subscriptionId: "sub_dodo_1",
            newPlanId: "prod_dodo_plan_2",
            prorationMode: "difference_immediately",
            quantity: 3,
            metadata: { origin: "contract" },
            environment: "test",
            account,
          });
        },
        assert(result) {
          expect(expectOk(result as ProviderResult<any>)).toEqual({
            changed: true,
          });
        },
      },
      refundCharge: {
        createTransport() {
          return createTransport([
            {
              method: "POST",
              origin: "https://test.dodopayments.com",
              path: "/refunds",
              assert(request) {
                expectJsonRequest(request, secretKey);
                expect(request.json<Record<string, unknown>>()).toEqual({
                  payment_id: "pay_dodo_charge_1",
                  amount: 1200,
                  reason: "duplicate charge",
                });
              },
              respond: jsonResponse({
                refund_id: "refund_dodo_1",
              }),
            },
          ]);
        },
        async run(adapter, account) {
          return adapter.refundCharge?.({
            reference: "pay_dodo_charge_1",
            amount: 1200,
            reason: "duplicate charge",
            environment: "test",
            account,
          });
        },
        assert(result) {
          expect(expectOk(result as ProviderResult<any>)).toEqual({
            refunded: true,
            reference: "pay_dodo_charge_1",
          });
        },
      },
    },
  };
}

function createStripeFixture(): AdapterContractFixture {
  const secretKey = "sk_test_contract";
  const futureTrialStart = "2027-05-01T00:00:00.000Z";
  const futureTrialEndSeconds = String(
    Math.floor(Date.parse(futureTrialStart) / 1000),
  );

  return {
    buildAccount() {
      return buildAccount({
        id: "acct_stripe_contract",
        providerId: "stripe",
        displayName: "Stripe Contract",
        credentials: {
          secretKey,
        },
      });
    },
    async buildSignedWebhook() {
      const payload = JSON.stringify({
        id: "evt_contract",
        type: "payment_intent.succeeded",
        data: { object: { id: "pi_contract" } },
      });
      const timestamp = String(Math.floor(Date.now() / 1000));
      const secret = "whsec_stripe_contract";
      return {
        payload,
        tamperedPayload: `${payload} `,
        signature: await buildStripeSignature(secret, payload, timestamp),
        secret,
        headers: {
          "stripe-signature": await buildStripeSignature(
            secret,
            payload,
            timestamp,
          ),
        },
      };
    },
    parseCases: [
      {
        name: "maps native-trial checkout completion to charge.success",
        payload: {
          type: "checkout.session.completed",
          data: {
            object: {
              id: "cs_test_trial_1",
              mode: "subscription",
              payment_status: "no_payment_required",
              created: 1770057600,
              amount_total: 0,
              currency: "usd",
              customer: "cus_stripe_123",
              customer_details: {
                email: "trial@example.com",
              },
              subscription: "sub_stripe_123",
              metadata: {
                is_trial: "true",
                native_trial: "true",
                trial_ends_at: "2026-02-17T00:00:00.000Z",
                provider_plan_id: "price_monthly_123",
                plan_id: "plan_local_1",
              },
            },
          },
        },
        assert(event) {
          expect(event.provider).toBe("stripe");
          expect(event.type).toBe("charge.success");
          expect(event.subscription?.providerCode).toBe("sub_stripe_123");
          expect(event.subscription?.status).toBe("trialing");
          expect(event.subscription?.trialEndDate).toBe(
            "2026-02-17T00:00:00.000Z",
          );
          expect(event.plan?.providerPlanCode).toBe("price_monthly_123");
        },
      },
      {
        name: "maps payment intent success to a reusable authorization",
        payload: {
          type: "payment_intent.succeeded",
          data: {
            object: {
              id: "pi_test_123",
              customer: "cus_stripe_123",
              payment_method: "pm_card_visa_123",
              amount_received: 4500,
              currency: "usd",
              created: 1770057600,
              metadata: {
                type: "credit_purchase",
                checkout_unit_amount: "1500",
                checkout_price_id: "price_credit_123",
              },
              charges: {
                data: [
                  {
                    billing_details: {
                      email: "buyer@example.com",
                    },
                    payment_method_details: {
                      card: {
                        brand: "visa",
                        last4: "4242",
                        exp_month: 12,
                        exp_year: 2030,
                      },
                    },
                  },
                ],
              },
            },
          },
        },
        assert(event) {
          expect(event.type).toBe("charge.success");
          expect(event.authorization?.code).toBe("pm_card_visa_123");
          expect(event.authorization?.reusable).toBe(true);
          expect(event.authorization?.last4).toBe("4242");
          expect(event.checkout?.lineItems?.[0]).toEqual({
            priceId: "price_credit_123",
            quantity: 3,
          });
        },
      },
      {
        name: "maps cancel-at-period-end subscription updates to subscription.not_renew",
        payload: {
          type: "customer.subscription.updated",
          data: {
            object: {
              id: "sub_stripe_123",
              customer: "cus_stripe_123",
              status: "active",
              cancel_at_period_end: true,
              current_period_start: 1770057600,
              current_period_end: 1772736000,
              items: {
                data: [
                  {
                    id: "si_123",
                    price: { id: "price_monthly_123" },
                  },
                ],
              },
              metadata: {
                plan_id: "plan_local_1",
              },
            },
          },
        },
        assert(event) {
          expect(event.type).toBe("subscription.not_renew");
          expect(event.subscription?.status).toBe("pending_cancel");
          expect(event.plan?.providerPlanCode).toBe("price_monthly_123");
        },
      },
      {
        name: "maps renewal dates from subscription items when top-level dates are omitted",
        payload: {
          type: "customer.subscription.updated",
          data: {
            object: {
              id: "sub_stripe_trial_123",
              customer: "cus_stripe_123",
              status: "active",
              trial_end: 1773246029,
              billing_cycle_anchor: 1773246029,
              items: {
                data: [
                  {
                    id: "si_123",
                    current_period_start: 1773246029,
                    current_period_end: 1775924429,
                    price: { id: "price_monthly_123" },
                  },
                ],
              },
              metadata: {
                plan_id: "plan_local_1",
              },
            },
          },
        },
        assert(event) {
          expect(event.type).toBe("subscription.active");
          expect(event.subscription?.startDate).toBe(
            "2026-03-11T16:20:29.000Z",
          );
          expect(event.subscription?.nextPaymentDate).toBe(
            "2026-04-11T16:20:29.000Z",
          );
          expect(event.subscription?.trialEndDate).toBe(
            "2026-03-11T16:20:29.000Z",
          );
        },
      },
      {
        name: "maps payment_method.attached to customer.identified",
        payload: {
          type: "payment_method.attached",
          data: {
            object: {
              id: "pm_123",
              customer: "cus_stripe_123",
              billing_details: {
                email: "buyer@example.com",
              },
              card: {
                brand: "visa",
                last4: "4242",
                exp_month: 12,
                exp_year: 2030,
              },
            },
          },
        },
        assert(event) {
          expect(event.type).toBe("customer.identified");
          expect(event.customer.providerCustomerId).toBe("cus_stripe_123");
          expect(event.customer.email).toBe("buyer@example.com");
          expect(event.authorization?.code).toBe("pm_123");
          expect(event.authorization?.cardType).toBe("visa");
        },
      },
    ],
    scenarios: {
      createCustomer: {
        createTransport() {
          return createTransport([
            {
              method: "POST",
              origin: "https://api.stripe.com",
              path: "/v1/customers",
              assert(request) {
                expectFormRequest(request, secretKey);
                const body = request.form();
                expect(body.get("email")).toBe("stripe-customer@example.com");
                expect(body.get("name")).toBe("Stripe Customer");
                expect(body.get("metadata[source]")).toBe("contract");
              },
              respond: jsonResponse({
                id: "cus_contract_1",
                email: "stripe-customer@example.com",
              }),
            },
          ]);
        },
        async run(adapter, account) {
          return adapter.createCustomer({
            email: "stripe-customer@example.com",
            name: "Stripe Customer",
            metadata: {
              source: "contract",
            },
            environment: "test",
            account,
          });
        },
        assert(result) {
          expect(expectOk(result as ProviderResult<any>)).toEqual({
            id: "cus_contract_1",
            email: "stripe-customer@example.com",
            metadata: { source: "contract" },
          });
        },
      },
      createProduct: {
        createTransport() {
          return createTransport([
            {
              method: "POST",
              origin: "https://api.stripe.com",
              path: "/v1/products",
              assert(request) {
                expectFormRequest(request, secretKey);
                const body = request.form();
                expect(body.get("name")).toBe("Stripe Credits");
                expect(body.get("description")).toBe("One-time credits");
                expect(body.get("metadata[source]")).toBe("contract");
              },
              respond: jsonResponse({
                id: "prod_stripe_credit_1",
              }),
            },
            {
              method: "POST",
              origin: "https://api.stripe.com",
              path: "/v1/prices",
              assert(request) {
                expectFormRequest(request, secretKey);
                const body = request.form();
                expect(body.get("product")).toBe("prod_stripe_credit_1");
                expect(body.get("unit_amount")).toBe("2500");
                expect(body.get("currency")).toBe("usd");
                expect(body.get("metadata[source]")).toBe("contract");
              },
              respond: jsonResponse({
                id: "price_stripe_credit_1",
              }),
            },
          ]);
        },
        async run(adapter, account) {
          return adapter.createProduct?.({
            name: "Stripe Credits",
            description: "One-time credits",
            amount: 2500,
            currency: "USD",
            metadata: { source: "contract" },
            environment: "test",
            account,
          });
        },
        assert(result) {
          expect(expectOk(result as ProviderResult<any>)).toEqual({
            productId: "prod_stripe_credit_1",
            priceId: "price_stripe_credit_1",
            metadata: {
              currency: "USD",
            },
          });
        },
      },
      createPlan: {
        createTransport() {
          return createTransport([
            {
              method: "POST",
              origin: "https://api.stripe.com",
              path: "/v1/products",
              assert(request) {
                expectFormRequest(request, secretKey);
                const body = request.form();
                expect(body.get("name")).toBe("Stripe Pro");
                expect(body.get("description")).toBe("Recurring plan");
                expect(body.get("metadata[interval]")).toBe("monthly");
                expect(body.get("metadata[currency]")).toBe("USD");
              },
              respond: jsonResponse({
                id: "prod_stripe_plan_1",
              }),
            },
            {
              method: "POST",
              origin: "https://api.stripe.com",
              path: "/v1/prices",
              assert(request) {
                expectFormRequest(request, secretKey);
                const body = request.form();
                expect(body.get("product")).toBe("prod_stripe_plan_1");
                expect(body.get("unit_amount")).toBe("6500");
                expect(body.get("currency")).toBe("usd");
                expect(body.get("recurring[interval]")).toBe("month");
                expect(body.get("metadata[interval]")).toBe("monthly");
              },
              respond: jsonResponse({
                id: "price_stripe_plan_1",
              }),
            },
          ]);
        },
        async run(adapter, account) {
          return adapter.createPlan({
            name: "Stripe Pro",
            amount: 6500,
            interval: "monthly",
            currency: "USD",
            description: "Recurring plan",
            environment: "test",
            account,
          });
        },
        assert(result) {
          expect(expectOk(result as ProviderResult<any>)).toEqual({
            id: "price_stripe_plan_1",
            metadata: {
              productId: "prod_stripe_plan_1",
            },
          });
        },
      },
      createCheckoutSession: {
        createTransport() {
          return createTransport([
            {
              method: "POST",
              origin: "https://api.stripe.com",
              path: "/v1/checkout/sessions",
              assert(request) {
                expectFormRequest(request, secretKey);
                const body = request.form();
                expect(body.get("mode")).toBe("subscription");
                expect(body.get("customer")).toBe("cus_stripe_123");
                expect(body.get("line_items[0][price]")).toBe(
                  "price_stripe_plan_1",
                );
                expect(body.get("subscription_data[trial_period_days]")).toBe(
                  "14",
                );
                expect(body.get("payment_method_collection")).toBe("always");
                expect(body.get("success_url")).toBe(
                  "https://example.com/stripe/success",
                );
                expect(body.get("metadata[provider_plan_id]")).toBe(
                  "price_stripe_plan_1",
                );
              },
              respond: jsonResponse({
                id: "cs_contract_1",
                url: "https://checkout.stripe.com/c/pay/cs_contract_1",
              }),
            },
          ]);
        },
        async run(adapter, account) {
          return adapter.createCheckoutSession({
            customer: {
              id: "cus_stripe_123",
              email: "stripe-checkout@example.com",
            },
            plan: { id: "price_stripe_plan_1" },
            amount: 0,
            currency: "USD",
            callbackUrl: "https://example.com/stripe/success",
            metadata: {
              type: "plan_checkout",
              plan_id: "plan_local_1",
            },
            trialDays: 14,
            environment: "test",
            account,
          });
        },
        assert(result) {
          expect(expectOk(result as ProviderResult<any>)).toEqual({
            url: "https://checkout.stripe.com/c/pay/cs_contract_1",
            reference: "cs_contract_1",
            accessCode: null,
          });
        },
      },
      createSubscription: {
        createTransport() {
          return createTransport([
            {
              method: "POST",
              origin: "https://api.stripe.com",
              path: "/v1/customers",
              assert(request) {
                expectFormRequest(request, secretKey);
                const body = request.form();
                expect(body.get("email")).toBe("stripe-subscription@example.com");
                expect(body.get("metadata[origin]")).toBe("contract");
              },
              respond: jsonResponse({
                id: "cus_created_1",
                email: "stripe-subscription@example.com",
              }),
            },
            {
              method: "POST",
              origin: "https://api.stripe.com",
              path: "/v1/subscriptions",
              assert(request) {
                expectFormRequest(request, secretKey);
                const body = request.form();
                expect(body.get("customer")).toBe("cus_created_1");
                expect(body.get("items[0][price]")).toBe("price_stripe_plan_1");
                expect(body.get("default_payment_method")).toBe("pm_contract_1");
                expect(body.get("trial_end")).toBe(futureTrialEndSeconds);
                expect(body.get("metadata[origin]")).toBe("contract");
              },
              respond: jsonResponse({
                id: "sub_stripe_contract_1",
                status: "trialing",
              }),
            },
          ]);
        },
        async run(adapter, account) {
          return adapter.createSubscription({
            customer: {
              id: "local_customer_1",
              email: "stripe-subscription@example.com",
            },
            plan: { id: "price_stripe_plan_1" },
            authorizationCode: "pm_contract_1",
            startDate: futureTrialStart,
            metadata: { origin: "contract" },
            environment: "test",
            account,
          });
        },
        assert(result) {
          expect(expectOk(result as ProviderResult<any>)).toEqual({
            id: "sub_stripe_contract_1",
            status: "trialing",
            metadata: { origin: "contract" },
          });
        },
      },
      cancelSubscription: {
        createTransport() {
          return createTransport([
            {
              method: "DELETE",
              origin: "https://api.stripe.com",
              path: "/v1/subscriptions/sub_stripe_contract_1",
              assert(request) {
                expectFormRequest(request, secretKey);
              },
              respond: jsonResponse({
                id: "sub_stripe_contract_1",
                status: "canceled",
              }),
            },
          ]);
        },
        async run(adapter, account) {
          return adapter.cancelSubscription({
            subscription: { id: "sub_stripe_contract_1", status: "active" },
            environment: "test",
            account,
          });
        },
        assert(result) {
          expect(expectOk(result as ProviderResult<any>)).toEqual({
            canceled: true,
          });
        },
      },
      chargeAuthorization: {
        createTransport() {
          return createTransport([
            {
              method: "POST",
              origin: "https://api.stripe.com",
              path: "/v1/payment_intents",
              assert(request) {
                expectFormRequest(request, secretKey);
                expect(request.headers["idempotency-key"]).toBe(
                  "invoice_attempt_1",
                );
                const body = request.form();
                expect(body.get("amount")).toBe("2500");
                expect(body.get("currency")).toBe("usd");
                expect(body.get("customer")).toBe("cus_stripe_123");
                expect(body.get("payment_method")).toBe("pm_contract_1");
                expect(body.get("confirm")).toBe("true");
                expect(body.get("off_session")).toBe("true");
                expect(body.get("receipt_email")).toBe(
                  "stripe-charge@example.com",
                );
                expect(body.get("metadata[invoice_id]")).toBe("inv_1");
              },
              respond: jsonResponse({
                id: "pi_contract_1",
                status: "succeeded",
              }),
            },
          ]);
        },
        async run(adapter, account) {
          return adapter.chargeAuthorization({
            customer: {
              id: "cus_stripe_123",
              email: "stripe-charge@example.com",
            },
            authorizationCode: "pm_contract_1",
            amount: 2500,
            currency: "USD",
            reference: "invoice_attempt_1",
            metadata: { invoice_id: "inv_1" },
            environment: "test",
            account,
          });
        },
        assert(result) {
          expect(expectOk(result as ProviderResult<any>)).toEqual({
            reference: "pi_contract_1",
          });
        },
      },
      fetchSubscription: {
        createTransport() {
          return createTransport([
            {
              method: "GET",
              origin: "https://api.stripe.com",
              path: "/v1/subscriptions/sub_stripe_contract_1",
              assert(request) {
                expectFormRequest(request, secretKey);
              },
              respond: jsonResponse({
                id: "sub_stripe_contract_1",
                status: "active",
                current_period_start: 1773246029,
                current_period_end: 1775924429,
                items: {
                  data: [
                    {
                      id: "si_123",
                      price: {
                        id: "price_stripe_plan_1",
                      },
                    },
                  ],
                },
                metadata: {
                  channel: "api",
                },
              }),
            },
          ]);
        },
        async run(adapter, account) {
          return adapter.fetchSubscription({
            subscriptionId: "sub_stripe_contract_1",
            environment: "test",
            account,
          });
        },
        assert(result) {
          expect(expectOk(result as ProviderResult<any>)).toEqual({
            id: "sub_stripe_contract_1",
            status: "active",
            planCode: "price_stripe_plan_1",
            startDate: "2026-03-11T16:20:29.000Z",
            nextPaymentDate: "2026-04-11T16:20:29.000Z",
            cancelToken: undefined,
            metadata: {
              channel: "api",
            },
          });
        },
      },
      updatePlan: {
        createTransport() {
          return createTransport([
            {
              method: "GET",
              origin: "https://api.stripe.com",
              path: "/v1/prices/price_old_123",
              assert(request) {
                expectFormRequest(request, secretKey);
              },
              respond: jsonResponse({
                id: "price_old_123",
                product: "prod_123",
                currency: "usd",
                unit_amount: 5000,
                recurring: { interval: "month", interval_count: 1 },
                metadata: { existing: "true" },
              }),
            },
            {
              method: "POST",
              origin: "https://api.stripe.com",
              path: "/v1/prices",
              assert(request) {
                expectFormRequest(request, secretKey);
                const body = request.form();
                expect(body.get("product")).toBe("prod_123");
                expect(body.get("unit_amount")).toBe("6500");
                expect(body.get("currency")).toBe("usd");
                expect(body.get("recurring[interval]")).toBe("month");
              },
              respond: jsonResponse({
                id: "price_new_123",
              }),
            },
            {
              method: "POST",
              origin: "https://api.stripe.com",
              path: "/v1/products/prod_123",
              assert(request) {
                expectFormRequest(request, secretKey);
                const body = request.form();
                expect(body.get("name")).toBe("Pro");
                expect(body.get("description")).toBe("Updated description");
                expect(body.get("default_price")).toBe("price_new_123");
              },
              respond: jsonResponse({
                id: "prod_123",
              }),
            },
            {
              method: "POST",
              origin: "https://api.stripe.com",
              path: "/v1/prices/price_old_123",
              assert(request) {
                expectFormRequest(request, secretKey);
                expect(request.form().get("active")).toBe("false");
              },
              respond: jsonResponse({
                id: "price_old_123",
                active: false,
              }),
            },
          ]);
        },
        async run(adapter, account) {
          return adapter.updatePlan?.({
            planId: "price_old_123",
            name: "Pro",
            amount: 6500,
            interval: "monthly",
            currency: "USD",
            description: "Updated description",
            environment: "test",
            account,
          });
        },
        assert(result) {
          expect(expectOk(result as ProviderResult<any>)).toEqual({
            updated: true,
            nextPlanId: "price_new_123",
            metadata: {
              productId: "prod_123",
            },
          });
        },
      },
      changePlan: {
        createTransport() {
          return createTransport([
            {
              method: "GET",
              origin: "https://api.stripe.com",
              path: "/v1/subscriptions/sub_stripe_contract_1",
              assert(request) {
                expectFormRequest(request, secretKey);
              },
              respond: jsonResponse({
                id: "sub_stripe_contract_1",
                items: {
                  data: [
                    {
                      id: "si_123",
                      price: { id: "price_old_123" },
                    },
                  ],
                },
              }),
            },
            {
              method: "POST",
              origin: "https://api.stripe.com",
              path: "/v1/subscriptions/sub_stripe_contract_1",
              assert(request) {
                expectFormRequest(request, secretKey);
                const body = request.form();
                expect(body.get("items[0][id]")).toBe("si_123");
                expect(body.get("items[0][price]")).toBe("price_new_123");
                expect(body.get("items[0][quantity]")).toBe("4");
                expect(body.get("proration_behavior")).toBe("always_invoice");
                expect(body.get("cancel_at_period_end")).toBe("false");
                expect(body.get("metadata[origin]")).toBe("contract");
              },
              respond: jsonResponse({
                id: "sub_stripe_contract_1",
              }),
            },
          ]);
        },
        async run(adapter, account) {
          return adapter.changePlan?.({
            subscriptionId: "sub_stripe_contract_1",
            newPlanId: "price_new_123",
            prorationMode: "full_immediately",
            quantity: 4,
            metadata: { origin: "contract" },
            environment: "test",
            account,
          });
        },
        assert(result) {
          expect(expectOk(result as ProviderResult<any>)).toEqual({
            changed: true,
          });
        },
      },
      refundCharge: {
        createTransport() {
          return createTransport([
            {
              method: "POST",
              origin: "https://api.stripe.com",
              path: "/v1/refunds",
              assert(request) {
                expectFormRequest(request, secretKey);
                const body = request.form();
                expect(body.get("payment_intent")).toBe("pi_contract_1");
                expect(body.get("amount")).toBe("1000");
                expect(body.get("reason")).toBe("requested_by_customer");
                expect(body.get("metadata[refund_reason]")).toBe(
                  "duplicate charge",
                );
              },
              respond: jsonResponse({
                id: "re_contract_1",
                status: "succeeded",
              }),
            },
          ]);
        },
        async run(adapter, account) {
          return adapter.refundCharge?.({
            reference: "pi_contract_1",
            amount: 1000,
            reason: "duplicate charge",
            environment: "test",
            account,
          });
        },
        assert(result) {
          expect(expectOk(result as ProviderResult<any>)).toEqual({
            refunded: true,
            reference: "re_contract_1",
          });
        },
      },
    },
  };
}

function createPolarFixture(): AdapterContractFixture {
  const secretKey = "polar_test_token";

  return {
    buildAccount() {
      return buildAccount({
        id: "acct_polar_contract",
        providerId: "polar",
        displayName: "Polar Contract",
        credentials: {
          secretKey,
        },
      });
    },
    async buildSignedWebhook() {
      const payload = JSON.stringify({
        type: "order.paid",
        data: {
          id: "ord_contract_1",
          customer: {
            id: "cus_contract_1",
            email: "buyer@example.com",
          },
        },
      });
      const webhookId = "327a3073-eb31-497d-8a3c-c77c6556a4c9";
      const webhookTimestamp = String(Math.floor(Date.now() / 1000));
      const secretBytes = new TextEncoder().encode(
        "0123456789abcdef0123456789abcdef",
      );
      const secret = `polar_whs_${toBase64Url(secretBytes)}`;
      return {
        payload,
        tamperedPayload: payload.replace("ord_contract_1", "ord_contract_2"),
        signature: await buildStandardWebhookSignature({
          secret,
          payload,
          webhookId,
          webhookTimestamp,
        }),
        secret,
        headers: {
          "webhook-id": webhookId,
          "webhook-timestamp": webhookTimestamp,
          "webhook-signature": await buildStandardWebhookSignature({
            secret,
            payload,
            webhookId,
            webhookTimestamp,
          }),
        },
      };
    },
    parseCases: [
      {
        name: "maps subscription.canceled to subscription.not_renew",
        payload: {
          type: "subscription.canceled",
          data: {
            id: "sub_1",
            status: "canceled",
            customer: { id: "cus_1", email: "alice@example.com" },
            product: { id: "prod_1" },
            current_period_end: "2026-03-01T00:00:00Z",
          },
        },
        assert(event) {
          expect(event.provider).toBe("polar");
          expect(event.type).toBe("subscription.not_renew");
          expect(event.subscription?.status).toBe("pending_cancel");
        },
      },
      {
        name: "maps cancel_at_period_end updates to subscription.not_renew",
        payload: {
          type: "subscription.updated",
          data: {
            id: "sub_2",
            status: "active",
            cancel_at_period_end: true,
            customer: { id: "cus_2", email: "bob@example.com" },
            product: { id: "prod_2" },
            current_period_end: "2026-03-10T00:00:00Z",
          },
        },
        assert(event) {
          expect(event.type).toBe("subscription.not_renew");
          expect(event.subscription?.status).toBe("pending_cancel");
        },
      },
      {
        name: "maps subscription.revoked to immediate cancellation",
        payload: {
          type: "subscription.revoked",
          data: {
            id: "sub_3",
            status: "unpaid",
            customer: { id: "cus_3", email: "charlie@example.com" },
            product: { id: "prod_3" },
          },
        },
        assert(event) {
          expect(event.type).toBe("subscription.canceled");
          expect(event.subscription?.status).toBe("canceled");
        },
      },
    ],
    scenarios: {
      createCustomer: {
        createTransport() {
          return createTransport([
            {
              method: "POST",
              origin: "https://sandbox-api.polar.sh",
              path: "/v1/customers",
              assert(request) {
                expectJsonRequest(request, secretKey);
                expect(request.json<Record<string, any>>()).toEqual({
                  email: "polar-customer@example.com",
                  name: "Polar Customer",
                  metadata: {
                    source: "contract",
                  },
                });
              },
              respond: jsonResponse({
                id: "cus_polar_1",
                email: "polar-customer@example.com",
              }),
            },
          ]);
        },
        async run(adapter, account) {
          return adapter.createCustomer({
            email: "polar-customer@example.com",
            name: "Polar Customer",
            metadata: { source: "contract" },
            environment: "test",
            account,
          });
        },
        assert(result) {
          expect(expectOk(result as ProviderResult<any>)).toEqual({
            id: "cus_polar_1",
            email: "polar-customer@example.com",
            metadata: { source: "contract" },
          });
        },
      },
      createCustomerSession: {
        createTransport() {
          return createTransport([
            {
              method: "POST",
              origin: "https://sandbox-api.polar.sh",
              path: "/v1/customer-sessions",
              assert(request) {
                expectJsonRequest(request, secretKey);
                expect(request.json<Record<string, any>>()).toEqual({
                  customer_id: "cus_polar_1",
                  metadata: {
                    type: "card_setup",
                  },
                });
              },
              respond: jsonResponse({
                token: "cssn_contract_1",
                customer_portal_url: "https://polar.sh/customer-portal/test",
              }),
            },
          ]);
        },
        async run(adapter, account) {
          return adapter.createCustomerSession?.({
            customer: {
              id: "cus_polar_1",
              email: "polar-customer@example.com",
            },
            metadata: { type: "card_setup" },
            environment: "test",
            account,
          });
        },
        assert(result) {
          expect(expectOk(result as ProviderResult<any>)).toEqual({
            url: "https://polar.sh/customer-portal/test",
            token: "cssn_contract_1",
          });
        },
      },
      createProduct: {
        createTransport() {
          return createTransport([
            {
              method: "POST",
              origin: "https://sandbox-api.polar.sh",
              path: "/v1/products",
              assert(request) {
                expectJsonRequest(request, secretKey);
                expect(request.json<Record<string, any>>()).toEqual({
                  name: "Polar Credits",
                  description: "One-time credits",
                  prices: [
                    {
                      amount_type: "fixed",
                      price_amount: 2400,
                      price_currency: "usd",
                    },
                  ],
                  metadata: {
                    source: "contract",
                  },
                });
              },
              respond: jsonResponse({
                id: "prod_polar_credit_1",
              }),
            },
          ]);
        },
        async run(adapter, account) {
          return adapter.createProduct?.({
            name: "Polar Credits",
            description: "One-time credits",
            amount: 2400,
            currency: "USD",
            metadata: { source: "contract" },
            environment: "test",
            account,
          });
        },
        assert(result) {
          expect(expectOk(result as ProviderResult<any>)).toEqual({
            productId: "prod_polar_credit_1",
            priceId: "prod_polar_credit_1",
            metadata: {},
          });
        },
      },
      createPlan: {
        createTransport() {
          return createTransport([
            {
              method: "POST",
              origin: "https://sandbox-api.polar.sh",
              path: "/v1/products",
              assert(request) {
                expectJsonRequest(request, secretKey);
                expect(request.json<Record<string, any>>()).toEqual({
                  name: "Polar Pro",
                  description: "Recurring plan",
                  recurring_interval: "month",
                  recurring_interval_count: 1,
                  prices: [
                    {
                      amount_type: "fixed",
                      price_amount: 5200,
                      price_currency: "usd",
                    },
                  ],
                });
              },
              respond: jsonResponse({
                id: "prod_polar_plan_1",
              }),
            },
          ]);
        },
        async run(adapter, account) {
          return adapter.createPlan({
            name: "Polar Pro",
            amount: 5200,
            interval: "monthly",
            currency: "USD",
            description: "Recurring plan",
            environment: "test",
            account,
          });
        },
        assert(result) {
          expect(expectOk(result as ProviderResult<any>)).toEqual({
            id: "prod_polar_plan_1",
            metadata: {},
          });
        },
      },
      createCheckoutSession: {
        createTransport() {
          return createTransport([
            {
              method: "POST",
              origin: "https://sandbox-api.polar.sh",
              path: "/v1/checkouts/",
              assert(request) {
                expectJsonRequest(request, secretKey);
                expect(request.json<Record<string, any>>()).toEqual({
                  products: ["prod_polar_plan_1"],
                  customer_email: "polar-checkout@example.com",
                  metadata: {
                    type: "plan_checkout",
                  },
                  success_url: "https://example.com/polar/success",
                  external_customer_id: "local_customer_uuid",
                  allow_trial: true,
                  trial_interval: "day",
                  trial_interval_count: 14,
                });
              },
              respond: jsonResponse({
                id: "chk_polar_1",
                url: "https://checkout.polar.sh/checkout/chk_polar_1",
              }),
            },
          ]);
        },
        async run(adapter, account) {
          return adapter.createCheckoutSession({
            customer: {
              id: "local_customer_uuid",
              email: "polar-checkout@example.com",
            },
            plan: { id: "prod_polar_plan_1" },
            amount: 5200,
            currency: "USD",
            callbackUrl: "https://example.com/polar/success",
            metadata: { type: "plan_checkout" },
            trialDays: 14,
            environment: "test",
            account,
          });
        },
        assert(result) {
          expect(expectOk(result as ProviderResult<any>)).toEqual({
            url: "https://checkout.polar.sh/checkout/chk_polar_1",
            reference: "chk_polar_1",
            accessCode: null,
          });
        },
      },
      createSubscription: {
        createTransport() {
          return createTransport([
            {
              method: "POST",
              origin: "https://sandbox-api.polar.sh",
              path: "/v1/checkouts/",
              assert(request) {
                expectJsonRequest(request, secretKey);
                expect(request.json<Record<string, any>>()).toEqual({
                  products: ["prod_polar_plan_1"],
                  customer_email: "polar-subscription@example.com",
                  metadata: {
                    origin: "contract",
                  },
                  external_customer_id: "local_customer_1",
                });
              },
              respond: jsonResponse({
                id: "chk_polar_subscription_1",
                url: "https://checkout.polar.sh/checkout/chk_polar_subscription_1",
              }),
            },
          ]);
        },
        async run(adapter, account) {
          return adapter.createSubscription({
            customer: {
              id: "local_customer_1",
              email: "polar-subscription@example.com",
            },
            plan: { id: "prod_polar_plan_1" },
            metadata: { origin: "contract" },
            environment: "test",
            account,
          });
        },
        assert(result) {
          expect(expectOk(result as ProviderResult<any>)).toEqual({
            id: "chk_polar_subscription_1",
            status: "pending",
            metadata: {
              checkout_url:
                "https://checkout.polar.sh/checkout/chk_polar_subscription_1",
              origin: "contract",
            },
          });
        },
      },
      cancelSubscription: {
        createTransport() {
          return createTransport([
            {
              method: "DELETE",
              origin: "https://sandbox-api.polar.sh",
              path: "/v1/subscriptions/sub_polar_1",
              assert(request) {
                expectJsonRequest(request, secretKey);
              },
              respond: jsonResponse({ revoked: true }),
            },
          ]);
        },
        async run(adapter, account) {
          return adapter.cancelSubscription({
            subscription: { id: "sub_polar_1", status: "active" },
            environment: "test",
            account,
          });
        },
        assert(result) {
          expect(expectOk(result as ProviderResult<any>)).toEqual({
            canceled: true,
          });
        },
      },
      chargeAuthorization: {
        createTransport() {
          return createTransport([
            {
              method: "POST",
              origin: "https://sandbox-api.polar.sh",
              path: "/v1/products",
              assert(request) {
                expectJsonRequest(request, secretKey);
                expect(request.json<Record<string, any>>()).toEqual({
                  name: "Invoice Auto Charge",
                  description: "Auto-generated product for off-session charge",
                  prices: [
                    {
                      amount_type: "fixed",
                      price_amount: 3100,
                      price_currency: "usd",
                    },
                  ],
                  metadata: {
                    invoice_id: "inv_1",
                    type: "invoice_payment",
                    payment_method_token: "pm_saved_token",
                  },
                });
              },
              respond: jsonResponse({
                id: "prod_polar_charge_1",
              }),
            },
            {
              method: "POST",
              origin: "https://sandbox-api.polar.sh",
              path: "/v1/checkouts/",
              assert(request) {
                expectJsonRequest(request, secretKey);
                expect(request.json<Record<string, any>>()).toEqual({
                  products: ["prod_polar_charge_1"],
                  customer_id: "cus_polar_1",
                  customer_email: "polar-charge@example.com",
                  metadata: {
                    invoice_id: "inv_1",
                    type: "invoice_payment",
                    payment_method_token: "pm_saved_token",
                  },
                });
              },
              respond: jsonResponse({
                id: "chk_polar_charge_1",
                client_secret: "cs_polar_contract_1",
                status: "open",
                is_payment_form_required: false,
              }),
            },
            {
              method: "POST",
              origin: "https://sandbox-api.polar.sh",
              path: "/v1/checkouts/client/cs_polar_contract_1/confirm",
              assert(request) {
                expectJsonRequest(request, secretKey);
                expect(request.bodyText).toBe("{}");
              },
              respond: jsonResponse({
                id: "chk_polar_charge_1",
                status: "succeeded",
              }),
            },
          ]);
        },
        async run(adapter, account) {
          return adapter.chargeAuthorization({
            customer: {
              id: "cus_polar_1",
              email: "polar-charge@example.com",
            },
            authorizationCode: "pm_saved_token",
            amount: 3100,
            currency: "USD",
            metadata: { invoice_id: "inv_1", type: "invoice_payment" },
            environment: "test",
            account,
          });
        },
        assert(result) {
          expect(expectOk(result as ProviderResult<any>)).toEqual({
            reference: "chk_polar_charge_1",
          });
        },
      },
      fetchSubscription: {
        createTransport() {
          return createTransport([
            {
              method: "GET",
              origin: "https://sandbox-api.polar.sh",
              path: "/v1/subscriptions/sub_polar_1",
              assert(request) {
                expectJsonRequest(request, secretKey);
              },
              respond: jsonResponse({
                id: "sub_polar_1",
                status: "active",
                product: { id: "prod_polar_plan_1" },
                current_period_start: "2026-03-01T00:00:00.000Z",
                current_period_end: "2026-04-01T00:00:00.000Z",
              }),
            },
          ]);
        },
        async run(adapter, account) {
          return adapter.fetchSubscription({
            subscriptionId: "sub_polar_1",
            environment: "test",
            account,
          });
        },
        assert(result) {
          expect(expectOk(result as ProviderResult<any>)).toEqual({
            id: "sub_polar_1",
            status: "active",
            planCode: "prod_polar_plan_1",
            startDate: "2026-03-01T00:00:00.000Z",
            nextPaymentDate: "2026-04-01T00:00:00.000Z",
            metadata: {
              id: "sub_polar_1",
              status: "active",
              product: { id: "prod_polar_plan_1" },
              current_period_start: "2026-03-01T00:00:00.000Z",
              current_period_end: "2026-04-01T00:00:00.000Z",
            },
          });
        },
      },
      updatePlan: {
        createTransport() {
          return createTransport([
            {
              method: "PATCH",
              origin: "https://sandbox-api.polar.sh",
              path: "/v1/products/prod_polar_plan_1",
              assert(request) {
                expectJsonRequest(request, secretKey);
                expect(request.json<Record<string, any>>()).toEqual({
                  name: "Polar Pro Plus",
                  description: "Updated polar plan",
                  recurring_interval: "month",
                  recurring_interval_count: 1,
                  prices: [
                    {
                      amount_type: "fixed",
                      price_amount: 6200,
                      price_currency: "usd",
                    },
                  ],
                });
              },
              respond: jsonResponse({ id: "prod_polar_plan_1" }),
            },
          ]);
        },
        async run(adapter, account) {
          return adapter.updatePlan?.({
            planId: "prod_polar_plan_1",
            name: "Polar Pro Plus",
            amount: 6200,
            interval: "monthly",
            currency: "USD",
            description: "Updated polar plan",
            environment: "test",
            account,
          });
        },
        assert(result) {
          expect(expectOk(result as ProviderResult<any>)).toEqual({
            updated: true,
          });
        },
      },
      changePlan: {
        createTransport() {
          return createTransport([
            {
              method: "PATCH",
              origin: "https://sandbox-api.polar.sh",
              path: "/v1/subscriptions/sub_polar_1",
              assert(request) {
                expectJsonRequest(request, secretKey);
                expect(request.json<Record<string, unknown>>()).toEqual({
                  product_id: "prod_polar_plan_2",
                  proration_behavior: "prorate",
                });
              },
              respond: jsonResponse({ id: "sub_polar_1" }),
            },
          ]);
        },
        async run(adapter, account) {
          return adapter.changePlan?.({
            subscriptionId: "sub_polar_1",
            newPlanId: "prod_polar_plan_2",
            prorationMode: "full_immediately",
            environment: "test",
            account,
          });
        },
        assert(result) {
          expect(expectOk(result as ProviderResult<any>)).toEqual({
            changed: true,
          });
        },
      },
      refundCharge: {
        createTransport() {
          return createTransport([
            {
              method: "POST",
              origin: "https://sandbox-api.polar.sh",
              path: "/v1/refunds",
              assert(request) {
                expectJsonRequest(request, secretKey);
                expect(request.json<Record<string, unknown>>()).toEqual({
                  order_id: "ord_polar_1",
                  reason: "duplicate charge",
                  amount: 900,
                });
              },
              respond: jsonResponse({
                id: "refund_polar_1",
              }),
            },
          ]);
        },
        async run(adapter, account) {
          return adapter.refundCharge?.({
            reference: "ord_polar_1",
            amount: 900,
            reason: "duplicate charge",
            environment: "test",
            account,
          });
        },
        assert(result) {
          expect(expectOk(result as ProviderResult<any>)).toEqual({
            refunded: true,
            reference: "ord_polar_1",
          });
        },
      },
    },
  };
}

const adapterFixtures: Record<string, AdapterContractFixture> = {
  paystack: createPaystackFixture(),
  dodopayments: createDodoFixture(),
  stripe: createStripeFixture(),
  polar: createPolarFixture(),
};

describe("Registered adapter contract", () => {
  const adapters = getProviderRegistry()
    .list()
    .slice()
    .sort((left, right) => left.id.localeCompare(right.id));

  it("keeps contract fixtures in lockstep with the registered adapter registry", () => {
    expect(Object.keys(adapterFixtures).sort()).toEqual(
      adapters.map((adapter) => adapter.id).sort(),
    );
  });

  for (const adapter of adapters) {
    const fixture = adapterFixtures[adapter.id];

    describe(adapter.id, () => {
      it("surfaces configuration_missing when credentials are absent", async () => {
        const invalidAccount: ProviderAccount = {
          ...fixture.buildAccount(),
          credentials: {},
        };

        const result = await adapter.createCustomer({
          email: "missing-config@example.com",
          environment: "test",
          account: invalidAccount,
        });

        expectErrCode(result, "configuration_missing");
      });

      it("verifies authentic webhooks and rejects tampered payloads", async () => {
        const signed = await fixture.buildSignedWebhook();
        const verified = await adapter.verifyWebhook({
          signature: signed.signature,
          payload: signed.payload,
          secret: signed.secret,
          headers: signed.headers,
        });

        expect(expectOk(verified)).toBe(true);

        const tampered = await withMutedConsoleError(async () => {
          return adapter.verifyWebhook({
            signature: signed.signature,
            payload: signed.tamperedPayload,
            secret: signed.secret,
            headers: signed.headers,
          });
        });

        expect(expectOk(tampered)).toBe(false);
      });

      it("rejects malformed webhook payloads", () => {
        const result = adapter.parseWebhookEvent({
          payload: {},
        });

        expectErrCode(result, "invalid_payload");
      });

      for (const parseCase of fixture.parseCases) {
        it(`parseWebhookEvent ${parseCase.name}`, () => {
          const result = adapter.parseWebhookEvent({
            payload: parseCase.payload,
          });
          const event = expectOk(result);
          parseCase.assert(event);
        });
      }

      for (const scenarioName of requiredScenarioNames) {
        it(`${scenarioName} satisfies the required adapter contract`, async () => {
          const scenario = fixture.scenarios[scenarioName];
          expect(scenario).toBeDefined();
          if (!scenario) {
            throw new Error(
              `Missing required adapter scenario ${scenarioName} for ${adapter.id}`,
            );
          }

          await runScenario(adapter, fixture.buildAccount(), scenario);
        });
      }

      for (const scenarioName of optionalScenarioNames) {
        const implemented =
          typeof (adapter as Record<string, unknown>)[scenarioName] ===
          "function";

        if (implemented) {
          it(`${scenarioName} is covered when the adapter implements it`, async () => {
            const scenario = fixture.scenarios[scenarioName];
            expect(scenario).toBeDefined();
            if (!scenario) {
              throw new Error(
                `Missing optional adapter scenario ${scenarioName} for ${adapter.id}`,
              );
            }

            await runScenario(adapter, fixture.buildAccount(), scenario);
          });
        } else {
          it(`${scenarioName} stays absent when the adapter does not implement it`, () => {
            expect(fixture.scenarios[scenarioName]).toBeUndefined();
          });
        }
      }
    });
  }
});
