import { redirect } from "@sveltejs/kit";
import { owo } from "$lib/server/owo";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ parent, url }) => {
  const { user } = await parent();
  if (!user) {
    throw redirect(302, "/login");
  }

  try {
    // Fetch initial billing data for the user
    const [invoicesRes, plansRes, checkRes, premiumCheck, customerRes, walletRes] =
      await Promise.all([
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
        ? owo.customer({
            id: user.id,
            email: user.email,
            name: user.name,
          }).catch(() => null)
        : Promise.resolve(null),
      owo.wallet(user.id).catch(() => ({
        hasCard: false,
        card: null,
        methods: [],
      })),
    ]);

    return {
      invoices: invoicesRes?.invoices || [],
      plans: plansRes?.plans || [],
      checkResult: checkRes,
      isPremium: premiumCheck?.allowed || false,
      customer: customerRes,
      wallet: walletRes,
      initialTab: url.searchParams.get("tab") === "billing" ? "billing" : "dashboard",
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
      initialTab: url.searchParams.get("tab") === "billing" ? "billing" : "dashboard",
      user,
    };
  }
};
