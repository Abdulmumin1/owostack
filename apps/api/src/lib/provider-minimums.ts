/**
 * Provider-specific minimum charge amounts by currency.
 * All amounts are in the currency's smallest unit (kobo, cents, etc.)
 */

export const PROVIDER_MINIMUMS: Record<string, Record<string, number>> = {
  paystack: {
    NGN: 5000, // ₦50.00 (5,000 kobo) - https://docs-v2.paystack.com/payments/recurring-charges/
    GHS: 10, // GH₵0.10 (10 pesewas) - https://docs-v2.paystack.com/payments/recurring-charges/
    USD: 20, // $0.20 (20 cents) - https://docs-v2.paystack.com/payments/recurring-charges/
    ZAR: 100, // R1.00 (100 cents) - https://docs-v2.paystack.com/payments/recurring-charges/
  },
  dodo: {
    USD: 50, // $0.50 (50 cents) - https://docs.dodopayments.com/features/payment-methods
    EUR: 50, // €0.50 (50 cents)
    GBP: 50, // £0.50 (50 pence)
  },
};

/**
 * Get the minimum charge amount for a provider and currency.
 * Returns 0 if no minimum is defined (allows any amount).
 */
export function getMinimumChargeAmount(
  providerId: string,
  currency: string,
): number {
  const providerMinimums = PROVIDER_MINIMUMS[providerId.toLowerCase()];
  if (!providerMinimums) return 0;

  const minimum = providerMinimums[currency.toUpperCase()];
  return minimum ?? 0;
}

/**
 * Check if an amount meets the minimum charge requirement for a provider/currency.
 */
export function meetsMinimumCharge(
  amount: number,
  providerId: string,
  currency: string,
): boolean {
  const minimum = getMinimumChargeAmount(providerId, currency);
  if (minimum === 0) return true; // No minimum defined
  return amount >= minimum;
}
