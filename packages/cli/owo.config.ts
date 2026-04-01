import {
  Owostack,
  metered,
  boolean,
  creditSystem,
  creditPack,
  plan,
} from "owostack";
export const aiCredits = metered("ai-credits", {
  name: "AI Generation Credits",
});
export const premiumModels = boolean("premium-models", {
  name: "Premium Models",
});
export const owo = new Owostack({
  secretKey: process.env.OWOSTACK_SECRET_KEY!,
  provider: "paystack",

  catalog: [
    plan("starter", {
      name: "Starter",
      price: 0,
      currency: "NGN",
      interval: "monthly",
      planGroup: "main",
      provider: "paystack",
      autoEnable: true,
      features: [
        aiCredits.limit(50, {
          reset: "daily",
          usageModel: "included",
          ratingModel: "package",
          billingUnits: 1,
        }),
      ],
    }),
    plan("pro-plus", {
      name: "Pro Plus",
      price: 35000,
      currency: "NGN",
      interval: "monthly",
      planGroup: "main",
      trialDays: 3,
      provider: "paystack",
      features: [
        aiCredits.limit(500, {
          reset: "daily",
          trialLimit: 300,
        }),
        premiumModels.on(),
      ],
    }),
    plan("pro", {
      name: "Pro",
      price: 15000,
      currency: "NGN",
      interval: "monthly",
      planGroup: "main",
      provider: "paystack",
      features: [
        aiCredits.limit(5000, {
          reset: "monthly",
          usageModel: "included",
          ratingModel: "package",
          billingUnits: 1,
          overage: "charge",
          overagePrice: 500,
        }),
        premiumModels.on(),
      ],
    }),
  ],
});
