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
  rolloverBalance: number;
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

    // If lazy initialization, prevent reset/overwrite of existing state
    const existingState = this.featureUsage.get(featureId);
    if (options?.lazy) {
      if (!existingState) {
        // No state yet — save config but DON'T create state.
        // Caller should handle "feature_not_found" and provide initialUsage via non-lazy configure.
        this.featureConfigs.set(featureId, config);
        await this.persist();
        return { success: true };
      }

      const oldConfig = this.featureConfigs.get(featureId);

      // If config hasn't changed, skip entirely (no persist, no write)
      const configChanged =
        oldConfig?.resetInterval !== config.resetInterval ||
        oldConfig?.limit !== config.limit ||
        oldConfig?.rolloverEnabled !== config.rolloverEnabled ||
        oldConfig?.rolloverMaxBalance !== config.rolloverMaxBalance ||
        oldConfig?.creditCost !== config.creditCost;

      if (!configChanged) {
        return { success: true };
      }

      console.log(`[UsageMeter] Config changed for ${featureId}: interval ${oldConfig?.resetInterval} -> ${config.resetInterval}, limit ${oldConfig?.limit} -> ${config.limit}`);
      this.featureConfigs.set(featureId, config);
      existingState.limit = config.limit;
      if (config.limit !== null) {
        existingState.balance = Math.max(0, config.limit - existingState.usage);
      }
      await this.persist();
      await this.scheduleResetAlarm();
      await this.maybeReset(featureId);

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
   * Check if the period has elapsed and reset inline if needed.
   * Catches cases where the alarm was missed or interval was too short.
   */
  private async maybeReset(featureId: string): Promise<void> {
    const state = this.featureUsage.get(featureId);
    const config = this.featureConfigs.get(featureId);
    if (!state || !config || config.resetInterval === "none") return;

    const intervalMs = this.getIntervalMs(config.resetInterval);
    console.log(`[UsageMeter] maybeReset(${featureId}): interval=${config.resetInterval}, intervalMs=${intervalMs}, lastReset=${new Date(state.lastReset).toISOString()}, nextReset=${new Date(state.lastReset + intervalMs).toISOString()}, now=${new Date().toISOString()}, usage=${state.usage}, balance=${state.balance}`);
    
    if (intervalMs === 0) return;

        const currentAlarm = await this.ctx.storage.getAlarm();

if (currentAlarm !== null) {
  console.log("current alarm (s)", Math.round((currentAlarm - Date.now()) / 1000), 's');
}

    const nextReset = state.lastReset + intervalMs;
    if (Date.now() >= nextReset) {
      console.log(`[UsageMeter] Period elapsed for ${featureId}, resetting now...`);
      await this.resetFeature(featureId);
      await this.scheduleResetAlarm();
    } else {
      console.log(`[UsageMeter] Period NOT elapsed for ${featureId}, ${Math.round((nextReset - Date.now()) / 1000)}s remaining`);
    }
  }

  /**
   * Check if usage is allowed (without consuming)
   * This is an RPC method - call directly on the stub
   */
  async check(
    featureId: string,
    requiredBalance: number = 1,
    currentConfig?: FeatureConfig,
  ): Promise<TrackResult> {
    await this.init();

    // Inline config sync (avoids separate RPC call)
    if (currentConfig) {
      await this.configureFeature(featureId, currentConfig, { lazy: true });
    }

    const state = this.featureUsage.get(featureId);
    const config = this.featureConfigs.get(featureId);

    if (!state || !config) {
      return {
        allowed: false,
        balance: 0,
        usage: 0,
        limit: null,
        code: "feature_not_found",
        rolloverBalance: 0,
      };
    }

    // Auto-reset if period has elapsed
    await this.maybeReset(featureId);

    // For unlimited features
    if (state.limit === null) {
      return {
        allowed: true,
        balance: Infinity,
        usage: state.usage,
        limit: null,
        code: "unlimited",
        rolloverBalance: state.rolloverBalance,
      };
    }

    // Apply credit cost multiplier (same as track) so check and track are consistent
    const creditMultiplier = config.creditCost > 0 ? config.creditCost : 1;
    const actualRequired = requiredBalance * creditMultiplier;

    const effectiveBalance = state.balance + state.rolloverBalance;
    const allowed = effectiveBalance >= actualRequired;

    return {
      allowed,
      balance: effectiveBalance,
      usage: state.usage,
      limit: state.limit,
      code: allowed ? "allowed" : "insufficient_balance",
      rolloverBalance: state.rolloverBalance,
    };
  }

  /**
   * Track usage (consume credits/units)
   * This is an RPC method - call directly on the stub
   */
  async track(featureId: string, delta: number = 1, currentConfig?: FeatureConfig): Promise<TrackResult> {
    await this.init();

    // Inline config sync (avoids separate RPC call)
    if (currentConfig) {
      await this.configureFeature(featureId, currentConfig, { lazy: true });
    }

    const state = this.featureUsage.get(featureId);
    const config = this.featureConfigs.get(featureId);

    if (!state || !config) {
      return {
        allowed: false,
        balance: 0,
        usage: 0,
        limit: null,
        code: "feature_not_found",
        rolloverBalance: 0,
      };
    }

    // Auto-reset if period has elapsed
    await this.maybeReset(featureId);

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
        rolloverBalance: state.rolloverBalance,
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
        rolloverBalance: state.rolloverBalance,
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
      rolloverBalance: state.rolloverBalance,
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
      console.log(`[UsageMeter] resetFeature(${featureId}): no state or config found`);
      return { success: false };
    }

    console.log(`[UsageMeter] resetFeature(${featureId}): usage ${state.usage} -> 0, balance -> ${config.limit ?? 'Infinity'}`);

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

    console.log('SOMEONE WANTS TO SCHEDULE')
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

    if (soonestReset === Infinity) return;

console.log("soonest (s)", Math.round((soonestReset - Date.now()) / 1000), 's');

    // If the reset time is in the past, schedule immediately so the alarm
    // fires ASAP instead of silently dropping it (fixes missed alarm chain)
    const alarmTime = soonestReset > Date.now() ? soonestReset : Date.now() + 1000;

    const currentAlarm = await this.ctx.storage.getAlarm();

console.log("current alarm (s)", Math.round((alarmTime - Date.now()) / 1000), 's');
if (currentAlarm !== null) {
  console.log("current alarm time (s)", Math.round((currentAlarm - Date.now()) / 1000), 's');
}
// console.log(currentAlarm)

    // Set alarm if: no alarm exists, this one is sooner, or the existing alarm is stale (past)
    if (!currentAlarm || alarmTime < currentAlarm || currentAlarm <= Date.now()) {
      await this.ctx.storage.setAlarm(alarmTime);
    }
  }

  /**
   * Alarm handler - resets usage based on interval
   * Called by Cloudflare when the scheduled alarm fires
   */
  async alarm(): Promise<void> {
    await this.init()
    console.log(`[UsageMeter] ⏰ Alarm fired at ${new Date().toISOString()}`);

    const now = Date.now();

    // Check all features for reset
    for (const [featureId, state] of this.featureUsage) {
      const config = this.featureConfigs.get(featureId);
      console.log({config})
      if (config && config.resetInterval !== "none") {
        const intervalMs = this.getIntervalMs(config.resetInterval);
        const nextReset = state.lastReset + intervalMs;

        if (now >= nextReset) {
          await this.resetFeature(featureId);
        }
      }
    }

    // Re-schedule for the next soonest reset across all features
    // await this.scheduleResetAlarm();
  }

  /**
   * Convert interval string to milliseconds
   */
  private getIntervalMs(interval: string): number {
    const intervals: Record<string, number> = {
      "5min": 5 * 60 * 1000,
      "15min": 15 * 60 * 1000,
      "30min": 30 * 60 * 1000,
      hour: 60 * 60 * 1000,
      hourly: 60 * 60 * 1000,
      day: 24 * 60 * 60 * 1000,
      daily: 24 * 60 * 60 * 1000,
      week: 7 * 24 * 60 * 60 * 1000,
      weekly: 7 * 24 * 60 * 60 * 1000,
      month: 30 * 24 * 60 * 60 * 1000,
      monthly: 30 * 24 * 60 * 60 * 1000,
      quarter: 90 * 24 * 60 * 60 * 1000,
      quarterly: 90 * 24 * 60 * 60 * 1000,
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
