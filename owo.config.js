// @ts-check
const { Owostack, metered, boolean, creditSystem, creditPack, plan } = require("owostack");
const sendEmail = metered("send-email", { name: "send email" });
const apiRequest = metered("api-request", { name: "api-request" });
/** @type {import('owostack').Owostack} */
const owo = new Owostack({
  secretKey: process.env.OWOSTACK_SECRET_KEY,
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
module.exports = { owo, sendEmail, apiRequest };
