import { describe, expect, it } from "vitest";
import { paystackAdapter } from "../../packages/adapters/src/paystack";

describe("Paystack adapter behavior", () => {
  it("extracts renewal subscription details from charge.success invoice updates", () => {
    const parsed = paystackAdapter.parseWebhookEvent({
      payload: {
        event: "charge.success",
        data: {
          amount: 3000000,
          currency: "NGN",
          reference: "renew_ref_1",
          paid_at: "2026-03-06T17:00:15.000Z",
          metadata: {
            invoice_action: "update",
          },
          customer: {
            email: "customerx12@example.com",
            customer_code: "CUS_41uuf7daarvgkkw",
          },
          subscription: {
            subscription_code: "SUB_renew_1",
            current_period_start: "2026-03-06T17:00:15.000Z",
            next_payment_date: "2026-04-06T17:00:15.000Z",
            plan: {
              plan_code: "PLN_mfm3iy6fyattbda",
            },
          },
        },
      },
    });

    expect(parsed.isOk()).toBe(true);
    if (parsed.isErr()) return;

    expect(parsed.value.type).toBe("charge.success");
    expect(parsed.value.subscription?.providerCode).toBe("SUB_renew_1");
    expect(parsed.value.subscription?.startDate).toBe(
      "2026-03-06T17:00:15.000Z",
    );
    expect(parsed.value.subscription?.nextPaymentDate).toBe(
      "2026-04-06T17:00:15.000Z",
    );
    expect(parsed.value.plan?.providerPlanCode).toBe("PLN_mfm3iy6fyattbda");
  });

  it("extracts invoice subscription details for payment failures", () => {
    const parsed = paystackAdapter.parseWebhookEvent({
      payload: {
        event: "invoice.payment_failed",
        data: {
          currency: "NGN",
          invoice_code: "INV_123",
          customer: {
            email: "customerx12@example.com",
            customer_code: "CUS_41uuf7daarvgkkw",
          },
          subscription: {
            subscription_code: "SUB_fail_1",
          },
        },
      },
    });

    expect(parsed.isOk()).toBe(true);
    if (parsed.isErr()) return;

    expect(parsed.value.type).toBe("charge.failed");
    expect(parsed.value.subscription?.providerCode).toBe("SUB_fail_1");
  });
});
