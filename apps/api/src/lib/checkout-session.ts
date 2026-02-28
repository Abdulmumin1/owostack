import { eq } from "drizzle-orm";
import { schema } from "@owostack/db";
import {
  getProviderRegistry,
  loadProviderAccounts,
  deriveProviderEnvironment,
} from "./providers";
import type { Env, Variables } from "../index";
import type { Context } from "hono";

export async function createCheckoutSessionForSubscription(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  subscriptionId: string,
  options: {
    callbackUrl?: string;
    organizationId?: string; // Optional: used for API key auth
    isDashboard?: boolean;
  },
) {
  const db = c.get("db");

  // 1. Load the subscription with plan and customer
  const subscription = await db.query.subscriptions.findFirst({
    where: eq(schema.subscriptions.id, subscriptionId),
    with: { plan: true, customer: true },
  });

  if (!subscription) {
    throw new Error("Subscription not found");
  }

  if (subscription.status !== "pending") {
    // If it's already active, it might be a renewal or just a double click.
    // For now, let's only allow pending.
    throw new Error(`Subscription is ${subscription.status}, not pending`);
  }

  const { plan, customer } = subscription;
  const organizationId = options.organizationId || plan.organizationId;

  // 2. Resolve environment
  const workerEnv = c.env.ENVIRONMENT === "live" ? "live" : "test";
  const providerEnv = deriveProviderEnvironment(c.env.ENVIRONMENT, null);

  // 3. Resolve provider
  const registry = getProviderRegistry();

  const explicitProvider =
    subscription.providerId || plan.providerId || "paystack";

  const accounts = await loadProviderAccounts(
    db,
    organizationId,
    c.env.ENCRYPTION_KEY,
  );

  // Use subscription's providerId if set, else plan's, else organization's default
  // Wait, in current code we have logic for finding account.

  console.log(explicitProvider, accounts);
  let selectedAccount = accounts.find(
    (a: any) =>
      a.providerId === explicitProvider && a.environment === providerEnv,
  );

  if (!selectedAccount && accounts.length > 0) {
    selectedAccount = accounts.find((a: any) => a.environment === providerEnv);
  }

  if (!selectedAccount) {
    throw new Error("No configured payment provider found");
  }

  const adapter = registry.get(selectedAccount.providerId);
  if (!adapter) {
    throw new Error(`Provider '${selectedAccount.providerId}' not registered`);
  }

  // 4. Create session
  const customerRef =
    customer.providerCustomerId || customer.paystackCustomerId || customer.id;
  const planRef = plan.providerPlanId || plan.paystackPlanId;

  const checkoutResult = await adapter.createCheckoutSession({
    customer: { id: customerRef, email: customer.email },
    plan: planRef ? { id: planRef } : null,
    amount: plan.price,
    currency: plan.currency || "USD",
    callbackUrl: options.callbackUrl,
    metadata: {
      type: "pending_activation",
      pending_activation: "true",
      subscription_id: subscription.id,
      plan_id: plan.id,
      customer_id: customer.id,
      organization_id: organizationId,
      environment: workerEnv,
      provider_id: selectedAccount.providerId,
      ...(typeof subscription.metadata === "object"
        ? (subscription.metadata as any)
        : {}),
    },
    environment: providerEnv,
    account: selectedAccount,
  });

  return checkoutResult;
}
