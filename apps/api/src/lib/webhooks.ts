import { Result } from "better-result";
import type { createDb } from "@owostack/db";
import { schema } from "@owostack/db";
import { eq, and } from "drizzle-orm";
import { WebhookError, DatabaseError } from "./errors";

// =============================================================================
// Types
// =============================================================================

interface WebhookPayload {
  event: string;
  data: Record<string, unknown>;
}

type DB = ReturnType<typeof createDb>;

// =============================================================================
// Handler Implementation
// =============================================================================

export class WebhookHandler {
  constructor(
    private secret: string,
    private db: DB,
    private organizationId: string,
  ) {}

  /**
   * Verify webhook signature using HMAC SHA-512
   */
  async verify(
    signature: string,
    payload: string,
  ): Promise<Result<boolean, WebhookError>> {
    return Result.tryPromise({
      try: async () => {
        const encoder = new TextEncoder();
        const key = await crypto.subtle.importKey(
          "raw",
          encoder.encode(this.secret),
          { name: "HMAC", hash: "SHA-512" },
          false,
          ["verify"],
        );

        const signatureBytes = hexToBytes(signature);
        const verified = await crypto.subtle.verify(
          "HMAC",
          key,
          signatureBytes,
          encoder.encode(payload),
        );

        if (!verified) {
          throw new WebhookError({ reason: "invalid_signature" });
        }

        return true;
      },
      catch: (e) => {
        if (e instanceof WebhookError) return e;
        return new WebhookError({ reason: "invalid_signature" });
      },
    });
  }

  /**
   * Handle webhook event - scoped to organization
   */
  async handle(
    payload: WebhookPayload,
  ): Promise<Result<boolean, DatabaseError>> {
    return Result.tryPromise({
      try: async () => {
        // 2. Log event for audit trail
        await this.db.insert(schema.events).values({
          id: crypto.randomUUID(),
          organizationId: this.organizationId,
          type: payload.event,
          data: payload.data,
          processed: false,
        });

        // 3. Route to specific handler
        switch (payload.event) {
          case "subscription.create":
            await this.handleSubscriptionCreate(payload.data);
            break;
          case "subscription.disable":
            await this.handleSubscriptionStatusChange(payload.data, "canceled");
            break;
          case "subscription.enable":
            await this.handleSubscriptionStatusChange(payload.data, "active");
            break;
          case "subscription.not_renew":
            await this.handleSubscriptionStatusChange(
              payload.data,
              "pending_cancel",
            );
            break;
          case "charge.success":
            await this.handleChargeSuccess(payload.data);
            break;
          case "invoice.payment_failed":
            await this.handlePaymentFailed(payload.data);
            break;
          case "customeridentification.success":
            await this.handleCustomerIdentified(payload.data);
            break;
        }

        // 4. Mark event as processed
        // Could update the event record here

        return true;
      },
      catch: (e) => new DatabaseError({ operation: "handleWebhook", cause: e }),
    });
  }

  private async handleSubscriptionCreate(data: Record<string, unknown>) {
    const customer = data.customer as { email: string; customer_code: string };
    const plan = data.plan as { plan_code: string };

    // Find or create customer scoped to this organization
    let dbCustomer = await this.db.query.customers.findFirst({
      where: and(
        eq(schema.customers.email, customer.email),
        eq(schema.customers.organizationId, this.organizationId),
      ),
    });

    if (!dbCustomer) {
      // Auto-create customer from Paystack data
      const [newCustomer] = await this.db
        .insert(schema.customers)
        .values({
          id: crypto.randomUUID(),
          organizationId: this.organizationId,
          email: customer.email,
          paystackCustomerId: customer.customer_code,
        })
        .returning();
      dbCustomer = newCustomer;
    }

    const dbPlan = await this.db.query.plans.findFirst({
      where: and(
        eq(schema.plans.paystackPlanId, plan.plan_code),
        eq(schema.plans.organizationId, this.organizationId),
      ),
    });

    if (!dbPlan) {
      console.warn(
        `Plan ${plan.plan_code} not found in org ${this.organizationId}`,
      );
      return;
    }

    // Check for existing subscription (idempotency)
    const existing = await this.db.query.subscriptions.findFirst({
      where: eq(
        schema.subscriptions.paystackSubscriptionCode,
        data.subscription_code as string,
      ),
    });

    if (existing) return; // Already processed

    // Create subscription
    await this.db.insert(schema.subscriptions).values({
      id: crypto.randomUUID(),
      customerId: dbCustomer.id,
      planId: dbPlan.id,
      paystackSubscriptionId: String(data.id),
      paystackSubscriptionCode: data.subscription_code as string,
      status: "active",
      currentPeriodStart: parsePaystackDate(data.start as string),
      currentPeriodEnd: parsePaystackDate(data.next_payment_date as string),
      metadata: data,
    });
  }

  private async handleSubscriptionStatusChange(
    data: Record<string, unknown>,
    status: string,
  ) {
    const subscriptionCode = data.subscription_code as string;
    if (!subscriptionCode) return;

    await this.db
      .update(schema.subscriptions)
      .set({
        status,
        updatedAt: new Date(),
        ...(status === "canceled" ? { canceledAt: new Date() } : {}),
      })
      .where(
        eq(schema.subscriptions.paystackSubscriptionCode, subscriptionCode),
      );
  }

  private async handleChargeSuccess(data: Record<string, unknown>) {
    const metadata = (data.metadata as Record<string, unknown>) || {};

    // Handle credits if specified
    if (typeof metadata.credits === "number") {
      const customerEmail = (data.customer as { email?: string })?.email;

      if (customerEmail) {
        const customer = await this.db.query.customers.findFirst({
          where: and(
            eq(schema.customers.email, customerEmail),
            eq(schema.customers.organizationId, this.organizationId),
          ),
        });

        if (customer) {
          // Check if exists
          const existingCredits = await this.db.query.credits.findFirst({
            where: eq(schema.credits.customerId, customer.id),
          });

          if (existingCredits) {
            await this.db
              .update(schema.credits)
              .set({
                balance: existingCredits.balance + metadata.credits,
                updatedAt: new Date(),
              })
              .where(eq(schema.credits.id, existingCredits.id));
          } else {
            await this.db.insert(schema.credits).values({
              id: crypto.randomUUID(),
              customerId: customer.id,
              balance: metadata.credits,
            });
          }
        }
      }
    }
  }

  private async handlePaymentFailed(data: Record<string, unknown>) {
    const subscriptionCode = data.subscription_code as string;
    if (!subscriptionCode) return;

    await this.db
      .update(schema.subscriptions)
      .set({ status: "past_due", updatedAt: new Date() })
      .where(
        eq(schema.subscriptions.paystackSubscriptionCode, subscriptionCode),
      );
  }

  private async handleCustomerIdentified(data: Record<string, unknown>) {
    const email = data.email as string;
    if (!email) return;

    // Update customer verification status
    await this.db
      .update(schema.customers)
      .set({
        metadata: { verified: true, verifiedAt: new Date().toISOString() },
      })
      .where(
        and(
          eq(schema.customers.email, email),
          eq(schema.customers.organizationId, this.organizationId),
        ),
      );
  }
}

// =============================================================================
// Helpers
// =============================================================================

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function parsePaystackDate(dateStr: string): Date {
  // Paystack uses ISO 8601 format
  return new Date(dateStr);
}
