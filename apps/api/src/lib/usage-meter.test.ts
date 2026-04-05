import { describe, expect, it } from "vitest";
import { UsageMeterDO, type FeatureConfig } from "./usage-meter";
import { resolveUsagePlanScope } from "./usage-scope";

function createStorage() {
  const values = new Map<string, unknown>();
  let alarm: number | null = null;

  return {
    async get<T>(key: string): Promise<T | undefined> {
      return values.get(key) as T | undefined;
    },
    async put(key: string, value: unknown): Promise<void> {
      values.set(key, value);
    },
    async getAlarm(): Promise<number | null> {
      return alarm;
    },
    async setAlarm(value: number): Promise<void> {
      alarm = value;
    },
  };
}

function config(overrides: Partial<FeatureConfig> = {}): FeatureConfig {
  return {
    limit: 10,
    resetInterval: "none",
    resetOnEnable: true,
    rolloverEnabled: false,
    rolloverMaxBalance: null,
    usageModel: "included",
    creditCost: 0,
    usageScopeKey: "plan_free",
    ...overrides,
  };
}

describe("UsageMeterDO", () => {
  it("resets usage when the usage scope changes and resetOnEnable is enabled", async () => {
    const meter = new UsageMeterDO(
      { storage: createStorage() } as any,
      {} as never,
    );

    await meter.configureFeature("ai-credits", config());
    await meter.track("ai-credits", 5);

    const result = await meter.check(
      "ai-credits",
      0,
      config({
        limit: 50,
        usageScopeKey: "plan_pro",
      }),
    );

    expect(result.usage).toBe(0);
    expect(result.balance).toBe(50);
    expect(result.limit).toBe(50);
  });

  it("preserves usage when the low-level resetOnEnable override is disabled", async () => {
    const meter = new UsageMeterDO(
      { storage: createStorage() } as any,
      {} as never,
    );

    await meter.configureFeature(
      "ai-credits",
      config({ resetOnEnable: false }),
    );
    await meter.track("ai-credits", 5);

    const result = await meter.check(
      "ai-credits",
      0,
      config({
        limit: 50,
        resetOnEnable: false,
        usageScopeKey: "plan_pro",
      }),
    );

    expect(result.usage).toBe(5);
    expect(result.balance).toBe(45);
    expect(result.limit).toBe(50);
  });

  it("preserves usage for usage-based features when resetOnEnable is disabled", async () => {
    const meter = new UsageMeterDO(
      { storage: createStorage() } as any,
      {} as never,
    );

    await meter.configureFeature(
      "api-calls",
      config({
        limit: null,
        usageModel: "usage_based",
        resetOnEnable: false,
      }),
    );
    await meter.track("api-calls", 5);

    const result = await meter.check(
      "api-calls",
      0,
      config({
        limit: null,
        usageModel: "usage_based",
        resetOnEnable: false,
        usageScopeKey: "plan_pro",
      }),
    );

    expect(result.usage).toBe(5);
    expect(result.limit).toBe(null);
  });

  it("does not reset active usage when migrating a legacy scope key to the versioned format", async () => {
    const meter = new UsageMeterDO(
      { storage: createStorage() } as any,
      {} as never,
    );

    await meter.configureFeature(
      "ai-credits",
      config({ usageScopeKey: "plan_pro" }),
    );
    await meter.track("ai-credits", 5);

    const result = await meter.check(
      "ai-credits",
      0,
      config({
        usageScopeKey: resolveUsagePlanScope(
          { usageModel: "included", resetOnEnable: true },
          { id: "sub_pro", planId: "plan_pro" },
        ),
      }),
    );

    expect(result.usage).toBe(5);
    expect(result.balance).toBe(5);
    expect(result.limit).toBe(10);
  });
});
