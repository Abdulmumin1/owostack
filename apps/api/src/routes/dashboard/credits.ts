import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { schema } from "@owostack/db";
import type { Env, Variables } from "../../index";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

const createCreditSystemSchema = z.object({
  organizationId: z.string(),
  name: z.string().min(1),
  description: z.string().optional(),
  features: z
    .array(
      z.object({
        featureId: z.string(),
        cost: z.number().min(0),
      }),
    )
    .default([]),
});

app.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = createCreditSystemSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ success: false, error: "Invalid input" }, 400);
  }

  const {
    organizationId,
    name,
    description,
    features: csFeatures,
  } = parsed.data;
  const db = c.get("db");

  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  try {
    // D1 doesn't support Drizzle transactions - use sequential operations instead
    const featureId = crypto.randomUUID();

    // 1. Create the feature
    const [feat] = await db
      .insert(schema.features)
      .values({
        id: featureId,
        organizationId,
        name: name,
        slug: slug,
        type: "metered",
        meterType: "consumable",
        unit: "credit",
      })
      .returning();

    // 2. Create the credit system (uses same ID as feature)
    const [cs] = await (db as any)
      .insert((schema as any).creditSystems)
      .values({
        id: feat.id,
        organizationId,
        name,
        slug,
        description,
      })
      .returning();

    // 3. Create credit system features if any
    if (csFeatures.length > 0) {
      await (db as any).insert((schema as any).creditSystemFeatures).values(
        csFeatures.map((f) => ({
          id: crypto.randomUUID(),
          creditSystemId: cs.id,
          featureId: f.featureId,
          cost: f.cost,
        })),
      );
    }

    return c.json({ success: true, data: cs });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

app.get("/", async (c) => {
  const organizationId = c.req.query("organizationId");
  if (!organizationId) {
    return c.json({ error: "Organization ID required" }, 400);
  }

  const db = c.get("db");

  try {
    // If relational query fails, fallback to direct select
    if ((db.query as any).creditSystems) {
      const systems = await (db.query as any).creditSystems.findMany({
        where: eq((schema as any).creditSystems.organizationId, organizationId),
        with: {
          features: {
            with: {
              feature: true,
            },
          },
        },
      });
      return c.json({ success: true, data: systems });
    }

    // Fallback manual join
    const systems = await (db as any)
      .select()
      .from((schema as any).creditSystems)
      .where(eq((schema as any).creditSystems.organizationId, organizationId));
    const results = [];

    for (const sys of systems) {
      const features = await (db as any)
        .select()
        .from((schema as any).creditSystemFeatures)
        .innerJoin(
          schema.features,
          eq(
            schema.features.id,
            (schema as any).creditSystemFeatures.featureId,
          ),
        )
        .where(eq((schema as any).creditSystemFeatures.creditSystemId, sys.id));

      results.push({
        ...sys,
        features: features.map((f: any) => ({
          ...f.credit_system_features,
          feature: f.features,
        })),
      });
    }

    return c.json({ success: true, data: results });
  } catch (e: any) {
    console.error("Credits load error:", e);
    return c.json({ success: false, error: e.message }, 500);
  }
});

app.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const db = c.get("db");

  try {
    // D1 doesn't support Drizzle transactions - use sequential operations instead
    await (db as any)
      .delete((schema as any).creditSystems)
      .where(eq((schema as any).creditSystems.id, id));
    await db.delete(schema.features).where(eq(schema.features.id, id));
    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

export default app;
