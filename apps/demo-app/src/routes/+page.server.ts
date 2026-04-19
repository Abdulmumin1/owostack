import { redirect } from "@sveltejs/kit";
import { owo } from "$lib/server/owo";
import type { PageServerLoad } from "./$types";
import type { UsageHistoryParams } from "owostack";

const USAGE_RANGES = new Set(["7d", "30d", "90d", "custom"]);
const USAGE_GRANULARITIES = new Set(["day", "week", "month"]);

export const load: PageServerLoad = async ({ parent, url }) => {
  const { user } = await parent();
  if (!user) {
    throw redirect(302, "/login");
  }

  const requestedTab = url.searchParams.get("tab");
  const initialTab =
    requestedTab === "billing"
      ? "billing"
      : requestedTab === "usage"
        ? "usage"
        : "dashboard";
  const requestedUsageRange = url.searchParams.get("usageRange") || "30d";
  const requestedUsageGranularity =
    url.searchParams.get("usageGranularity") || "day";
  const usageFrom = url.searchParams.get("usageFrom") || "";
  const usageTo = url.searchParams.get("usageTo") || "";
  const usageRange = USAGE_RANGES.has(requestedUsageRange)
    ? requestedUsageRange
    : "30d";
  const usageGranularity = USAGE_GRANULARITIES.has(requestedUsageGranularity)
    ? requestedUsageGranularity
    : "day";
  const usageHistoryParams: UsageHistoryParams =
    usageRange === "custom" && usageFrom && usageTo
      ? {
          customer: user.id,
          range: "custom" as const,
          granularity: usageGranularity as "day" | "week" | "month",
          groupBy: "feature" as const,
          timezone: "Africa/Lagos",
          from: usageFrom,
          to: usageTo,
        }
      : {
          customer: user.id,
          range:
            usageRange === "7d" || usageRange === "90d" ? usageRange : "30d",
          granularity: usageGranularity as "day" | "week" | "month",
          groupBy: "feature" as const,
          timezone: "Africa/Lagos",
        };

  try {
    // Fetch initial billing data for the user
    const [
      invoicesRes,
      plansRes,
      checkRes,
      premiumCheck,
      customerRes,
      walletRes,
      usageRes,
      usageHistoryRes,
    ] = await Promise.all([
      owo.billing
        .invoices({ customer: user.id })
        .catch(() => ({ invoices: [] })),
      owo.plans().catch(() => ({ plans: [] })),
      owo
        .check({ customer: user.id, feature: "ai-credits", value: 0 })
        .catch(() => null),
      owo
        .check({ customer: user.id, feature: "premium-models", value: 0 })
        .catch(() => null),
      user.email
        ? owo
            .customer({
              id: user.id,
              email: user.email,
              name: user.name,
            })
            .catch(() => null)
        : Promise.resolve(null),
      owo.wallet(user.id).catch(() => ({
        hasCard: false,
        card: null,
        methods: [],
      })),
      owo.billing.usage({ customer: user.id }).catch(() => null),
      owo.customer
        .usageHistory(usageHistoryParams)
        .catch(() => null),
    ]);

    return {
      invoices: invoicesRes?.invoices || [],
      plans: plansRes?.plans || [],
      checkResult: checkRes,
      isPremium: premiumCheck?.allowed || false,
      customer: customerRes,
      wallet: walletRes,
      usage: usageRes,
      usageHistory: usageHistoryRes,
      usageFilters: {
        range:
          usageHistoryParams.range === "custom" ? "custom" : usageHistoryParams.range,
        granularity: usageHistoryParams.granularity,
        from: usageHistoryParams.range === "custom" ? usageFrom : "",
        to: usageHistoryParams.range === "custom" ? usageTo : "",
      },
      initialTab,
      user,
    };
  } catch (e) {
    console.error("Error fetching dashboard data:", e);
    return {
      invoices: [],
      plans: [],
      checkResult: null,
      isPremium: false,
      customer: null,
      wallet: {
        hasCard: false,
        card: null,
        methods: [],
      },
      usage: null,
      usageHistory: null,
      usageFilters: {
        range:
          usageHistoryParams.range === "custom" ? "custom" : usageHistoryParams.range,
        granularity: usageHistoryParams.granularity,
        from: usageHistoryParams.range === "custom" ? usageFrom : "",
        to: usageHistoryParams.range === "custom" ? usageTo : "",
      },
      initialTab,
      user,
    };
  }
};
