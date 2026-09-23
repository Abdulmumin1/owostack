import { describe, expect, it } from "vitest";
import type { ProviderAccount } from "@owostack/adapters";
import {
  getManagedSandboxAccount,
  isManagedSandboxAccount,
  isManagedSandboxRuntime,
  listManagedSandboxAccounts,
  listManagedSandboxProviderIds,
  managedSandboxSecretName,
  managedSandboxWebhookSecret,
  mergeManagedSandboxAccounts,
  parseManagedSandboxProviders,
  parseManagedSandboxSecret,
  providerIdFromSecretName,
} from "./managed-sandbox";

/** What a sandbox worker env looks like once the secrets are set. */
const SANDBOX_ENV = {
  ENVIRONMENT: "test",
  ENCRYPTION_KEY: "irrelevant",
  MANAGED_SANDBOX_PAYSTACK: " sk_test_paystack ",
  MANAGED_SANDBOX_STRIPE: JSON.stringify({
    secretKey: "sk_test_stripe",
    publishableKey: "pk_test_stripe",
    webhookSecret: "whsec_stripe",
  }),
  MANAGED_SANDBOX_DODOPAYMENTS: JSON.stringify({
    secretKey: "dodo_test",
    webhookSecret: "dodo_whsec",
  }),
  // Non-string bindings must be ignored, not crash enumeration.
  DB: { prepare() {} },
};

function userAccount(
  providerId: string,
  environment: "test" | "live",
): ProviderAccount {
  return {
    id: `acct_${providerId}_${environment}`,
    organizationId: "org_1",
    providerId: providerId as ProviderAccount["providerId"],
    environment,
    credentials: { secretKey: `user_${providerId}_${environment}` },
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("managed sandbox credentials", () => {
  describe("secret naming", () => {
    it("maps provider ids to MANAGED_SANDBOX_<ID> and back", () => {
      expect(managedSandboxSecretName("paystack")).toBe("MANAGED_SANDBOX_PAYSTACK");
      expect(managedSandboxSecretName("dodopayments")).toBe(
        "MANAGED_SANDBOX_DODOPAYMENTS",
      );
      expect(providerIdFromSecretName("MANAGED_SANDBOX_STRIPE")).toBe("stripe");
      expect(providerIdFromSecretName("MANAGED_SANDBOX_")).toBeNull();
      expect(providerIdFromSecretName("ENCRYPTION_KEY")).toBeNull();
      expect(providerIdFromSecretName("managed_sandbox_stripe")).toBeNull();
    });
  });

  describe("parseManagedSandboxSecret", () => {
    it("accepts a bare secret key and trims it", () => {
      expect(parseManagedSandboxSecret("X", "  sk_test_abc ")).toEqual({
        secretKey: "sk_test_abc",
      });
    });

    it("accepts a JSON object and keeps every extra credential", () => {
      expect(
        parseManagedSandboxSecret(
          "X",
          '{"secretKey":" sk_test_x ","webhookSecret":"whsec"}',
        ),
      ).toEqual({ secretKey: "sk_test_x", webhookSecret: "whsec" });
    });

    it("rejects blank, non-string, malformed and secretKey-less values", () => {
      expect(parseManagedSandboxSecret("X", "")).toBeNull();
      expect(parseManagedSandboxSecret("X", "   ")).toBeNull();
      expect(parseManagedSandboxSecret("X", undefined)).toBeNull();
      expect(parseManagedSandboxSecret("X", { secretKey: "obj" })).toBeNull();
      expect(parseManagedSandboxSecret("X", "{not json")).toBeNull();
      expect(parseManagedSandboxSecret("X", '{"publicKey":"pk_only"}')).toBeNull();
    });
  });

  describe("parseManagedSandboxProviders", () => {
    it("collects every MANAGED_SANDBOX_* binding, ignoring everything else", () => {
      const parsed = parseManagedSandboxProviders(SANDBOX_ENV);

      expect([...parsed.keys()].sort()).toEqual([
        "dodopayments",
        "paystack",
        "stripe",
      ]);
      expect(parsed.get("paystack")).toEqual({ secretKey: "sk_test_paystack" });
      expect(parsed.get("stripe")?.webhookSecret).toBe("whsec_stripe");
    });

    it("drops a broken secret but keeps the valid ones", () => {
      const parsed = parseManagedSandboxProviders({
        ENVIRONMENT: "test",
        MANAGED_SANDBOX_PAYSTACK: '{"publicKey":"pk_only"}',
        MANAGED_SANDBOX_STRIPE: "sk_test_ok",
      });

      expect([...parsed.keys()]).toEqual(["stripe"]);
    });

    it("is empty when no secrets are set", () => {
      expect(parseManagedSandboxProviders({ ENVIRONMENT: "test" }).size).toBe(0);
    });
  });

  describe("runtime scoping", () => {
    it("treats every non-live worker as sandbox", () => {
      expect(isManagedSandboxRuntime({ ENVIRONMENT: "test" })).toBe(true);
      expect(isManagedSandboxRuntime({ ENVIRONMENT: "development" })).toBe(true);
      expect(isManagedSandboxRuntime({})).toBe(true);
      expect(isManagedSandboxRuntime({ ENVIRONMENT: "live" })).toBe(false);
      expect(isManagedSandboxRuntime({ ENVIRONMENT: "production" })).toBe(false);
    });

    it("never exposes managed accounts on the live worker even when secrets are present", () => {
      const env = { ...SANDBOX_ENV, ENVIRONMENT: "live" };

      expect(listManagedSandboxProviderIds(env)).toEqual([]);
      expect(listManagedSandboxAccounts(env, "org_1")).toEqual([]);
      expect(getManagedSandboxAccount(env, "org_1", "paystack")).toBeNull();
    });

    it("synthesizes one test-scoped account per provider for the requesting organization", () => {
      const accounts = listManagedSandboxAccounts(SANDBOX_ENV, "org_42");

      expect(accounts.map((a) => a.providerId)).toEqual([
        "dodopayments",
        "paystack",
        "stripe",
      ]);
      for (const account of accounts) {
        expect(account.organizationId).toBe("org_42");
        expect(account.environment).toBe("test");
        expect(account.metadata).toEqual({ managed: true });
        expect(isManagedSandboxAccount(account)).toBe(true);
      }
      const paystack = accounts.find((a) => a.providerId === "paystack")!;
      expect(paystack.id).toBe("managed_sandbox_paystack");
      expect(paystack.credentials.secretKey).toBe("sk_test_paystack");
    });
  });

  describe("mergeManagedSandboxAccounts", () => {
    it("lets an organization's own test row override the managed account for that provider only", () => {
      const merged = mergeManagedSandboxAccounts(
        [userAccount("paystack", "test")],
        listManagedSandboxAccounts(SANDBOX_ENV, "org_1"),
      );

      const paystack = merged.filter((a) => a.providerId === "paystack");
      expect(paystack).toHaveLength(1);
      expect(paystack[0].id).toBe("acct_paystack_test");
      expect(merged.map((a) => a.id)).toEqual([
        "acct_paystack_test",
        "managed_sandbox_dodopayments",
        "managed_sandbox_stripe",
      ]);
    });

    it("does not let a live row suppress the managed sandbox account", () => {
      const merged = mergeManagedSandboxAccounts(
        [userAccount("paystack", "live")],
        listManagedSandboxAccounts(SANDBOX_ENV, "org_1"),
      );

      expect(merged.map((a) => a.id)).toContain("acct_paystack_live");
      expect(merged.map((a) => a.id)).toContain("managed_sandbox_paystack");
    });

    it("returns user accounts untouched when nothing is managed", () => {
      const user = [userAccount("paystack", "live")];
      expect(mergeManagedSandboxAccounts(user, [])).toBe(user);
    });
  });

  describe("managedSandboxWebhookSecret", () => {
    it("prefers the dedicated webhook secret and falls back to the Paystack secret key", () => {
      const stripe = getManagedSandboxAccount(SANDBOX_ENV, "org_1", "stripe")!;
      const paystack = getManagedSandboxAccount(SANDBOX_ENV, "org_1", "paystack")!;

      expect(managedSandboxWebhookSecret(stripe)).toBe("whsec_stripe");
      expect(managedSandboxWebhookSecret(paystack)).toBe("sk_test_paystack");
    });

    it("returns null for providers that need a webhook secret but have none configured", () => {
      const env = { ENVIRONMENT: "test", MANAGED_SANDBOX_BACHS: "sk_sandbox_bachs" };
      const bachs = getManagedSandboxAccount(env, "org_1", "bachs")!;

      expect(managedSandboxWebhookSecret(bachs)).toBeNull();
    });
  });
});
