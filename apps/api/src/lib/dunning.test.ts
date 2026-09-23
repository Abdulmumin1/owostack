import { describe, expect, it } from "vitest";
import {
  DUNNING_GRACE_MS,
  getDunningState,
  isWithinDunningGrace,
  markPastDueMetadata,
} from "./dunning";

const T0 = Date.parse("2026-10-23T16:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

describe("dunning grace", () => {
  it("is only ever a concept for past_due subscriptions", () => {
    for (const status of ["active", "trialing", "canceled", "pending_cancel", "expired"]) {
      expect(getDunningState({ status, metadata: { past_due_since: T0 } }, T0)).toBeNull();
    }
  });

  it("anchors on past_due_since and closes after the grace window", () => {
    const sub = { status: "past_due", metadata: { past_due_since: T0 } };
    expect(isWithinDunningGrace(sub, T0)).toBe(true);
    expect(isWithinDunningGrace(sub, T0 + 6 * DAY)).toBe(true);
    expect(isWithinDunningGrace(sub, T0 + DUNNING_GRACE_MS)).toBe(true);
    expect(isWithinDunningGrace(sub, T0 + DUNNING_GRACE_MS + 1)).toBe(false);
    expect(getDunningState(sub, T0)?.graceEndsAt).toBe(T0 + DUNNING_GRACE_MS);
  });

  it("falls back to updatedAt for rows that went past_due before the stamp existed", () => {
    const sub = { status: "past_due", metadata: {}, updatedAt: T0 - 2 * DAY };
    expect(isWithinDunningGrace(sub, T0)).toBe(true);
    expect(isWithinDunningGrace(sub, T0 + 50 * DAY)).toBe(false);
  });

  it("never grants open-ended access when it cannot tell when dunning started", () => {
    expect(isWithinDunningGrace({ status: "past_due" }, T0)).toBe(false);
    expect(isWithinDunningGrace({ status: "past_due", metadata: {} }, T0)).toBe(false);
  });

  it("stamps past_due_since only on the transition into past_due", () => {
    const fresh = markPastDueMetadata({ status: "active", metadata: { a: 1 } }, T0);
    expect(fresh).toEqual({ a: 1, past_due_since: T0 });

    // A retry failing while already past_due must not move the anchor.
    const again = markPastDueMetadata({ status: "past_due", metadata: fresh }, T0 + 3 * DAY);
    expect(again.past_due_since).toBe(T0);

    // Recovered then failed again: a new episode, a new window.
    const second = markPastDueMetadata({ status: "active", metadata: again }, T0 + 40 * DAY);
    expect(second.past_due_since).toBe(T0 + 40 * DAY);
  });
});
