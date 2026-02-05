import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { schema } from "@owostack/db";
import { decrypt } from "../../lib/encryption";
import { verifyApiKey } from "../../lib/api-keys";
import type { Env, Variables } from "../../index";
import { errorToResponse, ValidationError } from "../../lib/errors";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

const attachSchema = z.object({
  customerId: z.string().optional(),
  email: z.string().email().optional(),
  amount: z.number().min(0), // In kobo
  currency: z.string().min(3).optional(),
  channels: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  callbackUrl: z.string().url().optional(),
});

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

// Attach (Initialize Transaction)
app.post("/attach", async (c) => {
  const authHeader = c.req.header("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ success: false, error: "Missing API Key" }, 401);
  }

  const apiKey = authHeader.split(" ")[1];
  const db = c.get("db");

  // Verify API Key
  const keyRecord = await verifyApiKey(db, apiKey);
  if (!keyRecord) {
    return c.json({ success: false, error: "Invalid API Key" }, 401);
  }

  // Get project config for this organization
  const project = await db.query.projects.findFirst({
    where: eq(schema.projects.organizationId, keyRecord.organizationId),
  });

  if (!project) {
    return c.json(
      { success: false, error: "Project configuration not found" },
      500,
    );
  }

  // Determine environment and secret key to use
  const activeEnv = project.activeEnvironment || "test";
  const encryptedKey =
    activeEnv === "live" ? project.liveSecretKey : project.testSecretKey;

  if (!encryptedKey) {
    return c.json(
      {
        success: false,
        error: `Paystack ${activeEnv} mode not configured`,
      },
      400,
    );
  }

  // Decrypt the Paystack Secret Key
  let paystackSecretKey: string;
  try {
    paystackSecretKey = await decrypt(encryptedKey, c.env.ENCRYPTION_KEY);
  } catch (e) {
    return c.json(
      { success: false, error: "Failed to decrypt Paystack key" },
      500,
    );
  }

  // Parse Body
  const body = await c.req.json();
  const parsed = attachSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodErrorToResponse(parsed.error), 400);
  }

  const { email, amount, currency, channels, metadata, callbackUrl } =
    parsed.data;
  const paystackMetadata = {
    ...metadata,
    organization_id: keyRecord.organizationId,
    project_id: project.id,
    environment: activeEnv, // Track which env this transaction belongs to
  };

  // Call Paystack Initialize API
  try {
    const paystackRes = await fetch(
      "https://api.paystack.co/transaction/initialize",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${paystackSecretKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          amount,
          currency: currency || "NGN",
          channels,
          metadata: paystackMetadata,
          callback_url: callbackUrl,
        }),
      },
    );

    const paystackData = (await paystackRes.json()) as any;

    if (!paystackRes.ok) {
      return c.json(
        {
          success: false,
          error: paystackData.message || "Paystack error",
        },
        paystackRes.status as any,
      );
    }

    return c.json({
      success: true,
      ...paystackData.data,
    });
  } catch (e: any) {
    return c.json({ success: false, error: e.message || "Network error" }, 500);
  }
});

export default app;
