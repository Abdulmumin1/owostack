import { describe, expect, it } from "vitest";
import type { ProviderAccount } from "@owostack/adapters";
import {
  getManagedSandboxAccount,
  isManagedSandboxAccount,
  isManagedSandboxRuntime,
  listManagedSandboxAccounts,
  listManagedSandboxProviderIds,
  managedSandboxWebhookSecret,
  mergeManagedSandboxAccounts,
  parseManagedSandboxProviders,
} from "./managed-sandbox";

const SECRET = JSON.stringify({
  paystack: { secretKey: " sk_test_paystack ", publicKey: "pk_test_paystack" },
  Stripe: {
    secretKey: "sk_test_stripe",
    publishableKey: "pk_test_stripe",
    webhookSecret: "whsec_stripe",
  },
  dodopayments: { secretKey: "dodo_test", webhookSecret: "dodo_whsec" },
});

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
  describe("parseManagedSandboxProviders", () => {
    it("normalizes provider ids and trims secret keys", () => {
      const parsed = parseManagedSandboxProviders(SECRET);

      expect([...parsed.keys()]).toEqual(["paystack", "stripe", "dodopayments"]);
      expect(parsed.get("paystack")).toEqual({
        secretKey: "sk_test_paystack",
        publicKey: "pk_test_paystack",
      });
      expect(parsed.get("stripe")?.webhookSecret).toBe("whsec_stripe");
    });

    it("returns an empty map for an unset, blank or malformed secret", () => {
      expect(parseManagedSandboxProviders(undefined).size).toBe(0);
      expect(parseManagedSandboxProviders("   ").size).toBe(0);
      expect(parseManagedSandboxProviders("{not json").size).toBe(0);
      expect(parseManagedSandboxProviders('["paystack"]').size).toBe(0);
    });

    it("drops entries without a secretKey but keeps the valid ones", () => {
      const parsed = parseManagedSandboxProviders(
        JSON.stringify({
          paystack: { publicKey: "pk_only" },
          bachs: "sk_sandbox_string_not_object",
          stripe: { secretKey: "sk_test_ok" },
        }),
      );

      expect([...parsed.keys()]).toEqual(["stripe"]);
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

    it("never exposes managed accounts on the live worker even when the secret is present", () => {
      const env = { ENVIRONMENT: "live", MANAGED_SANDBOX_PROVIDERS: SECRET };

      expect(listManagedSandboxProviderIds(env)).toEqual([]);
      expect(listManagedSandboxAccounts(env, "org_1")).toEqual([]);
      expect(getManagedSandboxAccount(env, "org_1", "paystack")).toBeNull();
    });

    it("synthesizes one test-scoped account per provider for the requesting organization", () => {
      const env = { ENVIRONMENT: "test", MANAGED_SANDBOX_PROVIDERS: SECRET };
      const accounts = listManagedSandboxAccounts(env, "org_42");

      expect(accounts.map((a) => a.providerId)).toEqual([
        "paystack",
        "stripe",
        "dodopayments",
      ]);
      for (const account of accounts) {
        expect(account.organizationId).toBe("org_42");
        expect(account.environment).toBe("test");
        expect(account.metadata).toEqual({ managed: true });
        expect(isManagedSandboxAccount(account)).toBe(true);
      }
      expect(accounts[0].id).toBe("managed_sandbox_paystack");
      expect(accounts[0].credentials.secretKey).toBe("sk_test_paystack");
    });
  });

  describe("mergeManagedSandboxAccounts", () => {
    const env = { ENVIRONMENT: "test", MANAGED_SANDBOX_PROVIDERS: SECRET };

    it("lets an organization's own test row override the managed account for that provider only", () => {
      const merged = mergeManagedSandboxAccounts(
        [userAccount("paystack", "test")],
        listManagedSandboxAccounts(env, "org_1"),
      );

      const paystack = merged.filter((a) => a.providerId === "paystack");
      expect(paystack).toHaveLength(1);
      expect(paystack[0].id).toBe("acct_paystack_test");
      expect(merged.map((a) => a.id)).toEqual([
        "acct_paystack_test",
        "managed_sandbox_stripe",
        "managed_sandbox_dodopayments",
      ]);
    });

    it("does not let a live row suppress the managed sandbox account", () => {
      const merged = mergeManagedSandboxAccounts(
        [userAccount("paystack", "live")],
        listManagedSandboxAccounts(env, "org_1"),
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
    const env = { ENVIRONMENT: "test", MANAGED_SANDBOX_PROVIDERS: SECRET };

    it("prefers the dedicated webhook secret and falls back to the Paystack secret key", () => {
      const stripe = getManagedSandboxAccount(env, "org_1", "stripe")!;
      const paystack = getManagedSandboxAccount(env, "org_1", "paystack")!;

      expect(managedSandboxWebhookSecret(stripe)).toBe("whsec_stripe");
      expect(managedSandboxWebhookSecret(paystack)).toBe("sk_test_paystack");
    });

    it("returns null for providers that need a webhook secret but have none configured", () => {
      const bachsOnly = {
        ENVIRONMENT: "test",
        MANAGED_SANDBOX_PROVIDERS: JSON.stringify({
          bachs: { secretKey: "sk_sandbox_bachs" },
        }),
      };
      const bachs = getManagedSandboxAccount(bachsOnly, "org_1", "bachs")!;

      expect(managedSandboxWebhookSecret(bachs)).toBeNull();
    });
  });
});
