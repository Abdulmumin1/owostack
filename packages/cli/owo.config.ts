import { Owostack, metered, boolean, creditSystem, creditPack, plan } from "owostack";
export const sendEmail = metered("send-email", { name: "send email" });
export const apiRequest = metered("api-request", { name: "api-request" });
export const owo = new Owostack({
  secretKey: process.env.OWOSTACK_SECRET_KEY!,
  provider: "paystack",

  catalog: [
    plan("test3", {
      name: "test3",
      price: 10000,
      currency: "NGN",
      interval: "monthly",
      provider: "paystack",
      features: [sendEmail.limit(100, {"reset":"5min"})]
    }),
    plan("test-free1", {
      name: "test-free1",
      price: 0,
      currency: "USD",
      interval: "monthly",
      planGroup: "main",
      provider: "paystack",
      features: []
    }),
    plan("test-free", {
      name: "test-free",
      price: 0,
      currency: "NGN",
      interval: "monthly",
      planGroup: "main",
      autoEnable: true,
      features: [apiRequest.limit(100, {"reset":"15min","overage":"charge"})]
    })
  ],
});
