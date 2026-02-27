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
  const body = c.get("parsedBody") ?? (await c.req.json());
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
  const organizationId = c.get("organizationId");
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

app.get("/:id", async (c) => {
  const id = c.req.param("id");
  const db = c.get("db");

  try {
    // If relational query is available
    if ((db.query as any).creditSystems) {
      const system = await (db.query as any).creditSystems.findFirst({
        where: eq((schema as any).creditSystems.id, id),
        with: {
          features: {
            with: {
              feature: true,
            },
          },
        },
      });

      if (!system) {
        return c.json(
          { success: false, error: "Credit system not found" },
          404,
        );
      }

      return c.json({ success: true, data: system });
    }

    // Fallback manual join
    const [system] = await (db as any)
      .select()
      .from((schema as any).creditSystems)
      .where(eq((schema as any).creditSystems.id, id))
      .limit(1);

    if (!system) {
      return c.json({ success: false, error: "Credit system not found" }, 404);
    }

    const features = await (db as any)
      .select()
      .from((schema as any).creditSystemFeatures)
      .innerJoin(
        schema.features,
        eq(schema.features.id, (schema as any).creditSystemFeatures.featureId),
      )
      .where(eq((schema as any).creditSystemFeatures.creditSystemId, id));

    return c.json({
      success: true,
      data: {
        ...system,
        features: features.map((f: any) => ({
          ...f.credit_system_features,
          feature: f.features,
        })),
      },
    });
  } catch (e: any) {
    console.error("Credits get error:", e);
    return c.json({ success: false, error: e.message }, 500);
  }
});

const updateCreditSystemSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  features: z
    .array(
      z.object({
        featureId: z.string(),
        cost: z.number().min(0),
      }),
    )
    .optional(),
});

app.put("/:id", async (c) => {
  const id = c.req.param("id");
  const body = c.get("parsedBody") ?? (await c.req.json());
  const parsed = updateCreditSystemSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ success: false, error: "Invalid input" }, 400);
  }

  const { name, description, features: csFeatures } = parsed.data;
  const db = c.get("db");

  try {
    // Update credit system name/description
    if (name !== undefined || description !== undefined) {
      const updateData: any = {};
      if (description !== undefined) updateData.description = description;
      if (name !== undefined) {
        updateData.name = name;
        updateData.slug = name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "");
        updateData.updatedAt = Date.now();
      }

      await (db as any)
        .update((schema as any).creditSystems)
        .set(updateData)
        .where(eq((schema as any).creditSystems.id, id));

      // Also update the associated feature name/slug if name changed
      if (name !== undefined) {
        await db
          .update(schema.features)
          .set({
            name,
            slug: updateData.slug,
          })
          .where(eq(schema.features.id, id));
      }
    }

    // Update feature mappings if provided
    if (csFeatures !== undefined) {
      // Delete existing mappings
      await (db as any)
        .delete((schema as any).creditSystemFeatures)
        .where(eq((schema as any).creditSystemFeatures.creditSystemId, id));

      // Insert new mappings
      if (csFeatures.length > 0) {
        await (db as any).insert((schema as any).creditSystemFeatures).values(
          csFeatures.map((f) => ({
            id: crypto.randomUUID(),
            creditSystemId: id,
            featureId: f.featureId,
            cost: f.cost,
          })),
        );
      }
    }

    // Return updated credit system
    const updatedSystem = await (db.query as any).creditSystems?.findFirst({
      where: eq((schema as any).creditSystems.id, id),
      with: {
        features: {
          with: {
            feature: true,
          },
        },
      },
    });

    return c.json({ success: true, data: updatedSystem || { id } });
  } catch (e: any) {
    console.error("Credits update error:", e);
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
