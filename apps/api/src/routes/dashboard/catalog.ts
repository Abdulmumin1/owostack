import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { schema } from "@owostack/db";
import type { Env, Variables } from "../../index";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// =============================================================================
// Export catalog — returns all org catalog data as JSON
// =============================================================================
app.get("/export", async (c) => {
  const organizationId = c.req.query("organizationId");
  if (!organizationId) {
    return c.json({ success: false, error: "Organization ID required" }, 400);
  }

  const db = c.get("db");

  const [features, plans, creditSystemRows, creditPackRows, overageSettingsRow]: any[] =
    await Promise.all([
      db.query.features.findMany({
        where: eq(schema.features.organizationId, organizationId),
      }),
      db.query.plans.findMany({
        where: eq(schema.plans.organizationId, organizationId),
        with: { planFeatures: true },
      }),
      db.query.creditSystems.findMany({
        where: eq(schema.creditSystems.organizationId, organizationId),
        with: { features: true },
      }),
      (db.query as any).creditPacks?.findMany({
        where: eq(schema.creditPacks.organizationId, organizationId),
      }) ?? Promise.resolve([]),
      (db.query as any).overageSettings?.findFirst({
        where: eq(schema.overageSettings.organizationId, organizationId),
      }) ?? Promise.resolve(null),
    ]);

  return c.json({
    success: true,
    data: {
      features: features.map((f: any) => ({
        id: f.id,
        name: f.name,
        slug: f.slug,
        description: f.description,
        type: f.type,
        meterType: (f as any).meterType,
        unit: (f as any).unit,
        source: (f as any).source,
      })),
      plans: plans.map((p: any) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        description: p.description,
        price: p.price,
        currency: p.currency,
        interval: p.interval,
        type: p.type,
        billingModel: p.billingModel,
        billingType: p.billingType,
        trialDays: p.trialDays,
        trialCardRequired: p.trialCardRequired,
        isAddon: p.isAddon,
        autoEnable: p.autoEnable,
        planGroup: p.planGroup,
        isActive: p.isActive,
        version: p.version,
        source: p.source,
        metadata: p.metadata,
        planFeatures: (p.planFeatures || []).map((pf: any) => ({
          featureId: pf.featureId,
          limitValue: pf.limitValue,
          resetInterval: pf.resetInterval,
          resetOnEnable: pf.resetOnEnable,
          rolloverEnabled: pf.rolloverEnabled,
          rolloverMaxBalance: pf.rolloverMaxBalance,
          usageModel: pf.usageModel,
          pricePerUnit: pf.pricePerUnit,
          billingUnits: pf.billingUnits,
          maxPurchaseLimit: pf.maxPurchaseLimit,
          creditCost: pf.creditCost,
          overage: pf.overage,
          overagePrice: pf.overagePrice,
          maxOverageUnits: pf.maxOverageUnits,
        })),
      })),
      creditSystems: creditSystemRows.map((cs: any) => ({
        id: cs.id,
        name: cs.name,
        slug: cs.slug,
        description: cs.description,
        features: (cs.features || []).map((csf: any) => ({
          featureId: csf.featureId,
          cost: csf.cost,
        })),
      })),
      creditPacks: (creditPackRows || []).map((cp: any) => ({
        id: cp.id,
        name: cp.name,
        slug: cp.slug,
        description: cp.description,
        credits: cp.credits,
        price: cp.price,
        currency: cp.currency,
        creditSystemId: cp.creditSystemId,
        isActive: cp.isActive,
        metadata: cp.metadata,
      })),
      overageSettings: overageSettingsRow
        ? {
            billingInterval: (overageSettingsRow as any).billingInterval,
            thresholdAmount: (overageSettingsRow as any).thresholdAmount,
            autoCollect: (overageSettingsRow as any).autoCollect,
            gracePeriodHours: (overageSettingsRow as any).gracePeriodHours,
          }
        : null,
    },
  });
});

// =============================================================================
// Import catalog — upserts catalog data (skip existing by slug)
// =============================================================================
app.post("/import", async (c) => {
  const body = await c.req.json();
  const { organizationId, catalog } = body;

  if (!organizationId || !catalog) {
    return c.json(
      { success: false, error: "organizationId and catalog required" },
      400,
    );
  }

  const db = c.get("db");

  const result = {
    features: { created: 0, skipped: 0 },
    plans: { created: 0, skipped: 0 },
    planFeatures: { created: 0, skipped: 0 },
    creditSystems: { created: 0, skipped: 0 },
    creditSystemFeatures: { created: 0, skipped: 0 },
    creditPacks: { created: 0, skipped: 0 },
    overageSettings: { created: 0, skipped: 0 },
  };

  try {
    // ID mappings: source (test) ID → target (live) ID
    const featureIdMap = new Map<string, string>();
    const planIdMap = new Map<string, string>();
    const creditSystemIdMap = new Map<string, string>();

    // =====================================================================
    // 1. Features — match by slug
    // =====================================================================
    const existingFeatures = await db.query.features.findMany({
      where: eq(schema.features.organizationId, organizationId),
    });
    const existingFeatureBySlug = new Map<string, any>(
      existingFeatures.map((f: any) => [f.slug, f]),
    );

    for (const f of catalog.features || []) {
      const existing = existingFeatureBySlug.get(f.slug);
      if (existing) {
        featureIdMap.set(f.id, existing.id);
        result.features.skipped++;
      } else {
        const newId = crypto.randomUUID();
        await db.insert(schema.features).values({
          id: newId,
          organizationId,
          name: f.name,
          slug: f.slug,
          description: f.description || null,
          type: f.type || "metered",
          meterType: f.meterType || "consumable",
          unit: f.unit || null,
          source: f.source || "dashboard",
        });
        featureIdMap.set(f.id, newId);
        result.features.created++;
      }
    }

    // =====================================================================
    // 2. Credit Systems — match by slug
    // =====================================================================
    const existingCreditSystems =
      (await (db.query as any).creditSystems?.findMany({
        where: eq(schema.creditSystems.organizationId, organizationId),
      })) ?? [];
    const existingCsBySlug = new Map<string, any>(
      existingCreditSystems.map((cs: any) => [cs.slug, cs]),
    );

    for (const cs of catalog.creditSystems || []) {
      const existing = existingCsBySlug.get(cs.slug);
      if (existing) {
        creditSystemIdMap.set(cs.id, existing.id);
        result.creditSystems.skipped++;
      } else {
        const newId = crypto.randomUUID();
        await db.insert(schema.creditSystems).values({
          id: newId,
          organizationId,
          name: cs.name,
          slug: cs.slug,
          description: cs.description || null,
        });
        creditSystemIdMap.set(cs.id, newId);
        result.creditSystems.created++;
      }

      // Credit system features
      const targetCsId = creditSystemIdMap.get(cs.id)!;
      const existingCsFeatures = await db.query.creditSystemFeatures.findMany({
        where: eq(schema.creditSystemFeatures.creditSystemId, targetCsId),
      });
      const existingCsfByFeature = new Set(
        existingCsFeatures.map((csf: any) => csf.featureId),
      );

      for (const csf of cs.features || []) {
        const mappedFeatureId = featureIdMap.get(csf.featureId);
        if (!mappedFeatureId) continue;

        if (existingCsfByFeature.has(mappedFeatureId)) {
          result.creditSystemFeatures.skipped++;
        } else {
          await db.insert(schema.creditSystemFeatures).values({
            id: crypto.randomUUID(),
            creditSystemId: targetCsId,
            featureId: mappedFeatureId,
            cost: csf.cost ?? 1,
          });
          result.creditSystemFeatures.created++;
        }
      }
    }

    // =====================================================================
    // 3. Plans — match by slug (skip provider-specific IDs)
    // =====================================================================
    const existingPlans = await db.query.plans.findMany({
      where: eq(schema.plans.organizationId, organizationId),
      with: { planFeatures: true },
    });
    const existingPlanBySlug = new Map<string, any>(
      existingPlans.map((p: any) => [p.slug, p]),
    );

    for (const p of catalog.plans || []) {
      const existing = existingPlanBySlug.get(p.slug);
      if (existing) {
        planIdMap.set(p.id, existing.id);
        result.plans.skipped++;

        // Still check for missing plan_features on existing plans
        const existingPfByFeature = new Set(
          ((existing as any).planFeatures || []).map(
            (pf: any) => pf.featureId,
          ),
        );

        for (const pf of p.planFeatures || []) {
          const mappedFeatureId = featureIdMap.get(pf.featureId);
          if (!mappedFeatureId) continue;

          if (existingPfByFeature.has(mappedFeatureId)) {
            result.planFeatures.skipped++;
          } else {
            await db.insert(schema.planFeatures).values({
              id: crypto.randomUUID(),
              planId: existing.id,
              featureId: mappedFeatureId,
              limitValue: pf.limitValue,
              resetInterval: pf.resetInterval || "monthly",
              resetOnEnable: pf.resetOnEnable ?? true,
              rolloverEnabled: pf.rolloverEnabled ?? false,
              rolloverMaxBalance: pf.rolloverMaxBalance,
              usageModel: pf.usageModel || "included",
              pricePerUnit: pf.pricePerUnit,
              billingUnits: pf.billingUnits,
              maxPurchaseLimit: pf.maxPurchaseLimit,
              creditCost: pf.creditCost,
              overage: pf.overage || "block",
              overagePrice: pf.overagePrice,
              maxOverageUnits: pf.maxOverageUnits,
            });
            result.planFeatures.created++;
          }
        }
      } else {
        const newPlanId = crypto.randomUUID();
        await db.insert(schema.plans).values({
          id: newPlanId,
          organizationId,
          name: p.name,
          slug: p.slug,
          description: p.description || null,
          price: p.price,
          currency: p.currency || "USD",
          interval: p.interval || "monthly",
          type: p.type || "paid",
          billingModel: p.billingModel || "base",
          billingType: p.billingType || "recurring",
          trialDays: p.trialDays || 0,
          trialCardRequired: p.trialCardRequired ?? false,
          isAddon: p.isAddon ?? false,
          autoEnable: p.autoEnable ?? false,
          planGroup: p.planGroup || null,
          isActive: p.isActive ?? true,
          version: p.version || 1,
          source: p.source || "dashboard",
          metadata: p.metadata || null,
          // Provider-specific IDs intentionally omitted — will be synced on first use
        });
        planIdMap.set(p.id, newPlanId);
        result.plans.created++;

        // Create plan_features for new plan
        for (const pf of p.planFeatures || []) {
          const mappedFeatureId = featureIdMap.get(pf.featureId);
          if (!mappedFeatureId) continue;

          await db.insert(schema.planFeatures).values({
            id: crypto.randomUUID(),
            planId: newPlanId,
            featureId: mappedFeatureId,
            limitValue: pf.limitValue,
            resetInterval: pf.resetInterval || "monthly",
            resetOnEnable: pf.resetOnEnable ?? true,
            rolloverEnabled: pf.rolloverEnabled ?? false,
            rolloverMaxBalance: pf.rolloverMaxBalance,
            usageModel: pf.usageModel || "included",
            pricePerUnit: pf.pricePerUnit,
            billingUnits: pf.billingUnits,
            maxPurchaseLimit: pf.maxPurchaseLimit,
            creditCost: pf.creditCost,
            overage: pf.overage || "block",
            overagePrice: pf.overagePrice,
            maxOverageUnits: pf.maxOverageUnits,
          });
          result.planFeatures.created++;
        }
      }
    }

    // =====================================================================
    // 4. Credit Packs — match by slug
    // =====================================================================
    const existingPacks =
      (await (db.query as any).creditPacks?.findMany({
        where: eq(schema.creditPacks.organizationId, organizationId),
      })) ?? [];
    const existingPackBySlug = new Map<string, any>(
      existingPacks.map((cp: any) => [cp.slug, cp]),
    );

    for (const cp of catalog.creditPacks || []) {
      if (existingPackBySlug.has(cp.slug)) {
        result.creditPacks.skipped++;
        continue;
      }

      // If the pack requires a credit system but the mapping failed, skip it
      // rather than inserting with null (which breaks scoped add-on credits)
      if (cp.creditSystemId && !creditSystemIdMap.has(cp.creditSystemId)) {
        result.creditPacks.skipped++;
        continue;
      }

      const mappedCsId = cp.creditSystemId
        ? creditSystemIdMap.get(cp.creditSystemId)!
        : null;

      await db.insert(schema.creditPacks).values({
        id: crypto.randomUUID(),
        organizationId,
        name: cp.name,
        slug: cp.slug,
        description: cp.description || null,
        credits: cp.credits,
        price: cp.price,
        currency: cp.currency || "USD",
        creditSystemId: mappedCsId,
        isActive: cp.isActive ?? true,
        metadata: cp.metadata || null,
        // Provider product/price IDs omitted — will be synced on first use
      });
      result.creditPacks.created++;
    }

    // =====================================================================
    // 5. Overage Settings — single row per org, skip if exists
    // =====================================================================
    if (catalog.overageSettings) {
      const existingOverage = await (
        db.query as any
      ).overageSettings?.findFirst({
        where: eq(schema.overageSettings.organizationId, organizationId),
      });

      if (existingOverage) {
        result.overageSettings.skipped++;
      } else {
        await db.insert(schema.overageSettings).values({
          id: crypto.randomUUID(),
          organizationId,
          billingInterval:
            catalog.overageSettings.billingInterval || "end_of_period",
          thresholdAmount: catalog.overageSettings.thresholdAmount,
          autoCollect: catalog.overageSettings.autoCollect ?? false,
          gracePeriodHours: catalog.overageSettings.gracePeriodHours ?? 0,
        });
        result.overageSettings.created++;
      }
    }
  } catch (e: any) {
    return c.json(
      { success: false, error: e.message || "Import failed", data: result },
      500,
    );
  }

  return c.json({ success: true, data: result });
});

export default app;
