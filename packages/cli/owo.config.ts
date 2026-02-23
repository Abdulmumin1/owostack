import { Owostack, metered, boolean, creditSystem, plan } from "@owostack/core";

export const thirdpen = metered("thirdpen", { name: "Thirdpen" });
export const dearfutureself = metered("dearfutureself", { name: "dearfutureself" });
export const apiRequests = metered("api-requests", { name: "api requests" });
export const dfs = metered("dfs", { name: "dfs" });

export const supportCredits = creditSystem("support-credits", { name: "support credits", features: [dfs(20), apiRequests(10), dearfutureself(1)] });

export const owo = new Owostack({
  secretKey: process.env.OWOSTACK_SECRET_KEY!,
  catalog: [
    plan("test-trial-polar2", {
      name: "test-trial-polar2",
      price: 1000,
      currency: "USD",
      interval: "monthly",
      trialDays: 1,
      features: [thirdpen.limit(100, {"reset":"5min","overage":"charge"}), dearfutureself.limit(10, {"reset":"5min","overage":"charge"})]
    }),
    plan("test-trial-polar", {
      name: "test-trial-polar",
      price: 1000,
      currency: "USD",
      interval: "monthly",
      planGroup: "sales",
      trialDays: 3,
      features: [supportCredits.credits(100, { reset: "monthly" })]
    }),
    plan("wanssoawe", {
      name: "wanssoawe",
      price: 2000,
      currency: "USD",
      interval: "monthly",
      planGroup: "support",
      features: [thirdpen.limit(100, {"reset":"monthly"}), dearfutureself.config({"limit":null,"reset":"monthly"})]
    }),
    plan("dry", {
      name: "dry",
      description: "a nice poor plan",
      price: 1400,
      currency: "USD",
      interval: "monthly",
      features: [supportCredits.credits(100, { reset: "5min", overage: "charge" }), thirdpen.config({"limit":null,"reset":"monthly"})]
    }),
    plan("test-trial-dodod", {
      name: "test-trial-dodod",
      price: 10000,
      currency: "USD",
      interval: "monthly",
      trialDays: 2,
      features: [thirdpen.limit(100, {"reset":"monthly"}), supportCredits.credits(100, { reset: "monthly", overage: "charge" }), dearfutureself.limit(10, {"reset":"5min","overage":"charge"})]
    }),
    plan("test-trial-dodo-1", {
      name: "test-trial-dodo",
      price: 1000,
      currency: "USD",
      interval: "monthly",
      trialDays: 15,
      features: [supportCredits.credits(100, { reset: "monthly" })]
    }),
    plan("test-trial-dodo", {
      name: "test-trial-dodo",
      price: 1000,
      currency: "USD",
      interval: "monthly",
      trialDays: 3,
      features: [thirdpen.limit(100, {"reset":"monthly"})]
    }),
    plan("test-trial-stack", {
      name: "test-trial-stack",
      price: 100000,
      currency: "NGN",
      interval: "monthly",
      trialDays: 3,
      features: [thirdpen.limit(100, {"reset":"monthly"})]
    }),
    plan("masterxx", {
      name: "masterxx",
      price: 100000,
      currency: "USD",
      interval: "monthly",
      features: [supportCredits.credits(100, { reset: "5min" })]
    }),
    plan("teast", {
      name: "teast",
      price: 0,
      currency: "NGN",
      interval: "monthly",
      planGroup: "sales",
      features: [supportCredits.credits(100, { reset: "15min", overage: "charge" })]
    }),
    plan("mastert", {
      name: "mastert",
      price: 1000000,
      currency: "NGN",
      interval: "monthly",
      trialDays: 4,
      features: [dearfutureself.limit(100, {"reset":"monthly"}), apiRequests.limit(100, {"reset":"monthly"})]
    }),
    plan("masterx", {
      name: "masterx",
      price: 1000000,
      currency: "NGN",
      interval: "monthly",
      trialDays: 4,
      features: [apiRequests.limit(100, {"reset":"monthly"}), thirdpen.limit(100, {"reset":"monthly"})]
    }),
    plan("master2", {
      name: "master2",
      price: 10000,
      currency: "NGN",
      interval: "monthly",
      trialDays: 4,
      features: [apiRequests.limit(100, {"reset":"monthly"})]
    }),
    plan("master", {
      name: "master",
      price: 1000000,
      currency: "NGN",
      interval: "monthly",
      trialDays: 4,
      features: [apiRequests.limit(100, {"reset":"monthly"})]
    }),
    plan("credit-plan", {
      name: "Credit plan",
      price: 10000,
      currency: "NGN",
      interval: "monthly",
      features: [thirdpen.limit(10, {"reset":"5min","overage":"charge"}), dearfutureself.limit(10, {"reset":"5min","overage":"charge"}), dfs.config({"limit":null,"reset":"5min"})]
    }),
    plan("pro-plan", {
      name: "pro plan",
      price: 3000000,
      currency: "NGN",
      interval: "monthly",
      features: [thirdpen.limit(200, {"reset":"5min"}), apiRequests.limit(200, {"reset":"5min"})]
    }),
    plan("basic", {
      name: "basic",
      price: 100000,
      currency: "NGN",
      interval: "monthly",
      features: [apiRequests.limit(100, {"reset":"monthly"})]
    })
  ],
});
