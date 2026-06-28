import { Hono } from "hono";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
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

async function validateFeatureMappings(params: {
  db: any;
  organizationId?: string;
  mappings: Array<{ featureId: string; cost: number }>;
}) {
  const { db, organizationId, mappings } = params;

  const uniqueFeatureIds = [...new Set(mappings.map((mapping) => mapping.featureId))];

  if (uniqueFeatureIds.length !== mappings.length) {
    return {
      ok: false as const,
      status: 400,
      body: {
        success: false,
        error: "Duplicate featureId values are not allowed in credit system mappings",
      },
    };
  }

  if (uniqueFeatureIds.length === 0) {
    return { ok: true as const };
  }

  const featureWhere = organizationId
    ? and(
        inArray(schema.features.id, uniqueFeatureIds),
        eq(schema.features.organizationId, organizationId),
      )
    : inArray(schema.features.id, uniqueFeatureIds);

  const features = await db.query.features.findMany({
    where: featureWhere,
  });
  const foundFeatureIds = new Set(features.map((feature: any) => feature.id));
  const missingFeatureIds = uniqueFeatureIds.filter(
    (featureId) => !foundFeatureIds.has(featureId),
  );

  if (missingFeatureIds.length > 0) {
    return {
      ok: false as const,
      status: 400,
      body: {
        success: false,
        error: `Unknown featureId values: ${missingFeatureIds.join(", ")}`,
      },
    };
  }

  return { ok: true as const };
}

app.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = createCreditSystemSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ success: false, error: "Invalid input" }, 400);
  }

  const {
    organizationId: orgIdFromData,
    name,
    description,
    features: csFeatures,
  } = parsed.data;
  const organizationId = c.get("organizationId") ?? orgIdFromData;
  const db = c.get("db");

  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  try {
    const validation = await validateFeatureMappings({
      db,
      organizationId,
      mappings: csFeatures,
    });

    if (!validation.ok) {
      return c.json(validation.body, validation.status as any);
    }

    const featureId = crypto.randomUUID();
    const now = Date.now();

    await c.env.DB.batch([
      c.env.DB
        .prepare(
          `INSERT INTO features
           (id, organization_id, name, slug, type, meter_type, unit, source, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          featureId,
          organizationId,
          name,
          slug,
          "metered",
          "consumable",
          "credit",
          "dashboard",
          now,
        ),
      c.env.DB
        .prepare(
          `INSERT INTO credit_systems
           (id, organization_id, name, slug, description, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(featureId, organizationId, name, slug, description ?? null, now, now),
      ...csFeatures.map((feature) =>
        c.env.DB
          .prepare(
            `INSERT INTO credit_system_features
             (id, credit_system_id, feature_id, cost, created_at)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .bind(
            crypto.randomUUID(),
            featureId,
            feature.featureId,
            feature.cost,
            now,
          ),
      ),
    ]);

    const createdSystem = await (db.query as any).creditSystems?.findFirst({
      where: eq((schema as any).creditSystems.id, featureId),
      with: {
        features: {
          with: {
            feature: true,
          },
        },
      },
    });

    return c.json({ success: true, data: createdSystem || { id: featureId } });
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

async function validateCreditSystemFeatureMappings(params: {
  db: any;
  creditSystemId: string;
  organizationId?: string;
  mappings: Array<{ featureId: string; cost: number }>;
}) {
  const { db, creditSystemId, organizationId, mappings } = params;

  const creditSystem = await (db.query as any).creditSystems?.findFirst({
    where: organizationId
      ? and(
          eq((schema as any).creditSystems.id, creditSystemId),
          eq((schema as any).creditSystems.organizationId, organizationId),
        )
      : eq((schema as any).creditSystems.id, creditSystemId),
  });

  if (!creditSystem) {
    return {
      ok: false as const,
      status: 404,
      body: {
        success: false,
        error: "Credit system not found",
      },
    };
  }

  return validateFeatureMappings({
    db,
    organizationId,
    mappings,
  });
}

app.put("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const parsed = updateCreditSystemSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ success: false, error: "Invalid input" }, 400);
  }

  const { name, description, features: csFeatures } = parsed.data;
  const db = c.get("db");
  const organizationId = c.get("organizationId") as string | undefined;

  try {
    if (csFeatures !== undefined) {
      const validation = await validateCreditSystemFeatureMappings({
        db,
        creditSystemId: id,
        organizationId,
        mappings: csFeatures,
      });

      if (!validation.ok) {
        return c.json(validation.body, validation.status as any);
      }
    }

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
      const statements = [
        c.env.DB
          .prepare(
            "DELETE FROM credit_system_features WHERE credit_system_id = ?",
          )
          .bind(id),
        ...csFeatures.map((feature) =>
          c.env.DB
            .prepare(
              `INSERT INTO credit_system_features
               (id, credit_system_id, feature_id, cost, created_at)
               VALUES (?, ?, ?, ?, ?)`,
            )
            .bind(
              crypto.randomUUID(),
              id,
              feature.featureId,
              feature.cost,
              Date.now(),
            ),
        ),
      ];

      await c.env.DB.batch(statements);
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
