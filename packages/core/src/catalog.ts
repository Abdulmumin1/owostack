import type {
  CheckResult,
  TrackResult,
  MeteredFeatureConfig,
  PlanFeatureEntry,
  PlanDefinition,
  Currency,
  PlanInterval,
  SyncPayload,
  CatalogEntry,
} from "@owostack/types";

/**
 * Global registry of feature handles.
 * When metered() or boolean() is called, the handle is registered here.
 * The Owostack constructor reads from this to bind all handles to the client.
 * @internal
 */
export const _featureRegistry = new Map<string, MeteredHandle | BooleanHandle>();

/**
 * Base feature handle — bound to an Owostack client instance.
 * Provides .check() for all feature types.
 */
abstract class BaseFeatureHandle {
  readonly slug: string;
  readonly featureType: "metered" | "boolean";
  readonly featureName: string | undefined;

  /** @internal — set by Owostack constructor when processing catalog */
  _client: {
    check: (params: { customer: string; feature: string; value?: number; entity?: string; sendEvent?: boolean }) => Promise<CheckResult>;
    track: (params: { customer: string; feature: string; value?: number; entity?: string }) => Promise<TrackResult>;
  } | null = null;

  constructor(slug: string, featureType: "metered" | "boolean", name?: string) {
    this.slug = slug;
    this.featureType = featureType;
    this.featureName = name;
  }

  private ensureBound() {
    if (!this._client) {
      throw new Error(
        `Feature '${this.slug}' is not bound to an Owostack client. ` +
        `Pass it inside a plan() in the catalog option of new Owostack({}).`
      );
    }
    return this._client;
  }

  /**
   * Check if a customer has access to this feature.
   */
  async check(customer: string, opts?: { value?: number; entity?: string; sendEvent?: boolean }): Promise<CheckResult> {
    const client = this.ensureBound();
    return client.check({
      customer,
      feature: this.slug,
      ...opts,
    });
  }
}

/**
 * MeteredHandle — returned by metered().
 * Has .check(), .track(), .limit(), .unlimited() methods.
 */
export class MeteredHandle extends BaseFeatureHandle {
  constructor(slug: string, name?: string) {
    super(slug, "metered", name);
  }

  /**
   * Track usage for this feature.
   */
  async track(customer: string, value = 1, opts?: { entity?: string }): Promise<TrackResult> {
    if (!this._client) {
      throw new Error(
        `Feature '${this.slug}' is not bound to an Owostack client. ` +
        `Pass it inside a plan() in the catalog option of new Owostack({}).`
      );
    }
    return this._client.track({
      customer,
      feature: this.slug,
      value,
      ...opts,
    });
  }

  /**
   * Create a plan feature entry with a specific limit.
   */
  limit(value: number, config?: Omit<MeteredFeatureConfig, "limit">): PlanFeatureEntry {
    return {
      _type: "plan_feature",
      slug: this.slug,
      featureType: "metered",
      name: this.featureName,
      enabled: true,
      config: { limit: value, ...config },
    };
  }

  /**
   * Create a plan feature entry with no limit (unlimited).
   */
  unlimited(): PlanFeatureEntry {
    return {
      _type: "plan_feature",
      slug: this.slug,
      featureType: "metered",
      name: this.featureName,
      enabled: true,
      config: { limit: null },
    };
  }

  /**
   * Create a plan feature entry with full config.
   */
  config(opts: MeteredFeatureConfig): PlanFeatureEntry {
    return {
      _type: "plan_feature",
      slug: this.slug,
      featureType: "metered",
      name: this.featureName,
      enabled: true,
      config: opts,
    };
  }
}

/**
 * BooleanHandle — returned by boolean().
 * Has .check(), .on(), .off() methods. No .track().
 */
export class BooleanHandle extends BaseFeatureHandle {
  constructor(slug: string, name?: string) {
    super(slug, "boolean", name);
  }

  /**
   * Feature is included in this plan.
   */
  on(): PlanFeatureEntry {
    return {
      _type: "plan_feature",
      slug: this.slug,
      featureType: "boolean",
      name: this.featureName,
      enabled: true,
    };
  }

  /**
   * Feature is NOT included in this plan.
   */
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
 * Create a metered feature handle.
 *
 * @example
 * ```ts
 * const apiCalls = metered("api-calls", { name: "API Calls" });
 *
 * // In a plan:
 * plan("pro", { features: [apiCalls.limit(50000)] })
 *
 * // Direct usage:
 * await apiCalls.check("user@example.com");
 * await apiCalls.track("user@example.com", 1);
 * ```
 */
export function metered(slug: string, opts?: { name?: string }): MeteredHandle {
  const handle = new MeteredHandle(slug, opts?.name);
  _featureRegistry.set(slug, handle);
  return handle;
}

/**
 * Create a boolean feature handle.
 *
 * @example
 * ```ts
 * const analytics = boolean("analytics", { name: "Analytics Dashboard" });
 *
 * // In a plan:
 * plan("pro", { features: [analytics.on()] })
 *
 * // Direct usage:
 * const { allowed } = await analytics.check("user@example.com");
 * ```
 */
export function boolean(slug: string, opts?: { name?: string }): BooleanHandle {
  const handle = new BooleanHandle(slug, opts?.name);
  _featureRegistry.set(slug, handle);
  return handle;
}

/**
 * Create a plan definition for the catalog.
 *
 * @example
 * ```ts
 * plan("pro", {
 *   name: "Pro",
 *   price: 500000,
 *   currency: "NGN",
 *   interval: "monthly",
 *   features: [
 *     apiCalls.limit(50000, { overage: "charge", overagePrice: 100 }),
 *     analytics.on(),
 *     seats.limit(20, { reset: "never" }),
 *   ],
 * })
 * ```
 */
export function plan(slug: string, config: {
  name: string;
  description?: string;
  price: number;
  currency: Currency;
  interval: PlanInterval;
  features: PlanFeatureEntry[];
  planGroup?: string;
  trialDays?: number;
  metadata?: Record<string, unknown>;
}): PlanDefinition {
  return {
    _type: "plan",
    slug,
    ...config,
  };
}

/**
 * Slugifies a feature slug into a human-readable name.
 * "api-calls" → "Api Calls"
 */
function slugToName(slug: string): string {
  return slug
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Extract unique features and plan definitions from the catalog,
 * then serialize into the SyncPayload format for POST /api/sync.
 * @internal
 */
export function buildSyncPayload(catalog: CatalogEntry[]): SyncPayload {
  const featureMap = new Map<string, { slug: string; type: "metered" | "boolean"; name: string }>();

  for (const entry of catalog) {
    if (entry._type !== "plan") continue;
    for (const f of entry.features) {
      if (!featureMap.has(f.slug)) {
        featureMap.set(f.slug, {
          slug: f.slug,
          type: f.featureType,
          name: f.name || slugToName(f.slug),
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
      metadata: p.metadata ?? undefined,
      features: p.features.map((f: PlanFeatureEntry) => ({
        slug: f.slug,
        enabled: f.enabled,
        ...(f.config || {}),
      })),
    }));

  return {
    features: Array.from(featureMap.values()),
    plans,
  };
}

/**
 * Bind all registered feature handles to a client instance.
 * Called by the Owostack constructor after processing the catalog.
 * @internal
 */
export function bindFeatureHandles(
  client: {
    check: (params: { customer: string; feature: string; value?: number; entity?: string; sendEvent?: boolean }) => Promise<CheckResult>;
    track: (params: { customer: string; feature: string; value?: number; entity?: string }) => Promise<TrackResult>;
  },
  catalog?: CatalogEntry[],
): void {
  if (catalog) {
    // Only bind handles that appear in this client's catalog
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
    // Fallback: bind all
    for (const handle of _featureRegistry.values()) {
      handle._client = client;
    }
  }
}
