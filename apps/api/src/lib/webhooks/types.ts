import type { createDb } from "@owostack/db";
import type {
  ProviderAdapter,
  ProviderAccount,
  NormalizedWebhookEvent,
} from "@owostack/adapters";
import { EntitlementCache } from "../cache";

// =============================================================================
// Types
// =============================================================================

export type DB = ReturnType<typeof createDb>;

export interface WebhookContext {
  db: DB;
  organizationId: string;
  event: NormalizedWebhookEvent;
  adapter: ProviderAdapter | null;
  providerAccount: ProviderAccount | null;
  workflows: {
    trialEnd: any | null;
    planUpgrade: any | null;
    renewalSetup: any | null;
  };
  cache: EntitlementCache | null;
}

export type WebhookHandlerFn = (ctx: WebhookContext) => Promise<void>;

// =============================================================================
// Helpers
// =============================================================================

/** Parse a date string safely — returns 0 (falsy) if invalid/undefined */
export function safeParseDate(value: unknown): number {
  if (!value || typeof value !== "string") return 0;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

export function intervalToMs(interval: string): number {
  switch (interval) {
    case "hourly":
      return 60 * 60 * 1000;
    case "daily":
      return 24 * 60 * 60 * 1000;
    case "weekly":
      return 7 * 24 * 60 * 60 * 1000;
    case "monthly":
      return 30 * 24 * 60 * 60 * 1000;
    case "quarterly":
      return 90 * 24 * 60 * 60 * 1000;
    case "biannually":
    case "semi_annual":
      return 180 * 24 * 60 * 60 * 1000;
    case "annually":
    case "yearly":
      return 365 * 24 * 60 * 60 * 1000;
    default:
      return 30 * 24 * 60 * 60 * 1000;
  }
}
