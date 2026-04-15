export type UsageCoverageSource = "plan" | "manual_bonus" | "addon";

export function normalizeUsageCoverageSource(
  value: string | null | undefined,
): UsageCoverageSource {
  if (value === "manual_bonus" || value === "addon") {
    return value;
  }
  return "plan";
}

export function isPlanUsageCoverageSource(
  value: string | null | undefined,
): boolean {
  return normalizeUsageCoverageSource(value) === "plan";
}
