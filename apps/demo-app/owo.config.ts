import {
  Owostack,
  metered,
  boolean,
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
        }),
        premiumModels.on(),
      ],
    }),
    plan("starter", {
      name: "Starter",
      price: 0,
      currency: "NGN",
      interval: "monthly",
      planGroup: "main",
      autoEnable: true,
      features: [
        aiCredits.limit(50, {
          reset: "monthly",
        }),
      ],
    }),
  ],
});
