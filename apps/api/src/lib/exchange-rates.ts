const CACHE_KEY = "exchange-rates";
const CACHE_TTL = 86400; // 24 hours

interface ExchangeRates {
  base: string;
  rates: Record<string, number>;
  fetchedAt: number;
}

/**
 * Fetch exchange rates with base=USD from a free API, cached in KV for 24h.
 * Returns rates relative to USD. Falls back to empty rates on failure.
 */
async function fetchRates(cache?: KVNamespace): Promise<ExchangeRates> {
  // Try KV cache first
  if (cache) {
    const cached = (await cache.get(CACHE_KEY, "json")) as ExchangeRates | null;
    if (cached) return cached;
  }

  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD");
    if (!res.ok) throw new Error(`Exchange rate API returned ${res.status}`);
    const data = (await res.json()) as {
      result: string;
      rates: Record<string, number>;
    };
    if (data.result !== "success") throw new Error("Exchange rate API error");

    const rates: ExchangeRates = {
      base: "USD",
      rates: data.rates,
      fetchedAt: Date.now(),
    };

    // Cache in KV (non-blocking is fine since we already have the data)
    if (cache) {
      // Fire-and-forget — caller can use waitUntil if they want
      cache
        .put(CACHE_KEY, JSON.stringify(rates), { expirationTtl: CACHE_TTL })
        .catch(() => {});
    }

    return rates;
  } catch {
    // Return empty rates — conversion will gracefully degrade
    return { base: "USD", rates: {}, fetchedAt: 0 };
  }
}

/**
 * Convert an amount from one currency to another using cached exchange rates.
 * Returns null if conversion is not possible (missing rate).
 */
function convert(
  amount: number,
  from: string,
  to: string,
  rates: ExchangeRates,
): number | null {
  if (from === to) return amount;
  const fromRate = from === rates.base ? 1 : rates.rates[from];
  const toRate = to === rates.base ? 1 : rates.rates[to];
  if (!fromRate || !toRate) return null;
  // Convert: amount in `from` → USD → `to`
  return (amount / fromRate) * toRate;
}

/**
 * Convert an array of per-currency MRR entries into a single total
 * in the target currency. Returns the converted total and a flag
 * indicating whether all conversions succeeded.
 */
export async function convertMrrTotal(
  mrrByCurrency: { currency: string; amount: number }[],
  targetCurrency: string,
  cache?: KVNamespace,
): Promise<{ amount: number; currency: string; approximate: boolean } | null> {
  if (mrrByCurrency.length === 0) return null;
  // If only one currency and it matches target, no conversion needed
  if (
    mrrByCurrency.length === 1 &&
    mrrByCurrency[0].currency === targetCurrency
  ) {
    return {
      amount: mrrByCurrency[0].amount,
      currency: targetCurrency,
      approximate: false,
    };
  }

  const rates = await fetchRates(cache);
  let total = 0;
  let approximate = false;

  for (const entry of mrrByCurrency) {
    const converted = convert(
      entry.amount,
      entry.currency,
      targetCurrency,
      rates,
    );
    if (converted === null) {
      // Can't convert this currency — skip it and mark as approximate
      approximate = true;
      continue;
    }
    if (entry.currency !== targetCurrency) approximate = true;
    total += converted;
  }

  return { amount: Math.round(total), currency: targetCurrency, approximate };
}
