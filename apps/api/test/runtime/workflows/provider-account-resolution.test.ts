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
});
