/**
 * KV Cache utilities for entitlement lookups
 * TTL: 60 seconds by default
 */

const DEFAULT_TTL = 60; // seconds

type CacheKey =
  | `org:${string}:customer:${string}`
  | `org:${string}:feature:${string}`
  | `org:${string}:subscriptions:${string}`
  | `org:${string}:planFeatures:${string}`;

export class EntitlementCache {
  constructor(private kv: KVNamespace) {}

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
      { expirationTtl: ttl }
    );
  }

  async invalidateCustomer(orgId: string, customerId: string): Promise<void> {
    await this.kv.delete(this.key("customer", orgId, customerId));
  }

  // ==========================================================================
  // Feature Cache
  // ==========================================================================

  async getFeature<T>(orgId: string, featureId: string): Promise<T | null> {
    const cached = await this.kv.get(this.key("feature", orgId, featureId), "json");
    return cached as T | null;
  }

  async setFeature<T>(orgId: string, featureId: string, data: T, ttl = DEFAULT_TTL): Promise<void> {
    await this.kv.put(
      this.key("feature", orgId, featureId),
      JSON.stringify(data),
      { expirationTtl: ttl }
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

  async setSubscriptions<T>(orgId: string, customerId: string, data: T, ttl = DEFAULT_TTL): Promise<void> {
    await this.kv.put(
      this.key("subscriptions", orgId, customerId),
      JSON.stringify(data),
      { expirationTtl: ttl }
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

  async setPlanFeatures<T>(orgId: string, cacheKey: string, data: T, ttl = DEFAULT_TTL): Promise<void> {
    await this.kv.put(
      this.key("planFeatures", orgId, cacheKey),
      JSON.stringify(data),
      { expirationTtl: ttl }
    );
  }

  async invalidatePlanFeatures(orgId: string, cacheKey: string): Promise<void> {
    await this.kv.delete(this.key("planFeatures", orgId, cacheKey));
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
