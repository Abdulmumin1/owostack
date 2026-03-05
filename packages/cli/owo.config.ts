import {
  Owostack,
  metered,
  boolean,
  creditSystem,
  creditPack,
  plan,
} from "owostack";

export const apiCalls = metered("api-calls", { name: "API Calls" });
export const analytics = boolean("analytics", { name: "Analytics Dashboard" });

// Define credit system for API credits (used by plan features)
export const apiCredits = creditSystem("api-credits", {
  name: "API Credits",
  description: "Credits for API calls",
  features: [
    apiCalls(1), // 1 API call costs 1 credit
  ],
});

// Credit pack example - one-time purchase for additional API calls
export const apiCallPack500 = creditPack("api-calls-500", {
  name: "500 API Calls Pack",
  description: "One-time purchase of 500 additional API calls",
  credits: 500,
  price: 1000, // 10.00 NGN (minor units)
  currency: "NGN",
  creditSystem: "api-credits",
});

export const owo = new Owostack({
  secretKey: process.env.OWOSTACK_SECRET_KEY!,
  catalog: [
    plan("starter", {
      name: "Starter",
      price: 500, // minor units
      currency: "NGN",
      interval: "monthly",
      planGroup: "main",
      autoEnable: true,
      features: [
        apiCalls.limit(100, { reset: "monthly" }),
        apiCredits.credits(50, { reset: "monthly" }), // Include 50 credits in the plan
      ],
    }),
    apiCallPack500,
  ],
});
