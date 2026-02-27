import { Hono } from "hono";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { schema } from "@owostack/db";
import type { Env, Variables } from "../../index";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

const createPackSchema = z.object({
  organizationId: z.string(),
  name: z.string().min(1),
  description: z.string().optional(),
  credits: z.number().int().min(1),
  price: z.number().int().min(0),
  currency: z.string().min(3).default("USD"),
  creditSystemId: z.string().min(1, "Credit system is required"),
  providerId: z.string().min(1, "Provider is required"),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const updatePackSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  credits: z.number().int().min(1).optional(),
  price: z.number().int().min(0).optional(),
  currency: z.string().min(3).optional(),
  creditSystemId: z.string().optional().nullable(),
  providerId: z.string().optional(),
  isActive: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional().nullable(),
});

// GET / — List credit packs for an organization
app.get("/", async (c) => {
  const organizationId = c.get("organizationId");
  if (!organizationId) {
    return c.json({ error: "Organization ID required" }, 400);
  }

  const db = c.get("db");

  try {
    if ((db.query as any).creditPacks) {
      try {
        const packs = await (db.query as any).creditPacks.findMany({
          where: eq((schema as any).creditPacks.organizationId, organizationId),
          with: { creditSystem: true },
        });
        return c.json({ success: true, data: packs });
      } catch {
        // Relation query failed (e.g. schema not rebuilt) — fall through to direct select
      }
    }

    // Fallback: direct select (no relations)
    const packs = await (db as any)
      .select()
      .from((schema as any).creditPacks)
      .where(eq((schema as any).creditPacks.organizationId, organizationId));
    return c.json({ success: true, data: packs });
  } catch (e: any) {
    // Table may not exist yet (migration not run)
    if (e?.message?.includes("no such table") || e?.message?.includes("Cannot read properties")) {
      return c.json({ success: true, data: [] });
    }
    return c.json({ success: false, error: e.message }, 500);
  }
});

// POST / — Create a credit pack
app.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = createPackSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ success: false, error: "Invalid input", details: parsed.error.flatten() }, 400);
  }

  const { organizationId, name, description, credits, price, currency, creditSystemId, providerId, metadata } = parsed.data;
  const db = c.get("db");

  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  try {
    // Check for duplicate slug
    if ((db.query as any).creditPacks) {
      const existing = await (db.query as any).creditPacks.findFirst({
        where: and(
          eq((schema as any).creditPacks.organizationId, organizationId),
          eq((schema as any).creditPacks.slug, slug),
        ),
      });
      if (existing) {
        return c.json({ success: false, error: `Credit pack with slug '${slug}' already exists` }, 409);
      }
    }

    const [pack] = await (db as any)
      .insert((schema as any).creditPacks)
      .values({
        id: crypto.randomUUID(),
        organizationId,
        name,
        slug,
        description: description || null,
        credits,
        price,
        currency,
        creditSystemId: creditSystemId || null,
        providerId,
        metadata: metadata || null,
      })
      .returning();

    return c.json({ success: true, data: pack });
  } catch (e: any) {
    if (e?.message?.includes("no such table")) {
      return c.json({ success: false, error: "Credit packs table not yet created. Run migration 0004." }, 500);
    }
    return c.json({ success: false, error: e.message }, 500);
  }
});

// PATCH /:id — Update a credit pack
app.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const parsed = updatePackSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ success: false, error: "Invalid input", details: parsed.error.flatten() }, 400);
  }

  const db = c.get("db");
  const updates: Record<string, unknown> = { updatedAt: Date.now() };

  if (parsed.data.name !== undefined) {
    updates.name = parsed.data.name;
    updates.slug = parsed.data.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }
  if (parsed.data.description !== undefined) updates.description = parsed.data.description;
  if (parsed.data.credits !== undefined) updates.credits = parsed.data.credits;
  if (parsed.data.price !== undefined) updates.price = parsed.data.price;
  if (parsed.data.currency !== undefined) updates.currency = parsed.data.currency;
  if (parsed.data.creditSystemId !== undefined) updates.creditSystemId = parsed.data.creditSystemId;
  if (parsed.data.isActive !== undefined) updates.isActive = parsed.data.isActive;
  if (parsed.data.metadata !== undefined) updates.metadata = parsed.data.metadata;

  try {
    const [updated] = await (db as any)
      .update((schema as any).creditPacks)
      .set(updates)
      .where(eq((schema as any).creditPacks.id, id))
      .returning();

    if (!updated) {
      return c.json({ success: false, error: "Credit pack not found" }, 404);
    }

    return c.json({ success: true, data: updated });
  } catch (e: any) {
    if (e?.message?.includes("no such table")) {
      return c.json({ success: false, error: "Credit packs table not yet created. Run migration 0004." }, 500);
    }
    return c.json({ success: false, error: e.message }, 500);
  }
});

// DELETE /:id — Delete a credit pack
app.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const db = c.get("db");

  try {
    const deleted = await (db as any)
      .delete((schema as any).creditPacks)
      .where(eq((schema as any).creditPacks.id, id))
      .returning({ id: (schema as any).creditPacks.id });

    if (deleted.length === 0) {
      return c.json({ success: false, error: "Credit pack not found" }, 404);
    }

    return c.json({ success: true });
  } catch (e: any) {
    if (e?.message?.includes("no such table")) {
      return c.json({ success: false, error: "Credit packs table not yet created. Run migration 0004." }, 500);
    }
    return c.json({ success: false, error: e.message }, 500);
  }
});

// GET /purchases — List credit purchases for a customer
app.get("/purchases", async (c) => {
  const organizationId = c.get("organizationId");
  const customerId = c.req.query("customerId");

  if (!organizationId) {
    return c.json({ error: "Organization ID required" }, 400);
  }

  const db = c.get("db");

  try {
    if (customerId) {
      const purchases = await (db.query as any).creditPurchases.findMany({
        where: eq((schema as any).creditPurchases.customerId, customerId),
        with: { creditPack: true },
      });
      return c.json({ success: true, data: purchases });
    }

    // All purchases across the org (join through customers)
    const purchases = await (db as any)
      .select({
        id: (schema as any).creditPurchases.id,
        customerId: (schema as any).creditPurchases.customerId,
        creditPackId: (schema as any).creditPurchases.creditPackId,
        creditSystemId: (schema as any).creditPurchases.creditSystemId,
        credits: (schema as any).creditPurchases.credits,
        quantity: (schema as any).creditPurchases.quantity,
        price: (schema as any).creditPurchases.price,
        currency: (schema as any).creditPurchases.currency,
        paymentReference: (schema as any).creditPurchases.paymentReference,
        providerId: (schema as any).creditPurchases.providerId,
        createdAt: (schema as any).creditPurchases.createdAt,
        customerEmail: schema.customers.email,
      })
      .from((schema as any).creditPurchases)
      .innerJoin(
        schema.customers,
        eq(schema.customers.id, (schema as any).creditPurchases.customerId),
      )
      .where(eq(schema.customers.organizationId, organizationId));

    return c.json({ success: true, data: purchases });
  } catch (e: any) {
    if (e?.message?.includes("no such table") || e?.message?.includes("Cannot read properties")) {
      return c.json({ success: true, data: [] });
    }
    return c.json({ success: false, error: e.message }, 500);
  }
});

export default app;
