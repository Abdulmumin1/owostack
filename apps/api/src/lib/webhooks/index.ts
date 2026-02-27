import { Result } from "better-result";
import type {
  ProviderAdapter,
  ProviderAccount,
  NormalizedWebhookEvent,
} from "@owostack/adapters";
import { EntitlementCache } from "../cache";
import { DatabaseError } from "../errors";
import { trackWebhookEvent } from "../analytics-engine";
import type { DB, WebhookContext, WebhookHandlerFn } from "./types";

// Handlers
import { handleSubscriptionCreated } from "./handlers/subscription-created";
import { handleSubscriptionStatus } from "./handlers/subscription-status";
import { handleChargeSuccess } from "./handlers/charge-success";
import { handleChargeFailed } from "./handlers/charge-failed";
import { handleRefund } from "./handlers/refund";
import { handleCustomerIdentified } from "./handlers/customer-identified";

// =============================================================================
// Handler Registry
// =============================================================================

const handlers: Record<string, WebhookHandlerFn> = {
  "subscription.created": handleSubscriptionCreated,
  "subscription.canceled": handleSubscriptionStatus("canceled"),
  "subscription.active": handleSubscriptionStatus("active"),
  "subscription.not_renew": handleSubscriptionStatus("pending_cancel"),
  "subscription.past_due": handleSubscriptionStatus("past_due"),
  "charge.success": handleChargeSuccess,
  "charge.failed": handleChargeFailed,
  "refund.success": handleRefund,
  "customer.identified": handleCustomerIdentified,
};

// =============================================================================
// WebhookHandler — thin router
// =============================================================================

export class WebhookHandler {
  private adapter: ProviderAdapter | null;
  private providerAccount: ProviderAccount | null;
  private trialEndWorkflow: any | null;
  private planUpgradeWorkflow: any | null;
  private cache: EntitlementCache | null;
  private analyticsEnv: {
    ANALYTICS?: AnalyticsEngineDataset;
    ENVIRONMENT?: string;
  } | null;

  constructor(
    private db: DB,
    private organizationId: string,
    opts?: {
      adapter?: ProviderAdapter;
      account?: ProviderAccount;
      trialEndWorkflow?: any;
      planUpgradeWorkflow?: any;
      cache?: KVNamespace;
      analyticsEnv?: {
        ANALYTICS?: AnalyticsEngineDataset;
        ENVIRONMENT?: string;
      };
    },
  ) {
    this.adapter = opts?.adapter || null;
    this.providerAccount = opts?.account || null;
    this.trialEndWorkflow = opts?.trialEndWorkflow || null;
    this.planUpgradeWorkflow = opts?.planUpgradeWorkflow || null;
    this.cache = opts?.cache ? new EntitlementCache(opts.cache) : null;
    this.analyticsEnv = opts?.analyticsEnv || null;
  }

  /**
   * Handle a normalized webhook event — provider-agnostic.
   * Verification + parsing are done upstream via the adapter.
   */
  async handle(
    event: NormalizedWebhookEvent,
  ): Promise<Result<boolean, DatabaseError>> {
    return Result.tryPromise({
      try: async () => {
        const eventId = crypto.randomUUID();
        const createdAt = Date.now();

        // 1. Log event for audit trail (via Analytics Engine now)
        if (this.analyticsEnv) {
          trackWebhookEvent(this.analyticsEnv, {
            id: eventId,
            organizationId: this.organizationId,
            type: event.type,
            providerId: event.provider,
            customerEmail: event.customer?.email || null,
            customerId: event.customer?.providerCustomerId || null,
            processed: false,
            payload: event.raw,
            createdAt,
          });
        }

        console.log(JSON.stringify(event, null, 2));

        // 2. Build context for handler
        const ctx: WebhookContext = {
          db: this.db,
          organizationId: this.organizationId,
          event,
          adapter: this.adapter,
          providerAccount: this.providerAccount,
          workflows: {
            trialEnd: this.trialEndWorkflow,
            planUpgrade: this.planUpgradeWorkflow,
          },
          cache: this.cache,
        };

        // 3. Dispatch to handler
        const handler = handlers[event.type];
        if (handler) {
          await handler(ctx);
        } else if (event.type === "refund.failed") {
          console.log(
            `[WEBHOOK] Refund failed for org=${this.organizationId}, ref=${event.refund?.reference}`,
          );
        }

        return true;
      },
      catch: (e) => new DatabaseError({ operation: "handleWebhook", cause: e }),
    });
  }
}
