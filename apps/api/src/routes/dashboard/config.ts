import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { schema } from "@owostack/db";
import { encrypt, decrypt, maskSecretKey } from "../../lib/encryption";
import type { Env, Variables } from "../../index";
import { errorToResponse, ValidationError } from "../../lib/errors";

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

const paystackConfigSchema = z.object({
  organizationId: z.string(),
  secretKey: z.string().min(1),
  publicKey: z.string().optional(),
  environment: z.enum(["test", "live"]).default("test"),
});

app.post("/paystack-config", async (c) => {
  const body = await c.req.json();
  const parsed = paystackConfigSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodErrorToResponse(parsed.error), 400);
  }

  const { organizationId, secretKey, publicKey } = parsed.data;
  const db = c.get("db");
  const encryptionKey = c.env.ENCRYPTION_KEY;

  if (!encryptionKey) {
    return c.json({ success: false, error: "Encryption not configured" }, 500);
  }

  // Auto-detect environment from key prefix
  const isTestKey = secretKey.startsWith("sk_test_");
  const isLiveKey = secretKey.startsWith("sk_live_");

  if (!isTestKey && !isLiveKey) {
    return c.json(
      {
        success: false,
        error: "Invalid key format. Key must start with sk_test_ or sk_live_",
      },
      400,
    );
  }

  const detectedEnv = isTestKey ? "test" : "live";

  // Validate the key with Paystack API
  try {
    const testResponse = await fetch("https://api.paystack.co/customer", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!testResponse.ok) {
      return c.json(
        { success: false, error: "Invalid Paystack secret key" },
        400,
      );
    }
  } catch (e) {
    return c.json({ success: false, error: "Failed to validate key" }, 400);
  }

  // Encrypt the secret key before storing
  let encryptedSecretKey: string;
  try {
    encryptedSecretKey = await encrypt(secretKey, encryptionKey);
  } catch (e: any) {
    return c.json(
      { success: false, error: e.message || "Failed to encrypt key" },
      500,
    );
  }

  // Prepare update object based on detected environment
  const updateData: Record<string, any> = {
    updatedAt: new Date(),
  };

  if (detectedEnv === "test") {
    updateData.testSecretKey = encryptedSecretKey;
    updateData.testPublicKey = publicKey || null;
  } else {
    updateData.liveSecretKey = encryptedSecretKey;
    updateData.livePublicKey = publicKey || null;
  }

  // Check if project exists for this organization, create if not
  let [project] = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.organizationId, organizationId))
    .limit(1);

  if (!project) {
    // Create default project for the organization
    [project] = await db
      .insert(schema.projects)
      .values({
        id: crypto.randomUUID(),
        organizationId,
        name: "Default Project",
        slug: "default",
        ...updateData,
        activeEnvironment: detectedEnv,
      })
      .returning();
  } else {
    // Update existing project with new key
    [project] = await db
      .update(schema.projects)
      .set(updateData)
      .where(eq(schema.projects.id, project.id))
      .returning();
  }

  return c.json({
    success: true,
    data: {
      id: project.id,
      environment: detectedEnv,
      activeEnvironment: project.activeEnvironment,
      connected: true,
      publicKey:
        detectedEnv === "test" ? project.testPublicKey : project.livePublicKey,
      secretKeyMasked: maskSecretKey(secretKey),
      testConnected: !!project.testSecretKey,
      liveConnected: !!project.liveSecretKey,
    },
  });
});

app.get("/paystack-config", async (c) => {
  const organizationId = c.req.query("organizationId");
  if (!organizationId) {
    return c.json({ success: false, error: "Organization ID required" }, 400);
  }

  const db = c.get("db");
  const project = await db.query.projects.findFirst({
    where: eq(schema.projects.organizationId, organizationId),
  });

  const testConnected = !!project?.testSecretKey;
  const liveConnected = !!project?.liveSecretKey;

  if (!project || (!testConnected && !liveConnected)) {
    return c.json({
      success: true,
      data: {
        connected: false,
        testConnected: false,
        liveConnected: false,
        activeEnvironment: "test",
      },
    });
  }

  return c.json({
    success: true,
    data: {
      id: project.id,
      connected: testConnected || liveConnected,
      testConnected,
      liveConnected,
      activeEnvironment: project.activeEnvironment || "test",
      testPublicKey: project.testPublicKey,
      livePublicKey: project.livePublicKey,
      // Masked keys for display
      testSecretKeyMasked: testConnected ? "sk_test_••••••••" : null,
      liveSecretKeyMasked: liveConnected ? "sk_live_••••••••" : null,
    },
  });
});

// Switch active environment
app.post("/switch-environment", async (c) => {
  const body = await c.req.json();
  const { organizationId, environment } = body;

  if (!organizationId || !["test", "live"].includes(environment)) {
    return c.json({ success: false, error: "Invalid parameters" }, 400);
  }

  const db = c.get("db");
  const [project] = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.organizationId, organizationId))
    .limit(1);

  if (!project) {
    return c.json({ success: false, error: "Project not found" }, 404);
  }

  // Check if target environment is configured
  if (environment === "live" && !project.liveSecretKey) {
    return c.json(
      {
        success: false,
        error: "Live mode not configured. Add a live key first.",
      },
      400,
    );
  }
  if (environment === "test" && !project.testSecretKey) {
    return c.json(
      {
        success: false,
        error: "Test mode not configured. Add a test key first.",
      },
      400,
    );
  }

  // Update active environment
  await db
    .update(schema.projects)
    .set({ activeEnvironment: environment, updatedAt: new Date() })
    .where(eq(schema.projects.id, project.id));

  return c.json({
    success: true,
    data: { activeEnvironment: environment },
  });
});

export default app;
