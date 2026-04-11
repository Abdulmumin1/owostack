import { afterEach, describe, expect, it, vi } from "vitest";
import { UsageMeterDO, type FeatureConfig } from "./usage-meter";
import { resolveUsagePlanScope } from "./usage-scope";

function createStorage() {
  const values = new Map<string, unknown>();
  let alarm: number | null = null;

  return {
    storage: {
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
    },
    getAlarm() {
      return alarm;
    },
    setAlarm(value: number | null) {
      alarm = value;
    },
  };
}

function createMeter() {
  const storage = createStorage();
  return {
    storage,
    meter: new UsageMeterDO(
      { storage: storage.storage } as any,
      {} as never,
    ),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

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
    const { meter } = createMeter();

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
    const { meter } = createMeter();

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
    const { meter } = createMeter();

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
    const { meter } = createMeter();

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

  it("replaces a stale shorter alarm when the reset interval changes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-10T10:00:00.000Z"));

    const { meter, storage } = createMeter();

    await meter.configureFeature(
      "ai-credits",
      config({
        limit: 500,
        resetInterval: "5min",
      }),
    );

    const originalAlarm = storage.getAlarm();
    expect(originalAlarm).not.toBeNull();

    await meter.check(
      "ai-credits",
      0,
      config({
        limit: 5000,
        resetInterval: "monthly",
      }),
    );

    const rescheduledAlarm = storage.getAlarm();
    expect(rescheduledAlarm).not.toBeNull();
    expect(rescheduledAlarm).toBeGreaterThan(originalAlarm!);
    expect(rescheduledAlarm! - Date.now()).toBeGreaterThan(
      20 * 24 * 60 * 60 * 1000,
    );
  });

  it("re-arms the next reset after an alarm fires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-10T10:00:00.000Z"));

    const { meter, storage } = createMeter();

    await meter.configureFeature(
      "ai-credits",
      config({
        limit: 10,
        resetInterval: "5min",
      }),
    );
    await meter.track("ai-credits", 5);

    const firstAlarm = storage.getAlarm();
    expect(firstAlarm).not.toBeNull();

    vi.setSystemTime(new Date(firstAlarm! + 1000));
    await meter.alarm();

    const state = await meter.check("ai-credits", 0);
    expect(state.usage).toBe(0);
    expect(state.balance).toBe(10);

    const secondAlarm = storage.getAlarm();
    expect(secondAlarm).not.toBeNull();
    expect(secondAlarm).toBeGreaterThan(firstAlarm!);
  });
});
