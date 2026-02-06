import { DurableObject } from "cloudflare:workers";

interface UsageState {
  balance: number;
  usage: number;
  limit: number | null;
  lastReset: number;
  rolloverBalance: number;
}

export interface FeatureConfig {
  limit: number | null;
  resetInterval: string;
  resetOnEnable: boolean;
  rolloverEnabled: boolean;
  rolloverMaxBalance: number | null;
  usageModel: string;
  creditCost: number;
  initialUsage?: number;
}

interface TrackResult {
  allowed: boolean;
  balance: number;
  usage: number;
  limit: number | null;
  code: string;
}

// Type for serialized storage (plain objects instead of Maps)
type StoredUsageState = Record<string, UsageState>;
type StoredFeatureConfigs = Record<string, FeatureConfig>;

/**
 * UsageMeterDO - Durable Object for real-time usage tracking
 *
 * Each customer gets their own DO instance, identified by customerId.
 * This ensures atomic operations and no race conditions on concurrent usage.
 *
 * NOTE: This DO uses RPC methods (available for compat date >= 2024-04-03).
 * Public methods can be called directly on the stub without using fetch().
 */
export class UsageMeterDO extends DurableObject<Record<string, unknown>> {
  private featureUsage: Map<string, UsageState> = new Map();
  private featureConfigs: Map<string, FeatureConfig> = new Map();
  private initialized = false;

  /**
   * Initialize the DO from storage
   * Uses plain objects for storage serialization compatibility
   */
  private async init(): Promise<void> {
    if (this.initialized) return;

    // Load usage state (stored as plain object, not Map)
    const stored = await this.ctx.storage.get<StoredUsageState>("featureUsage");
    if (stored) {
      this.featureUsage = new Map(Object.entries(stored));
    }

    // Load feature configs
    const configs =
      await this.ctx.storage.get<StoredFeatureConfigs>("featureConfigs");
    if (configs) {
      this.featureConfigs = new Map(Object.entries(configs));
    }

    this.initialized = true;
  }

  /**
   * Configure a feature for this customer (called when subscription starts)
   * This is an RPC method - call directly on the stub
   */
  async configureFeature(
    featureId: string,
    config: FeatureConfig,
    options?: { lazy?: boolean },
  ): Promise<{ success: boolean }> {
    await this.init();

    // If lazy initialization and state already exists, prevent reset/overwrite
    const existingState = this.featureUsage.get(featureId);
    if (options?.lazy && existingState) {
      this.featureConfigs.set(featureId, config); // Update config in case it changed
      await this.persist();
      return { success: true };
    }

    this.featureConfigs.set(featureId, config);

    // Determine start usage: existing, or initialUsage from config, or 0
    let startUsage = 0;
    if (config.initialUsage !== undefined) {
      startUsage = config.initialUsage;
    }

    if (!existingState || config.resetOnEnable) {
      this.featureUsage.set(featureId, {
        balance: config.limit ?? Infinity,
        usage: startUsage, // Start with migrated usage
        limit: config.limit,
        lastReset: Date.now(),
        rolloverBalance: 0,
      });

      // If we have initial usage, debit the balance
      if (startUsage > 0 && config.limit !== null) {
        const state = this.featureUsage.get(featureId)!;
        state.balance = Math.max(0, state.balance - startUsage);
      }
    }

    await this.persist();

    // Schedule reset alarm if needed
    if (config.resetInterval !== "none") {
      await this.scheduleResetAlarm();
    }

    return { success: true };
  }

  /**
   * Check if usage is allowed (without consuming)
   * This is an RPC method - call directly on the stub
   */
  async check(
    featureId: string,
    requiredBalance: number = 1,
  ): Promise<TrackResult> {
    await this.init();

    const state = this.featureUsage.get(featureId);
    const config = this.featureConfigs.get(featureId);

    if (!state || !config) {
      return {
        allowed: false,
        balance: 0,
        usage: 0,
        limit: null,
        code: "feature_not_found",
      };
    }

    // For unlimited features
    if (state.limit === null) {
      return {
        allowed: true,
        balance: Infinity,
        usage: state.usage,
        limit: null,
        code: "unlimited",
      };
    }

    const effectiveBalance = state.balance + state.rolloverBalance;
    const allowed = effectiveBalance >= requiredBalance;

    return {
      allowed,
      balance: effectiveBalance,
      usage: state.usage,
      limit: state.limit,
      code: allowed ? "allowed" : "insufficient_balance",
    };
  }

  /**
   * Track usage (consume credits/units)
   * This is an RPC method - call directly on the stub
   */
  async track(featureId: string, delta: number = 1): Promise<TrackResult> {
    await this.init();

    const state = this.featureUsage.get(featureId);
    const config = this.featureConfigs.get(featureId);

    if (!state || !config) {
      return {
        allowed: false,
        balance: 0,
        usage: 0,
        limit: null,
        code: "feature_not_found",
      };
    }

    // Apply credit cost multiplier if applicable (0 means 1:1)
    const creditMultiplier = config.creditCost > 0 ? config.creditCost : 1;
    const actualDelta = delta * creditMultiplier;

    // For unlimited features
    if (state.limit === null) {
      state.usage += actualDelta;
      await this.persist();
      return {
        allowed: true,
        balance: Infinity,
        usage: state.usage,
        limit: null,
        code: "tracked",
      };
    }

    // Check if we have enough balance (including rollover)
    const effectiveBalance = state.balance + state.rolloverBalance;

    if (effectiveBalance < actualDelta) {
      return {
        allowed: false,
        balance: effectiveBalance,
        usage: state.usage,
        limit: state.limit,
        code: "insufficient_balance",
      };
    }

    // Consume from rollover first, then regular balance
    if (state.rolloverBalance >= actualDelta) {
      state.rolloverBalance -= actualDelta;
    } else {
      const remainder = actualDelta - state.rolloverBalance;
      state.rolloverBalance = 0;
      state.balance -= remainder;
    }

    state.usage += actualDelta;
    await this.persist();

    return {
      allowed: true,
      balance: state.balance + state.rolloverBalance,
      usage: state.usage,
      limit: state.limit,
      code: "tracked",
    };
  }

  /**
   * Get current balances for all features
   * This is an RPC method - call directly on the stub
   */
  async getBalances(): Promise<Record<string, UsageState>> {
    await this.init();
    return Object.fromEntries(this.featureUsage);
  }

  /**
   * Reset usage for a specific feature (used by alarms)
   * This is an RPC method - call directly on the stub
   */
  async resetFeature(featureId: string): Promise<{ success: boolean }> {
    await this.init();

    const state = this.featureUsage.get(featureId);
    const config = this.featureConfigs.get(featureId);

    if (!state || !config) {
      return { success: false };
    }

    // Handle rollovers
    if (config.rolloverEnabled) {
      const remainingBalance = state.balance;
      let newRollover = state.rolloverBalance + remainingBalance;

      // Apply rollover cap if set
      if (config.rolloverMaxBalance !== null) {
        newRollover = Math.min(newRollover, config.rolloverMaxBalance);
      }

      state.rolloverBalance = newRollover;
    } else {
      state.rolloverBalance = 0;
    }

    // Reset to full limit
    state.balance = config.limit ?? Infinity;
    state.usage = 0;
    state.lastReset = Date.now();

    await this.persist();

    return { success: true };
  }

  /**
   * Schedule an alarm for the next usage reset
   * DOs only support one alarm at a time, so we schedule for the soonest reset needed
   */
  private async scheduleResetAlarm(): Promise<void> {
    // Find the soonest reset time across all features
    let soonestReset = Infinity;

    for (const [featureId, config] of this.featureConfigs) {
      if (config.resetInterval === "none") continue;
      const intervalMs = this.getIntervalMs(config.resetInterval);
      if (intervalMs === 0) continue;

      const state = this.featureUsage.get(featureId);
      if (!state) continue;

      const nextReset = state.lastReset + intervalMs;
      if (nextReset < soonestReset) {
        soonestReset = nextReset;
      }
    }

    // Only set alarm if we have a valid reset time
    if (soonestReset !== Infinity && soonestReset > Date.now()) {
      const currentAlarm = await this.ctx.storage.getAlarm();

      // Only set if no alarm or this one is sooner
      if (!currentAlarm || soonestReset < currentAlarm) {
        await this.ctx.storage.setAlarm(soonestReset);
      }
    }
  }

  /**
   * Alarm handler - resets usage based on interval
   * Called by Cloudflare when the scheduled alarm fires
   */
  async alarm(): Promise<void> {
    await this.init();

    const now = Date.now();

    // Check all features for reset
    for (const [featureId, state] of this.featureUsage) {
      const config = this.featureConfigs.get(featureId);

      if (config && config.resetInterval !== "none") {
        const intervalMs = this.getIntervalMs(config.resetInterval);
        const nextReset = state.lastReset + intervalMs;

        if (now >= nextReset) {
          await this.resetFeature(featureId);
        }
      }
    }

    // Re-schedule for the next soonest reset across all features
    await this.scheduleResetAlarm();
  }

  /**
   * Convert interval string to milliseconds
   */
  private getIntervalMs(interval: string): number {
    const intervals: Record<string, number> = {
      hour: 60 * 60 * 1000,
      day: 24 * 60 * 60 * 1000,
      daily: 24 * 60 * 60 * 1000,
      week: 7 * 24 * 60 * 60 * 1000,
      weekly: 7 * 24 * 60 * 60 * 1000,
      month: 30 * 24 * 60 * 60 * 1000,
      monthly: 30 * 24 * 60 * 60 * 1000,
      quarter: 90 * 24 * 60 * 60 * 1000,
      semi_annual: 180 * 24 * 60 * 60 * 1000,
      year: 365 * 24 * 60 * 60 * 1000,
      yearly: 365 * 24 * 60 * 60 * 1000,
    };
    return intervals[interval] || 0;
  }

  /**
   * Persist state to storage
   * Converts Maps to plain objects for serialization
   */
  private async persist(): Promise<void> {
    await this.ctx.storage.put(
      "featureUsage",
      Object.fromEntries(this.featureUsage),
    );
    await this.ctx.storage.put(
      "featureConfigs",
      Object.fromEntries(this.featureConfigs),
    );
  }
}
