import type { ProviderRule, AttachRequestContext } from "./index";
import { matchProviderRule } from "./index";

export interface ProviderSelectionResult {
  providerId: string | null;
  ruleId: string | null;
}

export function selectProvider(
  rules: ProviderRule[],
  context: AttachRequestContext,
): ProviderSelectionResult {
  const matched = matchProviderRule(rules, context);
  return {
    providerId: matched?.providerId ?? null,
    ruleId: matched?.id ?? null,
  };
}
