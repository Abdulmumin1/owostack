export type OverageBillingMode = "end_of_period";
export type OverageBillingInterval = "end_of_period";

export type OverageSettingsInput =
  | {
      billingMode?: unknown;
      billingInterval?: unknown;
      thresholdEnabled?: unknown;
      thresholdAmount?: unknown;
      autoCollect?: unknown;
      gracePeriodHours?: unknown;
    }
  | null
  | undefined;

export interface NormalizedOverageSettings {
  billingMode: OverageBillingMode;
  // Legacy compatibility field for existing API consumers and stored rows.
  billingInterval: OverageBillingInterval;
  thresholdEnabled: boolean;
  thresholdAmount: number | null;
  autoCollect: boolean;
  gracePeriodHours: number;
}

export function normalizeOverageBillingInterval(
  _value: unknown,
): OverageBillingInterval {
  return "end_of_period";
}

export function normalizeOverageSettings(
  value: OverageSettingsInput,
): NormalizedOverageSettings {
  const explicitThresholdEnabled =
    typeof value?.thresholdEnabled === "boolean"
      ? value.thresholdEnabled
      : null;
  const rawThresholdAmount =
    typeof value?.thresholdAmount === "number" &&
    Number.isFinite(value.thresholdAmount)
      ? value.thresholdAmount
      : null;
  const thresholdAmount =
    rawThresholdAmount !== null && rawThresholdAmount > 0
      ? rawThresholdAmount
      : null;
  const legacyThresholdEnabled = value?.billingInterval === "threshold";
  const thresholdEnabled =
    explicitThresholdEnabled ??
    (legacyThresholdEnabled || thresholdAmount !== null);
  const gracePeriodHours =
    typeof value?.gracePeriodHours === "number" &&
    Number.isFinite(value.gracePeriodHours)
      ? Math.max(0, value.gracePeriodHours)
      : 0;

  return {
    billingMode: "end_of_period",
    billingInterval: "end_of_period",
    thresholdEnabled,
    thresholdAmount: thresholdEnabled ? thresholdAmount : null,
    autoCollect: Boolean(value?.autoCollect),
    gracePeriodHours,
  };
}
