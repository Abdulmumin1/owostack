/**
 * Shared utility for calculating calendar-aligned usage period boundaries
 * based on a feature's resetInterval.
 *
 * Used by both the entitlements API routes and the EntitlementService class.
 */

export interface ResetPeriod {
  periodStart: number;
  periodEnd: number;
}

/**
 * Calculate the current usage period boundaries based on resetInterval.
 * For "none", falls back to the subscription billing period.
 * For time-based intervals, computes calendar-aligned period start/end.
 */
export function getResetPeriod(
  resetInterval: string,
  subscriptionPeriodStart: number,
  subscriptionPeriodEnd: number,
): ResetPeriod {
  if (resetInterval === "none") {
    return {
      periodStart: subscriptionPeriodStart,
      periodEnd: subscriptionPeriodEnd,
    };
  }

  const now = new Date();

  switch (resetInterval) {
    case "5min": {
      // 5-minute rolling window aligned to clock (e.g. :00, :05, :10, ...)
      const minute5 = Math.floor(now.getMinutes() / 5) * 5;
      const start = new Date(now);
      start.setMinutes(minute5, 0, 0);
      const end = new Date(start.getTime() + 5 * 60 * 1000 - 1);
      return { periodStart: start.getTime(), periodEnd: end.getTime() };
    }
    case "15min": {
      const minute15 = Math.floor(now.getMinutes() / 15) * 15;
      const start = new Date(now);
      start.setMinutes(minute15, 0, 0);
      const end = new Date(start.getTime() + 15 * 60 * 1000 - 1);
      return { periodStart: start.getTime(), periodEnd: end.getTime() };
    }
    case "30min": {
      const minute30 = Math.floor(now.getMinutes() / 30) * 30;
      const start = new Date(now);
      start.setMinutes(minute30, 0, 0);
      const end = new Date(start.getTime() + 30 * 60 * 1000 - 1);
      return { periodStart: start.getTime(), periodEnd: end.getTime() };
    }
    case "hour":
    case "hourly": {
      const start = new Date(now);
      start.setMinutes(0, 0, 0);
      const end = new Date(start.getTime() + 60 * 60 * 1000 - 1);
      return { periodStart: start.getTime(), periodEnd: end.getTime() };
    }
    case "day":
    case "daily": {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setHours(23, 59, 59, 999);
      return { periodStart: start.getTime(), periodEnd: end.getTime() };
    }
    case "week":
    case "weekly": {
      const start = new Date(now);
      start.setDate(start.getDate() - start.getDay());
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      return { periodStart: start.getTime(), periodEnd: end.getTime() };
    }
    case "month":
    case "monthly": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(
        now.getFullYear(),
        now.getMonth() + 1,
        0,
        23,
        59,
        59,
        999,
      );
      return { periodStart: start.getTime(), periodEnd: end.getTime() };
    }
    case "quarter":
    case "quarterly": {
      const quarterMonth = Math.floor(now.getMonth() / 3) * 3;
      const start = new Date(now.getFullYear(), quarterMonth, 1);
      const end = new Date(
        now.getFullYear(),
        quarterMonth + 3,
        0,
        23,
        59,
        59,
        999,
      );
      return { periodStart: start.getTime(), periodEnd: end.getTime() };
    }
    case "semi_annual": {
      const halfMonth = now.getMonth() < 6 ? 0 : 6;
      const start = new Date(now.getFullYear(), halfMonth, 1);
      const end = new Date(
        now.getFullYear(),
        halfMonth + 6,
        0,
        23,
        59,
        59,
        999,
      );
      return { periodStart: start.getTime(), periodEnd: end.getTime() };
    }
    case "year":
    case "yearly":
    case "annually": {
      const start = new Date(now.getFullYear(), 0, 1);
      const end = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
      return { periodStart: start.getTime(), periodEnd: end.getTime() };
    }
    default: {
      // Unknown interval — fall back to subscription billing period
      return {
        periodStart: subscriptionPeriodStart,
        periodEnd: subscriptionPeriodEnd,
      };
    }
  }
}
