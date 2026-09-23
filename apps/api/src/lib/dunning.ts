/**
 * Dunning: a subscription in `past_due` keeps its entitlements while the
 * payment provider retries the card. The provider owns that schedule and
 * tells us when it gives up — `customer.subscription.deleted`, `unpaid`,
 * `canceled` — and those events revoke access through the normal status
 * handlers. We do not run a second clock of our own.
 *
 * `DUNNING_GRACE_MS` is only a backstop for a missed terminal webhook or a
 * row our own staleness check pushed into past_due: after this long with no
 * word from the provider, stop granting. It is deliberately longer than any
 * provider's recovery window (Stripe smart retries max out at ~4 weeks).
 *
 * The window is anchored on `metadata.past_due_since`, stamped when the
 * status transitions to past_due, falling back to `updatedAt`.
 */

export const DUNNING_GRACE_MS = 45 * 24 * 60 * 60 * 1000;

export interface DunningState {
  pastDueSince: number;
  graceEndsAt: number;
  inGrace: boolean;
}

export interface DunningSubscription {
  status?: string | null;
  metadata?: unknown;
  updatedAt?: number | null;
}

export function readPastDueSince(sub: DunningSubscription): number | null {
  const meta =
    sub.metadata && typeof sub.metadata === "object"
      ? (sub.metadata as Record<string, unknown>)
      : null;
  const since = Number(meta?.past_due_since);
  if (Number.isFinite(since) && since > 0) return since;
  const updated = Number(sub.updatedAt);
  return Number.isFinite(updated) && updated > 0 ? updated : null;
}

export function getDunningState(
  sub: DunningSubscription,
  now: number = Date.now(),
  graceMs: number = DUNNING_GRACE_MS,
): DunningState | null {
  if ((sub.status || "").toLowerCase() !== "past_due") return null;
  const pastDueSince = readPastDueSince(sub);
  if (pastDueSince === null) {
    // No idea when dunning started (caller dropped metadata/updatedAt):
    // never grant open-ended access on a guess.
    return { pastDueSince: 0, graceEndsAt: 0, inGrace: false };
  }
  const graceEndsAt = pastDueSince + Math.max(0, graceMs);
  return { pastDueSince, graceEndsAt, inGrace: now <= graceEndsAt };
}

export function isWithinDunningGrace(
  sub: DunningSubscription,
  now: number = Date.now(),
  graceMs: number = DUNNING_GRACE_MS,
): boolean {
  return getDunningState(sub, now, graceMs)?.inGrace ?? false;
}

/**
 * Fields merged into `details` when access is granted during dunning.
 * `graceEndsAt` is the backstop date, not a promise: the provider will
 * usually end or recover the subscription well before it.
 */
export function dunningDetails(state: DunningState): {
  paymentStatus: "past_due";
  graceEndsAt: string;
} {
  return {
    paymentStatus: "past_due",
    graceEndsAt: new Date(state.graceEndsAt).toISOString(),
  };
}

/**
 * Metadata for a subscription that is entering past_due. Only stamps
 * `past_due_since` on the transition so a second dunning episode after a
 * recovery starts its own window.
 */
export function markPastDueMetadata(
  sub: DunningSubscription,
  now: number = Date.now(),
): Record<string, unknown> {
  const base =
    sub.metadata && typeof sub.metadata === "object"
      ? { ...(sub.metadata as Record<string, unknown>) }
      : {};
  if ((sub.status || "").toLowerCase() !== "past_due") {
    base.past_due_since = now;
  }
  return base;
}
