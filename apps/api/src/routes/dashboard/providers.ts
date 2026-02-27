import { Hono } from "hono";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { schema } from "@owostack/db";
import type { Env, Variables } from "../../index";
import { encrypt, decrypt } from "../../lib/encryption";
import { errorToResponse, ValidationError } from "../../lib/errors";
import { syncPlansToProvider } from "../../lib/plan-sync";
import { getProviderRegistry } from "../../lib/providers";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

function zodErrorToResponse(zodError: {
  flatten: () => {
    formErrors: string[];
    fieldErrors: Record<string, string[] | undefined>;
  };
}) {
  const flattened = zodError.flatten();
  const fieldErrors = Object.entries(flattened.fieldErrors);

  if (fieldErrors.length > 0) {
    const [field, messages] = fieldErrors[0];
    return errorToResponse(
      new ValidationError({ field, details: messages?.[0] || "Invalid value" }),
    );
  }

  const formError = flattened.formErrors[0];
  return errorToResponse(
    new ValidationError({
      field: "input",
      details: formError || "Invalid request body",
    }),
  );
}

const providerAccountSchema = z.object({
  organizationId: z.string(),
  providerId: z.string(),
  environment: z.enum(["test", "live"]),
  displayName: z.string().optional(),
  credentials: z.record(z.string(), z.unknown()),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const providerRuleSchema = z.object({
  organizationId: z.string(),
  providerId: z.string(),
  priority: z.number().int().min(0),
  isDefault: z.boolean().optional(),
  conditions: z.record(z.string(), z.unknown()).optional(),
});

app.get("/accounts", async (c) => {
  const organizationId = c.get("organizationId");
  if (!organizationId) {
    return c.json({ success: false, error: "Organization ID required" }, 400);
  }

  const db = c.get("db");
  const accounts = await db.query.providerAccounts.findMany({
    where: eq(schema.providerAccounts.organizationId, organizationId),
  });

  const sanitized = accounts.map((account: any) => {
    if (!account.credentials) return account;
    return {
      ...account,
      credentials: {
        ...account.credentials,
        secretKey: account.credentials.secretKey ? "****" : null,
        webhookSecret: account.credentials.webhookSecret ? "****" : null,
      },
    };
  });

  return c.json({ success: true, data: sanitized });
});

// Helper: parse enabled providers from env
function getEnabledProviders(env: any): string[] {
  const raw = env.ENABLED_PROVIDERS || "paystack,dodopayments,polar";
  return raw
    .split(",")
    .map((s: string) => s.trim().toLowerCase())
    .filter(Boolean);
}

// List enabled providers (so the dashboard knows what to show)
app.get("/enabled", async (c) => {
  const enabled = getEnabledProviders(c.env);
  return c.json({ success: true, data: enabled });
});

app.post("/accounts", async (c) => {
  const body = await c.req.json();
  const parsed = providerAccountSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodErrorToResponse(parsed.error), 400);
  }

  const { providerId, environment, displayName, credentials, metadata } =
    parsed.data;
  // Use resolved organization ID from context (middleware resolves slug to UUID)
  const organizationId = c.get("organizationId") ?? parsed.data.organizationId;

  // Reject non-enabled providers
  const enabled = getEnabledProviders(c.env);
  if (!enabled.includes(providerId)) {
    return c.json(
      {
        success: false,
        error: `Provider "${providerId}" is not enabled. Enabled providers: ${enabled.join(", ")}`,
      },
      400,
    );
  }

  const db = c.get("db");

  // Guard: reject duplicate (same org + provider + environment)
  const existing = await db.query.providerAccounts.findFirst({
    where: and(
      eq(schema.providerAccounts.organizationId, organizationId),
      eq(schema.providerAccounts.providerId, providerId),
      eq(schema.providerAccounts.environment, environment),
    ),
  });
  if (existing) {
    return c.json(
      {
        success: false,
        error: `A ${providerId} account for ${environment} environment already exists. Update it instead.`,
      },
      409,
    );
  }

  const secretKey = credentials.secretKey;
  const webhookSecret = credentials.webhookSecret;
  let storedCredentials: Record<string, unknown> = credentials;

  if (!c.env.ENCRYPTION_KEY && (secretKey || webhookSecret)) {
    return c.json({ success: false, error: "Encryption not configured" }, 500);
  }

  if (typeof secretKey === "string" && secretKey.length > 0) {
    storedCredentials = {
      ...storedCredentials,
      secretKey: await encrypt(secretKey, c.env.ENCRYPTION_KEY),
    };
  }

  if (typeof webhookSecret === "string" && webhookSecret.length > 0) {
    storedCredentials = {
      ...storedCredentials,
      webhookSecret: await encrypt(webhookSecret, c.env.ENCRYPTION_KEY),
    };
  }

  let account;
  try {
    [account] = await db
      .insert(schema.providerAccounts)
      .values({
        id: crypto.randomUUID(),
        organizationId,
        providerId,
        environment,
        displayName: displayName || null,
        credentials: storedCredentials,
        metadata: metadata || null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .returning();
  } catch (e: any) {
    // Unique constraint safety net (race between two concurrent requests)
    if (e.message?.includes("UNIQUE constraint")) {
      return c.json(
        {
          success: false,
          error: `A ${providerId} account for ${environment} environment already exists.`,
        },
        409,
      );
    }
    throw e;
  }

  // Eager plan sync — run in background so the response is instant
  const registry = getProviderRegistry();
  const adapter = registry.get(providerId);
  if (adapter) {
    const decryptedCreds = { ...credentials };
    if (typeof secretKey === "string" && secretKey.length > 0) {
      decryptedCreds.secretKey = secretKey;
    }
    const providerAccount = {
      id: account.id,
      organizationId,
      providerId,
      environment,
      credentials: decryptedCreds,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
    };
    c.executionCtx.waitUntil(
      syncPlansToProvider(db, organizationId, adapter, providerAccount)
        .then((r) =>
          console.log(
            `[providers] Plan sync on connect: ${r.synced.length} synced, ${r.failed.length} failed`,
          ),
        )
        .catch((e) =>
          console.warn("[providers] Plan sync on connect failed:", e),
        ),
    );
  }

  return c.json({ success: true, data: account, planSyncStarted: !!adapter });
});

app.get("/rules", async (c) => {
  const organizationId = c.get("organizationId");
  if (!organizationId) {
    return c.json({ success: false, error: "Organization ID required" }, 400);
  }

  const db = c.get("db");
  const rules = await db.query.providerRules.findMany({
    where: eq(schema.providerRules.organizationId, organizationId),
  });

  return c.json({ success: true, data: rules });
});

app.post("/rules", async (c) => {
  const body = await c.req.json();
  const parsed = providerRuleSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodErrorToResponse(parsed.error), 400);
  }

  const { providerId, priority, isDefault, conditions } = parsed.data;
  // Use resolved organization ID from context (middleware resolves slug to UUID)
  const organizationId = c.get("organizationId") ?? parsed.data.organizationId;
  const db = c.get("db");

  const [rule] = await db
    .insert(schema.providerRules)
    .values({
      id: crypto.randomUUID(),
      organizationId,
      providerId,
      priority,
      isDefault: isDefault ?? false,
      conditions: conditions || {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .returning();

  return c.json({ success: true, data: rule });
});

// =============================================================================
// Update a provider account
// =============================================================================

const updateAccountSchema = z.object({
  organizationId: z.string(),
  displayName: z.string().optional(),
  credentials: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

app.patch("/accounts/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const parsed = updateAccountSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodErrorToResponse(parsed.error), 400);
  }

  const { displayName, credentials, metadata } = parsed.data;
  // Use resolved organization ID from context (middleware resolves slug to UUID)
  const organizationId = c.get("organizationId") ?? parsed.data.organizationId;
  const db = c.get("db");

  const existing = await db.query.providerAccounts.findFirst({
    where: and(
      eq(schema.providerAccounts.id, id),
      eq(schema.providerAccounts.organizationId, organizationId),
    ),
  });

  if (!existing) {
    return c.json({ success: false, error: "Provider account not found" }, 404);
  }

  const updates: Record<string, unknown> = { updatedAt: Date.now() };

  if (displayName !== undefined) {
    updates.displayName = displayName || null;
  }

  if (metadata !== undefined) {
    updates.metadata = metadata;
  }

  if (credentials) {
    let storedCredentials = credentials;
    const secretKey = credentials.secretKey;
    const webhookSecret = credentials.webhookSecret;

    if ((secretKey || webhookSecret) && !c.env.ENCRYPTION_KEY) {
      return c.json(
        { success: false, error: "Encryption not configured" },
        500,
      );
    }

    if (typeof secretKey === "string" && secretKey.length > 0) {
      storedCredentials = {
        ...storedCredentials,
        secretKey: await encrypt(secretKey, c.env.ENCRYPTION_KEY),
      };
    }

    if (typeof webhookSecret === "string" && webhookSecret.length > 0) {
      storedCredentials = {
        ...storedCredentials,
        webhookSecret: await encrypt(webhookSecret, c.env.ENCRYPTION_KEY),
      };
    }

    updates.credentials = storedCredentials;
  }

  const [updated] = await db
    .update(schema.providerAccounts)
    .set(updates)
    .where(eq(schema.providerAccounts.id, id))
    .returning();

  return c.json({ success: true, data: updated });
});

// =============================================================================
// Delete a provider account
// =============================================================================

app.delete("/accounts/:id", async (c) => {
  const id = c.req.param("id");
  const organizationId = c.get("organizationId");

  if (!organizationId) {
    return c.json({ success: false, error: "Organization ID required" }, 400);
  }

  const db = c.get("db");

  const existing = await db.query.providerAccounts.findFirst({
    where: and(
      eq(schema.providerAccounts.id, id),
      eq(schema.providerAccounts.organizationId, organizationId),
    ),
  });

  if (!existing) {
    return c.json({ success: false, error: "Provider account not found" }, 404);
  }

  await db
    .delete(schema.providerAccounts)
    .where(eq(schema.providerAccounts.id, id));

  return c.json({ success: true });
});

// =============================================================================
// Update a provider rule
// =============================================================================

const updateRuleSchema = z.object({
  organizationId: z.string(),
  providerId: z.string().optional(),
  priority: z.number().int().min(0).optional(),
  isDefault: z.boolean().optional(),
  conditions: z.record(z.string(), z.unknown()).optional(),
});

app.patch("/rules/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const parsed = updateRuleSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodErrorToResponse(parsed.error), 400);
  }

  const { organizationId, providerId, priority, isDefault, conditions } =
    parsed.data;
  const db = c.get("db");

  const existing = await db.query.providerRules.findFirst({
    where: and(
      eq(schema.providerRules.id, id),
      eq(schema.providerRules.organizationId, organizationId),
    ),
  });

  if (!existing) {
    return c.json({ success: false, error: "Provider rule not found" }, 404);
  }

  const updates: Record<string, unknown> = { updatedAt: Date.now() };

  if (providerId !== undefined) updates.providerId = providerId;
  if (priority !== undefined) updates.priority = priority;
  if (isDefault !== undefined) updates.isDefault = isDefault;
  if (conditions !== undefined) updates.conditions = conditions;

  const [updated] = await db
    .update(schema.providerRules)
    .set(updates)
    .where(eq(schema.providerRules.id, id))
    .returning();

  return c.json({ success: true, data: updated });
});

// =============================================================================
// Delete a provider rule
// =============================================================================

app.delete("/rules/:id", async (c) => {
  const id = c.req.param("id");
  const organizationId = c.get("organizationId");

  if (!organizationId) {
    return c.json({ success: false, error: "Organization ID required" }, 400);
  }

  const db = c.get("db");

  const existing = await db.query.providerRules.findFirst({
    where: and(
      eq(schema.providerRules.id, id),
      eq(schema.providerRules.organizationId, organizationId),
    ),
  });

  if (!existing) {
    return c.json({ success: false, error: "Provider rule not found" }, 404);
  }

  await db.delete(schema.providerRules).where(eq(schema.providerRules.id, id));

  return c.json({ success: true });
});

// =============================================================================
// Decrypt provider account credentials (for internal use)
// =============================================================================

app.post("/accounts/decrypt", async (c) => {
  const body = await c.req.json();
  const { id, organizationId } = body;
  if (!id || !organizationId) {
    return c.json(
      { success: false, error: "Missing id or organizationId" },
      400,
    );
  }

  const db = c.get("db");
  const account = await db.query.providerAccounts.findFirst({
    where: and(
      eq(schema.providerAccounts.id, id),
      eq(schema.providerAccounts.organizationId, organizationId),
    ),
  });

  if (!account) {
    return c.json({ success: false, error: "Provider account not found" }, 404);
  }

  const credentials = { ...(account.credentials || {}) } as Record<string, any>;
  const secretKey = credentials.secretKey;

  if (typeof secretKey === "string" && secretKey.length > 0) {
    if (!c.env.ENCRYPTION_KEY) {
      return c.json(
        { success: false, error: "Encryption not configured" },
        500,
      );
    }
    try {
      credentials.secretKey = await decrypt(secretKey, c.env.ENCRYPTION_KEY);
    } catch (e) {
      return c.json(
        { success: false, error: "Failed to decrypt secret key" },
        500,
      );
    }
  }

  return c.json({ success: true, data: { ...account, credentials } });
});

// =============================================================================
// Sync plans to a provider (manual trigger from dashboard)
// =============================================================================

app.post("/sync-plans", async (c) => {
  const body = await c.req.json();
  const { organizationId, accountId } = body;

  if (!organizationId || !accountId) {
    return c.json(
      { success: false, error: "organizationId and accountId required" },
      400,
    );
  }

  const db = c.get("db");

  const account = await db.query.providerAccounts.findFirst({
    where: and(
      eq(schema.providerAccounts.id, accountId),
      eq(schema.providerAccounts.organizationId, organizationId),
    ),
  });

  if (!account) {
    return c.json({ success: false, error: "Provider account not found" }, 404);
  }

  const registry = getProviderRegistry();
  const adapter = registry.get(account.providerId);
  if (!adapter) {
    return c.json(
      {
        success: false,
        error: `No adapter for provider: ${account.providerId}`,
      },
      400,
    );
  }

  // Decrypt credentials
  const credentials = { ...(account.credentials || {}) } as Record<string, any>;
  if (
    typeof credentials.secretKey === "string" &&
    credentials.secretKey.length > 0
  ) {
    if (!c.env.ENCRYPTION_KEY) {
      return c.json(
        { success: false, error: "Encryption not configured" },
        500,
      );
    }
    try {
      credentials.secretKey = await decrypt(
        credentials.secretKey,
        c.env.ENCRYPTION_KEY,
      );
    } catch {
      return c.json(
        { success: false, error: "Failed to decrypt provider credentials" },
        500,
      );
    }
  }

  const providerAccount = {
    id: account.id,
    organizationId: account.organizationId,
    providerId: account.providerId,
    environment: account.environment,
    credentials,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };

  const result = await syncPlansToProvider(
    db,
    organizationId,
    adapter,
    providerAccount,
  );

  return c.json({
    success: true,
    data: result,
  });
});

export default app;
