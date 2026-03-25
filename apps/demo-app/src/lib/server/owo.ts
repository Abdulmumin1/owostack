import { env } from "$env/dynamic/private";
import { Owostack, metered, boolean, plan } from "owostack";

export const aiCredits = metered("ai-credits", {
  name: "AI Generation Credits",
});
export const premiumModels = boolean("premium-models", {
  name: "Premium Models",
});

export const catalog = [
  plan("starter", {
    name: "Starter",
    price: 0,
    currency: "NGN",
    interval: "monthly",
    planGroup: "main",
    features: [aiCredits.limit(50, { reset: "monthly" })],
  }),
  plan("pro", {
    name: "Pro",
    price: 15000,
    currency: "NGN",
    interval: "monthly",
    planGroup: "main",
    features: [aiCredits.limit(5000, { reset: "monthly" }), premiumModels.on()],
  }),
];

export const owo = new Owostack({
  secretKey: env.OWOSTACK_API_KEY || "sk_test_owo",
  apiUrl: env.OWOSTACK_API_URL || "http://localhost:8787/api/v1",
  catalog,
});
