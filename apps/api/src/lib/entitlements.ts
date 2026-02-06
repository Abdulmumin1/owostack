import { Result } from "better-result";
import type { createDb } from "@owostack/db";
import { schema } from "@owostack/db";
import { eq, and, gte, lte, sql, desc } from "drizzle-orm";
import { NotFoundError, DatabaseError } from "./errors";
import { getResetPeriod } from "./reset-period";

type DB = ReturnType<typeof createDb>;

type PlanFeatureRow = typeof schema.planFeatures.$inferSelect & {
  feature: typeof schema.features.$inferSelect;
};

export interface CheckAccessResult {
  allowed: boolean;
  reason?: string;
  usage?: {
    current: number;
    limit: number | null;
    remaining: number | null;
    resetAt?: string;
  };
}

export interface TrackUsageResult {
  success: boolean;
  usage: {
    current: number;
    limit: number | null;
    remaining: number | null;
  };
}

export class EntitlementService {
  constructor(private db: DB) {}

  async checkAccess(
    customerId: string,
    featureSlug: string,
    amount: number = 1,
  ): Promise<Result<CheckAccessResult, NotFoundError | DatabaseError>> {
    return Result.tryPromise({
      try: async () => {
        const subscription = await this.db.query.subscriptions.findFirst({
          where: and(
            eq(schema.subscriptions.customerId, customerId),
            eq(schema.subscriptions.status, "active"),
          ),
          with: {
            plan: {
              with: {
                planFeatures: {
                  with: {
                    feature: true,
                  },
                },
              },
            },
          },
        });

        if (!subscription) {
          return { allowed: false, reason: "No active subscription" };
        }

        let planFeature = subscription.plan.planFeatures.find(
          (pf: PlanFeatureRow) => pf.feature.slug === featureSlug,
        );

        let creditMapping: any = null;
        if (!planFeature) {
          const mappedSystems = await this.db
            .select({
              id: (schema as any).creditSystemFeatures.id,
              creditSystemId: (schema as any).creditSystemFeatures
                .creditSystemId,
              featureId: (schema as any).creditSystemFeatures.featureId,
              cost: (schema as any).creditSystemFeatures.cost,
              creditSystemSlug: (schema as any).creditSystems.slug,
            })
            .from((schema as any).creditSystemFeatures)
            .innerJoin(
              (schema as any).creditSystems,
              eq(
                (schema as any).creditSystems.id,
                (schema as any).creditSystemFeatures.creditSystemId,
              ),
            )
            .where(
              eq(
                (schema as any).creditSystemFeatures.featureId,
                sql`(SELECT id FROM features WHERE slug = ${featureSlug} LIMIT 1)`,
              ),
            );

          for (const ms of mappedSystems) {
            const pf = subscription.plan.planFeatures.find(
              (pf: PlanFeatureRow) => pf.feature.slug === ms.creditSystemSlug,
            );
            if (pf) {
              planFeature = pf;
              creditMapping = ms;
              break;
            }
          }
        }

        if (!planFeature) {
          return {
            allowed: false,
            reason: `Feature '${featureSlug}' not included in plan`,
          };
        }

        const effectiveAmount = creditMapping
          ? amount * creditMapping.cost
          : amount;
        const featureIdToCheck = creditMapping
          ? creditMapping.creditSystemId
          : planFeature.featureId;

        if (planFeature.limitValue !== null) {
          const { periodStart, periodEnd } = getResetPeriod(
            planFeature.resetInterval,
            subscription.currentPeriodStart,
            subscription.currentPeriodEnd,
          );

          const usage = await this.getCurrentUsage(
            customerId,
            featureIdToCheck,
            periodStart,
            periodEnd,
          );

          if (usage + effectiveAmount > planFeature.limitValue) {
            return {
              allowed: false,
              reason: "Usage limit exceeded",
              usage: {
                current: usage,
                limit: planFeature.limitValue,
                remaining: Math.max(0, planFeature.limitValue - usage),
                resetAt: new Date(periodEnd).toISOString(),
              },
            };
          }

          return {
            allowed: true,
            usage: {
              current: usage,
              limit: planFeature.limitValue,
              remaining: Math.max(
                0,
                planFeature.limitValue - usage - effectiveAmount,
              ),
              resetAt: new Date(periodEnd).toISOString(),
            },
          };
        }

        return {
          allowed: true,
          reason: "Unlimited access",
          usage: { current: 0, limit: null, remaining: null },
        };
      },
      catch: (e) => new DatabaseError({ operation: "checkAccess", cause: e }),
    });
  }

  async trackUsage(
    customerId: string,
    featureSlug: string,
    amount: number = 1,
  ): Promise<Result<TrackUsageResult, NotFoundError | DatabaseError>> {
    return Result.tryPromise({
      try: async () => {
        const feature = await this.db.query.features.findFirst({
          where: eq(schema.features.slug, featureSlug),
        });

        if (!feature) {
          throw new NotFoundError({ resource: "Feature", id: featureSlug });
        }

        const subscription = await this.db.query.subscriptions.findFirst({
          where: and(
            eq(schema.subscriptions.customerId, customerId),
            eq(schema.subscriptions.status, "active"),
          ),
          orderBy: [desc(schema.subscriptions.createdAt)],
          with: {
            plan: {
              with: {
                planFeatures: { with: { feature: true } },
              },
            },
          },
        });

        let trackingFeatureId = feature.id;
        let trackingAmount = amount;
        let limit: number | null = null;

        // Compute reset-interval-aware period boundaries
        let periodStart =
          subscription?.currentPeriodStart ||
          new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
        let periodEnd =
          subscription?.currentPeriodEnd ||
          new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getTime();

        if (subscription) {
          let planFeature = subscription.plan.planFeatures.find(
            (pf: PlanFeatureRow) => pf.feature.slug === featureSlug,
          );

          if (!planFeature) {
            const mapped = await (this.db as any)
              .select()
              .from((schema as any).creditSystemFeatures)
              .innerJoin(
                (schema as any).creditSystems,
                eq(
                  (schema as any).creditSystems.id,
                  (schema as any).creditSystemFeatures.creditSystemId,
                ),
              )
              .where(
                eq((schema as any).creditSystemFeatures.featureId, feature.id),
              )
              .limit(1);

            if (mapped.length > 0) {
              const ms = mapped[0];
              const pf = subscription.plan.planFeatures.find(
                (pf: PlanFeatureRow) => pf.feature.slug === ms.creditSystems.slug,
              );
              if (pf) {
                planFeature = pf;
                trackingFeatureId = ms.creditSystems.id;
                trackingAmount = amount * ms.creditSystemFeatures.cost;
              }
            }
          }

          limit = planFeature?.limitValue ?? null;

          // Use the feature's resetInterval for period calculation
          if (planFeature) {
            const resetPeriod = getResetPeriod(
              planFeature.resetInterval,
              subscription.currentPeriodStart,
              subscription.currentPeriodEnd,
            );
            periodStart = resetPeriod.periodStart;
            periodEnd = resetPeriod.periodEnd;
          }
        }

        await this.db.insert(schema.usageRecords).values({
          id: crypto.randomUUID(),
          customerId,
          featureId: trackingFeatureId,
          amount: trackingAmount,
          periodStart,
          periodEnd,
        });

        const newUsage = await this.getCurrentUsage(
          customerId,
          trackingFeatureId,
          periodStart,
          periodEnd,
        );

        return {
          success: true,
          usage: {
            current: newUsage,
            limit,
            remaining: limit !== null ? Math.max(0, limit - newUsage) : null,
          },
        };
      },
      catch: (e) => {
        if (e instanceof NotFoundError) return e;
        return new DatabaseError({ operation: "trackUsage", cause: e });
      },
    });
  }

  private async getCurrentUsage(
    customerId: string,
    featureId: string,
    start: number,
    end: number,
  ): Promise<number> {
    const result = await this.db
      .select({
        total: sql<number>`COALESCE(SUM(${schema.usageRecords.amount}), 0)`,
      })
      .from(schema.usageRecords)
      .where(
        and(
          eq(schema.usageRecords.customerId, customerId),
          eq(schema.usageRecords.featureId, featureId),
          gte(schema.usageRecords.periodStart, start),
          lte(schema.usageRecords.periodEnd, end),
        ),
      );

    return Number(result[0]?.total || 0);
  }
}
