import type {
  CheckResult,
  TrackResult,
  MeteredFeatureConfig,
  PlanFeatureEntry,
  PlanDefinition,
  CreditSystemDefinition,
  CreditPackDefinition,
  Currency,
  PlanInterval,
  ResetInterval,
  SyncPayload,
  CatalogEntry,
  AddEntityResult,
  RemoveEntityResult,
  ListEntitiesResult,
} from "@owostack/types";

/**
 * Global registry of feature handles.
 */
export const _featureRegistry = new Map<string, any>();

/**
 * Base feature functionality for all feature types.
 */
class FeatureMethods {
  static async check(
    handle: any,
    customer: string,
    opts?: { value?: number; entity?: string; sendEvent?: boolean },
  ): Promise<CheckResult> {
    if (!handle._client) {
      throw new Error(
        `Feature '${handle.slug}' is not bound to an Owostack client. ` +
          `Pass it inside a plan() in the catalog option of new Owostack({}).`,
      );
    }
    return handle._client.check({
      customer,
      feature: handle.slug,
      ...opts,
    });
  }
}

/**
 * BooleanHandle — returned by boolean().
 */
export class BooleanHandle {
  readonly slug: string;
  readonly featureType = "boolean" as const;
  readonly featureName: string | undefined;
  _client: any = null;

  constructor(slug: string, name?: string) {
    this.slug = slug;
    this.featureName = name;
  }

  async check(
    customer: string,
    opts?: { value?: number; entity?: string; sendEvent?: boolean },
  ): Promise<CheckResult> {
    return FeatureMethods.check(this, customer, opts);
  }

  on(): PlanFeatureEntry {
    return {
      _type: "plan_feature",
      slug: this.slug,
      featureType: "boolean",
      name: this.featureName,
      enabled: true,
    };
  }

  off(): PlanFeatureEntry {
    return {
      _type: "plan_feature",
      slug: this.slug,
      featureType: "boolean",
      name: this.featureName,
      enabled: false,
    };
  }
}

/**
 * MeteredHandle — returned by metered().
 */
export interface MeteredHandle {
  readonly slug: string;
  readonly featureType: "metered";
  readonly featureName: string | undefined;
  _client: any;

  check(
    customer: string,
    opts?: { value?: number; entity?: string; sendEvent?: boolean },
  ): Promise<CheckResult>;

  track(
    customer: string,
    value?: number,
    opts?: { entity?: string },
  ): Promise<TrackResult>;

  limit(
    value: number,
    config?: Omit<MeteredFeatureConfig, "limit">,
  ): PlanFeatureEntry;

  included(
    value: number,
    config?: Omit<MeteredFeatureConfig, "limit">,
  ): PlanFeatureEntry;

  unlimited(config?: Omit<MeteredFeatureConfig, "limit">): PlanFeatureEntry;

  config(opts: MeteredFeatureConfig): PlanFeatureEntry;

  (creditCost: number): { feature: string; creditCost: number };
}

/**
 * Create a metered feature handle.
 */
export function metered(slug: string, opts?: { name?: string }): MeteredHandle {
  const callable = (creditCost: number) => ({ feature: slug, creditCost });

  const handleProps = {
    slug,
    featureType: "metered" as const,
    featureName: opts?.name,
    _client: null,

    async check(
      customer: string,
      checkOpts?: { value?: number; entity?: string; sendEvent?: boolean },
    ): Promise<CheckResult> {
      return FeatureMethods.check(this, customer, checkOpts);
    },

    async track(
      customer: string,
      value = 1,
      trackOpts?: { entity?: string },
    ): Promise<TrackResult> {
      const handle = this as any;
      if (!handle._client) {
        throw new Error(
          `Feature '${slug}' is not bound to an Owostack client.`,
        );
      }
      return handle._client.track({
        customer,
        feature: slug,
        value,
        ...trackOpts,
      });
    },

    limit(
      value: number,
      config?: Omit<MeteredFeatureConfig, "limit">,
    ): PlanFeatureEntry {
      return {
        _type: "plan_feature",
        slug,
        featureType: "metered",
        name: opts?.name,
        enabled: true,
        config: { limit: value, reset: "monthly", overage: "block", ...config },
      };
    },

    included(
      value: number,
      config?: Omit<MeteredFeatureConfig, "limit">,
    ): PlanFeatureEntry {
      return this.limit(value, config);
    },
    unlimited(config?: Omit<MeteredFeatureConfig, "limit">): PlanFeatureEntry {
      return {
        _type: "plan_feature",
        slug,
        featureType: "metered",
        name: opts?.name,
        enabled: true,
        config: { limit: null, reset: "monthly", overage: "block", ...config },
      };
    },

    config(configOpts: MeteredFeatureConfig): PlanFeatureEntry {
      // Allow explicit enabled: false in config, default to true
      const isEnabled = configOpts.enabled !== false;
      return {
        _type: "plan_feature",
        slug,
        featureType: "metered",
        name: opts?.name,
        enabled: isEnabled,
        config: { reset: "monthly", overage: "block", ...configOpts },
      };
    },
  };

  Object.assign(callable, handleProps);
  _featureRegistry.set(slug, callable);
  return callable as unknown as MeteredHandle;
}

/**
 * Create a boolean feature handle.
 */
export function boolean(slug: string, opts?: { name?: string }): BooleanHandle {
  const handle = new BooleanHandle(slug, opts?.name);
  _featureRegistry.set(slug, handle);
  return handle;
}

/**
 * EntityHandle — returned by entity().
 * Non-consumable features managed via addEntity()/removeEntity().
 */
export class EntityHandle {
  readonly slug: string;
  readonly featureType = "metered" as const;
  readonly meterType = "non_consumable" as const;
  readonly featureName: string | undefined;
  _client: any = null;

  constructor(slug: string, name?: string) {
    this.slug = slug;
    this.featureName = name;
  }

  async check(
    customer: string,
    opts?: { value?: number; entity?: string; sendEvent?: boolean },
  ): Promise<CheckResult> {
    return FeatureMethods.check(this, customer, opts);
  }

  async add(
    customer: string,
    opts: {
      entity: string;
      name?: string;
      email?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<AddEntityResult> {
    if (!this._client) {
      throw new Error(
        `Feature '${this.slug}' is not bound to an Owostack client.`,
      );
    }
    return this._client.addEntity({
      customer,
      feature: this.slug,
      ...opts,
    });
  }

  async remove(customer: string, entity: string): Promise<RemoveEntityResult> {
    if (!this._client) {
      throw new Error(
        `Feature '${this.slug}' is not bound to an Owostack client.`,
      );
    }
    return this._client.removeEntity({
      customer,
      feature: this.slug,
      entity,
    });
  }

  async list(customer: string): Promise<ListEntitiesResult> {
    if (!this._client) {
      throw new Error(
        `Feature '${this.slug}' is not bound to an Owostack client.`,
      );
    }
    return this._client.listEntities({
      customer,
      feature: this.slug,
    });
  }

  limit(
    value: number,
    config?: Omit<MeteredFeatureConfig, "limit">,
  ): PlanFeatureEntry {
    return {
      _type: "plan_feature",
      slug: this.slug,
      featureType: "metered",
      name: this.featureName,
      enabled: true,
      config: { limit: value, reset: "never", overage: "block", ...config },
    };
  }

  unlimited(config?: Omit<MeteredFeatureConfig, "limit">): PlanFeatureEntry {
    return {
      _type: "plan_feature",
      slug: this.slug,
      featureType: "metered",
      name: this.featureName,
      enabled: true,
      config: { limit: null, reset: "never", overage: "block", ...config },
    };
  }

  config(configOpts: MeteredFeatureConfig): PlanFeatureEntry {
    const isEnabled = configOpts.enabled !== false;
    return {
      _type: "plan_feature",
      slug: this.slug,
      featureType: "metered",
      name: this.featureName,
      enabled: isEnabled,
      config: { reset: "never", overage: "block", ...configOpts },
    };
  }
}

/**
 * Create a non-consumable entity feature handle (seats, projects, workspaces).
 * Managed via addEntity()/removeEntity() instead of track().
 */
export function entity(slug: string, opts?: { name?: string }): EntityHandle {
  const handle = new EntityHandle(slug, opts?.name);
  _featureRegistry.set(slug, handle);
  return handle;
}

/**
 * CreditSystemHandle — returned by creditSystem().
 */
export class CreditSystemHandle {
  readonly slug: string;
  readonly name: string | undefined;
  readonly description: string | undefined;
  private featureCosts: Map<string, number>;

  constructor(
    slug: string,
    featureCosts: Map<string, number>,
    opts?: { name?: string; description?: string },
  ) {
    this.slug = slug;
    this.featureCosts = featureCosts;
    this.name = opts?.name;
    this.description = opts?.description;
  }

  credits(
    amount: number,
    config?: { reset?: ResetInterval; overage?: "block" | "charge" },
  ): PlanFeatureEntry {
    return {
      _type: "plan_feature",
      slug: this.slug,
      featureType: "metered",
      name: this.name,
      enabled: true,
      config: {
        limit: amount,
        reset: config?.reset || "monthly",
        overage: config?.overage || "block",
      },
    };
  }

  _buildDefinition(): CreditSystemDefinition {
    return {
      _type: "credit_system",
      slug: this.slug,
      name: this.name || this.slug,
      description: this.description,
      features: Array.from(this.featureCosts.entries()).map(
        ([feature, creditCost]) => ({
          feature,
          creditCost,
        }),
      ),
    };
  }
}

export const _creditSystemRegistry = new Map<string, CreditSystemHandle>();

/**
 * Create a credit system handle.
 */
export function creditSystem(
  slug: string,
  opts: {
    name?: string;
    description?: string;
    features: Array<{ feature: string; creditCost: number }>;
  },
): CreditSystemHandle {
  const featureCosts = new Map<string, number>();

  for (const featureEntry of opts.features) {
    featureCosts.set(featureEntry.feature, featureEntry.creditCost);
  }

  const handle = new CreditSystemHandle(slug, featureCosts, {
    name: opts.name,
    description: opts.description,
  });
  _creditSystemRegistry.set(slug, handle);
  return handle;
}

/**
 * Create a plan definition.
 */
export function plan(
  slug: string,
  config: {
    name: string;
    description?: string;
    price: number;
    currency: Currency;
    interval: PlanInterval;
    features: PlanFeatureEntry[];
    planGroup?: string;
    trialDays?: number;
    provider?: string;
    metadata?: Record<string, unknown>;
    autoEnable?: boolean;
    isAddon?: boolean;
  },
): PlanDefinition {
  return {
    _type: "plan",
    slug,
    ...config,
  };
}

/**
 * Create a credit pack definition.
 * Credit packs are one-time purchases that add credits to a customer's balance.
 */
export function creditPack(
  slug: string,
  config: {
    name: string;
    description?: string;
    credits: number;
    price: number;
    currency: Currency;
    creditSystem: string;
    provider?: string;
    metadata?: Record<string, unknown>;
  },
): CreditPackDefinition {
  return {
    _type: "credit_pack",
    slug,
    ...config,
  };
}

function slugToName(slug: string): string {
  return slug
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Extract SyncPayload from catalog.
 */
export function buildSyncPayload(
  catalog: CatalogEntry[],
  defaultProvider?: string,
): SyncPayload {
  const featureMap = new Map<
    string,
    {
      slug: string;
      type: "metered" | "boolean";
      name: string;
      meterType?: "consumable" | "non_consumable";
    }
  >();

  for (const entry of catalog) {
    if (entry._type !== "plan") continue;
    for (const f of entry.features) {
      if (_creditSystemRegistry.has(f.slug)) continue;
      if (!featureMap.has(f.slug)) {
        const handle = _featureRegistry.get(f.slug);
        featureMap.set(f.slug, {
          slug: f.slug,
          type: f.featureType,
          name: f.name || slugToName(f.slug),
          ...(handle instanceof EntityHandle && {
            meterType: "non_consumable" as const,
          }),
        });
      }
    }
  }

  const creditSystems: SyncPayload["creditSystems"] = catalog
    .filter((e): e is CreditSystemDefinition => e._type === "credit_system")
    .map((cs) => ({
      slug: cs.slug,
      name: cs.name,
      description: cs.description,
      features: cs.features,
    }));

  for (const entry of catalog) {
    if (entry._type !== "plan") continue;
    for (const f of entry.features) {
      const csHandle = _creditSystemRegistry.get(f.slug);
      if (csHandle && !creditSystems.find((cs) => cs.slug === f.slug)) {
        const def = csHandle._buildDefinition();
        creditSystems.push({
          slug: def.slug,
          name: def.name,
          description: def.description,
          features: def.features,
        });
      }
    }
  }

  const plans = catalog
    .filter((e): e is PlanDefinition => e._type === "plan")
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      description: p.description ?? undefined,
      price: p.price,
      currency: p.currency,
      interval: p.interval,
      planGroup: p.planGroup ?? undefined,
      trialDays: p.trialDays ?? undefined,
      provider: p.provider ?? undefined,
      metadata: p.metadata ?? undefined,
      autoEnable: p.autoEnable ?? undefined,
      isAddon: p.isAddon ?? undefined,
      features: p.features.map((f: PlanFeatureEntry) => ({
        slug: f.slug,
        enabled: f.enabled,
        // Boolean features have no limit concept (null), metered features use limit from config
        limit: f.featureType === "boolean" ? null : (f.config?.limit ?? null),
        // Boolean features have no reset interval
        ...(f.featureType !== "boolean" && {
          reset: f.config?.reset || "monthly",
        }),
        ...(f.config?.overage && { overage: f.config.overage }),
        ...(f.config?.overagePrice !== undefined && {
          overagePrice: f.config.overagePrice,
        }),
        ...(f.config?.maxOverageUnits !== undefined && {
          maxOverageUnits: f.config.maxOverageUnits,
        }),
        ...(f.config?.billingUnits !== undefined && {
          billingUnits: f.config.billingUnits,
        }),
        ...(f.config?.creditCost !== undefined && {
          creditCost: f.config.creditCost,
        }),
      })),
    }));

  const creditPacks = catalog
    .filter((e): e is CreditPackDefinition => e._type === "credit_pack")
    .map((cp) => ({
      slug: cp.slug,
      name: cp.name,
      description: cp.description ?? undefined,
      credits: cp.credits,
      price: cp.price,
      currency: cp.currency,
      creditSystem: cp.creditSystem,
      provider: cp.provider ?? undefined,
      metadata: cp.metadata ?? undefined,
    }));

  return {
    defaultProvider,
    features: Array.from(featureMap.values()),
    creditSystems,
    creditPacks,
    plans,
  };
}

/**
 * Bind handles to client.
 */
export function bindFeatureHandles(
  client: any,
  catalog?: CatalogEntry[],
): void {
  if (catalog) {
    const slugsInCatalog = new Set<string>();
    for (const entry of catalog) {
      if (entry._type === "plan") {
        for (const f of entry.features) {
          slugsInCatalog.add(f.slug);
        }
      }
    }
    for (const [slug, handle] of _featureRegistry) {
      if (slugsInCatalog.has(slug)) {
        handle._client = client;
      }
    }
  } else {
    for (const handle of _featureRegistry.values()) {
      handle._client = client;
    }
  }
}
