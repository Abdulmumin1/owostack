/**
 * KV Cache utilities for entitlement lookups
 * TTL: 60 seconds by default
 */

const KV_MIN_TTL = 60; // Cloudflare KV requires expiration_ttl >= 60 seconds
const DEFAULT_TTL = 60; // seconds
const FEATURE_TTL = 300; // 5 min — rarely changes, invalidated on dashboard edits
const PLAN_FEATURE_TTL = 300; // 5 min — rarely changes, invalidated on plan edits
const SUBSCRIPTION_TTL = 120; // 2 min — more dynamic, invalidated on mutations
const MANUAL_ENTITLEMENT_TTL = KV_MIN_TTL; // KV minimum; shorter values are rejected

type CacheKey =
  | `org:${string}:customer:${string}`
  | `org:${string}:feature:${string}`
  | `org:${string}:subscriptions:${string}`
  | `org:${string}:planFeatures:${string}`
  | `org:${string}:manualEntitlement:${string}`;

export class EntitlementCache {
  constructor(private kv: KVNamespace) {}

  private normalizeTtl(ttl: number): number {
    return Math.max(KV_MIN_TTL, Math.ceil(ttl));
  }

  private key(type: string, orgId: string, id: string): CacheKey {
    return `org:${orgId}:${type}:${id}` as CacheKey;
  }

  // ==========================================================================
  // Customer Cache
  // ==========================================================================

  async getCustomer<T>(orgId: string, customerId: string): Promise<T | null> {
    const cached = await this.kv.get(this.key("customer", orgId, customerId), "json");
    return cached as T | null;
  }

  async setCustomer<T>(orgId: string, customerId: string, data: T, ttl = DEFAULT_TTL): Promise<void> {
    await this.kv.put(
      this.key("customer", orgId, customerId),
      JSON.stringify(data),
      { expirationTtl: this.normalizeTtl(ttl) }
    );
  }

  async invalidateCustomer(orgId: string, customerId: string): Promise<void> {
    await this.kv.delete(this.key("customer", orgId, customerId));
  }

  async setCustomerAliases<T>(
    orgId: string,
    customer: { id?: string | null; email?: string | null; externalId?: string | null },
    data: T,
    ttl = DEFAULT_TTL,
  ): Promise<void> {
    const aliases = [
      customer.id,
      customer.email?.toLowerCase(),
      customer.externalId,
    ].filter((v): v is string => typeof v === "string" && v.length > 0);

    if (aliases.length === 0) return;

    const unique = [...new Set(aliases)];
    await Promise.all(unique.map((alias) => this.setCustomer(orgId, alias, data, ttl)));
  }

  async invalidateCustomerAliases(
    orgId: string,
    customer: { id?: string | null; email?: string | null; externalId?: string | null },
  ): Promise<void> {
    const aliases = [
      customer.id,
      customer.email?.toLowerCase(),
      customer.externalId,
    ].filter((v): v is string => typeof v === "string" && v.length > 0);

    if (aliases.length === 0) return;

    const unique = [...new Set(aliases)];
    await Promise.all(unique.map((alias) => this.invalidateCustomer(orgId, alias)));
  }

  // ==========================================================================
  // Feature Cache
  // ==========================================================================

  async getFeature<T>(orgId: string, featureId: string): Promise<T | null> {
    const cached = await this.kv.get(this.key("feature", orgId, featureId), "json");
    return cached as T | null;
  }

  async setFeature<T>(orgId: string, featureId: string, data: T, ttl = FEATURE_TTL): Promise<void> {
    await this.kv.put(
      this.key("feature", orgId, featureId),
      JSON.stringify(data),
      { expirationTtl: this.normalizeTtl(ttl) }
    );
  }

  async invalidateFeature(orgId: string, featureId: string): Promise<void> {
    await this.kv.delete(this.key("feature", orgId, featureId));
  }

  // ==========================================================================
  // Subscriptions Cache (by customer)
  // ==========================================================================

  async getSubscriptions<T>(orgId: string, customerId: string): Promise<T | null> {
    const cached = await this.kv.get(this.key("subscriptions", orgId, customerId), "json");
    return cached as T | null;
  }

  async setSubscriptions<T>(orgId: string, customerId: string, data: T, ttl = SUBSCRIPTION_TTL): Promise<void> {
    await this.kv.put(
      this.key("subscriptions", orgId, customerId),
      JSON.stringify(data),
      { expirationTtl: this.normalizeTtl(ttl) }
    );
  }

  async invalidateSubscriptions(orgId: string, customerId: string): Promise<void> {
    await this.kv.delete(this.key("subscriptions", orgId, customerId));
  }

  // ==========================================================================
  // PlanFeatures Cache (by planId:featureId combo)
  // ==========================================================================

  async getPlanFeatures<T>(orgId: string, cacheKey: string): Promise<T | null> {
    const cached = await this.kv.get(this.key("planFeatures", orgId, cacheKey), "json");
    return cached as T | null;
  }

  async setPlanFeatures<T>(orgId: string, cacheKey: string, data: T, ttl = PLAN_FEATURE_TTL): Promise<void> {
    await this.kv.put(
      this.key("planFeatures", orgId, cacheKey),
      JSON.stringify(data),
      { expirationTtl: this.normalizeTtl(ttl) }
    );
  }

  async invalidatePlanFeatures(orgId: string, cacheKey: string): Promise<void> {
    await this.kv.delete(this.key("planFeatures", orgId, cacheKey));
  }

  // ==========================================================================
  // Dashboard Cache
  // ==========================================================================

  async getManualEntitlement<T>(
    orgId: string,
    customerId: string,
    featureId: string,
  ): Promise<T | null | undefined> {
    const cacheKey = `${customerId}:${featureId}`;
    const cached = await this.kv.get(
      this.key("manualEntitlement", orgId, cacheKey),
      "json",
    );
    if (!cached) return undefined;
    const payload = cached as { value: T | null };
    return payload.value;
  }

  async setManualEntitlement<T>(
    orgId: string,
    customerId: string,
    featureId: string,
    data: T | null,
    ttl = MANUAL_ENTITLEMENT_TTL,
  ): Promise<void> {
    const cacheKey = `${customerId}:${featureId}`;
    await this.kv.put(
      this.key("manualEntitlement", orgId, cacheKey),
      JSON.stringify({ value: data }),
      { expirationTtl: this.normalizeTtl(ttl) },
    );
  }

  async invalidateManualEntitlement(
    orgId: string,
    customerId: string,
    featureId: string,
  ): Promise<void> {
    const cacheKey = `${customerId}:${featureId}`;
    await this.kv.delete(this.key("manualEntitlement", orgId, cacheKey));
  }

  async invalidateDashboardCustomer(customerId: string): Promise<void> {
    await this.kv.delete(`dashboard:customer:${customerId}`);
  }
}

/**
 * Helper to get or fetch with cache
 */
export async function getOrFetch<T>(
  cache: EntitlementCache,
  type: "customer" | "feature" | "subscriptions" | "planFeatures",
  orgId: string,
  id: string,
  fetcher: () => Promise<T | null>,
  ttl = DEFAULT_TTL
): Promise<T | null> {
  // Try cache first
  let cached: T | null = null;
  
  switch (type) {
    case "customer":
      cached = await cache.getCustomer<T>(orgId, id);
      break;
    case "feature":
      cached = await cache.getFeature<T>(orgId, id);
      break;
    case "subscriptions":
      cached = await cache.getSubscriptions<T>(orgId, id);
      break;
    case "planFeatures":
      cached = await cache.getPlanFeatures<T>(orgId, id);
      break;
  }

  if (cached !== null) {
    return cached;
  }

  // Fetch from DB
  const data = await fetcher();

  // Cache if found
  if (data !== null) {
    switch (type) {
      case "customer":
        await cache.setCustomer(orgId, id, data, ttl);
        break;
      case "feature":
        await cache.setFeature(orgId, id, data, ttl);
        break;
      case "subscriptions":
        await cache.setSubscriptions(orgId, id, data, ttl);
        break;
      case "planFeatures":
        await cache.setPlanFeatures(orgId, id, data, ttl);
        break;
    }
  }

  return data;
}
