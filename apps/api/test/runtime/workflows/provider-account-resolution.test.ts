import { describe, expect, it } from "vitest";
import { resolveProviderAccount } from "../../../src/lib/workflows/utils";
import { createSqliteD1Database } from "../helpers/sqlite-d1";
import {
  buildWorkflowEnv,
  insertOrganization,
  insertProviderAccount,
} from "../helpers/workflow-runtime";

describe("resolveProviderAccount runtime integration", () => {
  it("uses the runtime environment as the source of truth even when the stored row env is stale", async () => {
    const db = createSqliteD1Database();

    try {
      await insertOrganization(db);
      await insertProviderAccount({
        db,
        organizationId: "org_1",
        environment: "test",
        secretKey: "sk_live_actual",
      });

      const account = await resolveProviderAccount(
        buildWorkflowEnv(db, { ENVIRONMENT: "production" }),
        "org_1",
        "paystack",
      );

      expect(account).not.toBeNull();
      expect(account?.id).toBe("acct_paystack_test");
      expect(account?.environment).toBe("live");
      expect(account?.credentials.secretKey).toBe("sk_live_actual");
    } finally {
      db.close();
    }
  });

  describe("managed sandbox fallback", () => {
    const MANAGED_SECRETS = {
      MANAGED_SANDBOX_PAYSTACK: "sk_test_owostack_managed",
      MANAGED_SANDBOX_STRIPE: JSON.stringify({
        secretKey: "sk_test_owostack_stripe",
        webhookSecret: "whsec",
      }),
    };

    it("resolves the managed account on the sandbox worker when the org has no row for that provider", async () => {
      const db = createSqliteD1Database();

      try {
        await insertOrganization(db);

        const account = await resolveProviderAccount(
          buildWorkflowEnv(db, {
            ENVIRONMENT: "test",
            ...MANAGED_SECRETS,
          }),
          "org_1",
          "stripe",
        );

        expect(account).not.toBeNull();
        expect(account?.id).toBe("managed_sandbox_stripe");
        expect(account?.organizationId).toBe("org_1");
        expect(account?.environment).toBe("test");
        expect(account?.credentials.secretKey).toBe("sk_test_owostack_stripe");
      } finally {
        db.close();
      }
    });

    it("prefers the organization's own test row over the managed account", async () => {
      const db = createSqliteD1Database();

      try {
        await insertOrganization(db);
        await insertProviderAccount({
          db,
          organizationId: "org_1",
          environment: "test",
          secretKey: "sk_test_own",
        });

        const account = await resolveProviderAccount(
          buildWorkflowEnv(db, {
            ENVIRONMENT: "test",
            ...MANAGED_SECRETS,
          }),
          "org_1",
          "paystack",
        );

        expect(account?.id).toBe("acct_paystack_test");
        expect(account?.credentials.secretKey).toBe("sk_test_own");
      } finally {
        db.close();
      }
    });

    it("never resolves a managed account on the live worker", async () => {
      const db = createSqliteD1Database();

      try {
        await insertOrganization(db);

        const account = await resolveProviderAccount(
          buildWorkflowEnv(db, {
            ENVIRONMENT: "live",
            ...MANAGED_SECRETS,
          }),
          "org_1",
          "paystack",
        );

        expect(account).toBeNull();
      } finally {
        db.close();
      }
    });
  });
});
