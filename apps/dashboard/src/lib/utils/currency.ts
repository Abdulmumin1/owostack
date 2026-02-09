/**
 * Shared currency formatting utilities.
 * Derives locale automatically from the currency code — no hardcoded "en-NG".
 */

/** Map of currency codes to a sensible default locale for formatting */
const CURRENCY_LOCALE: Record<string, string> = {
  NGN: "en-NG",
  GHS: "en-GH",
  ZAR: "en-ZA",
  KES: "en-KE",
  USD: "en-US",
  CAD: "en-CA",
  EUR: "de-DE",
  GBP: "en-GB",
  CHF: "de-CH",
  JPY: "ja-JP",
  CNY: "zh-CN",
  INR: "en-IN",
  SGD: "en-SG",
  HKD: "en-HK",
  AUD: "en-AU",
  NZD: "en-NZ",
  BRL: "pt-BR",
  MXN: "es-MX",
  ARS: "es-AR",
  COP: "es-CO",
  AED: "ar-AE",
  SAR: "ar-SA",
  EGP: "ar-EG",
  SEK: "sv-SE",
  NOK: "nb-NO",
  DKK: "da-DK",
  PLN: "pl-PL",
  CZK: "cs-CZ",
};

function getLocale(currency: string): string {
  return CURRENCY_LOCALE[currency.toUpperCase()] || "en-US";
}

/**
 * Format an amount (in minor units, e.g. kobo/cents) as a currency string.
 * Automatically picks the right locale based on the currency code.
 */
export function formatCurrency(
  amount: number,
  currency: string = "USD",
): string {
  const major = amount / 100;
  return new Intl.NumberFormat(getLocale(currency), {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 0,
  }).format(major);
}

/** Common currencies for UI dropdowns, ordered by typical usage */
export const COMMON_CURRENCIES = [
  { code: "USD", name: "US Dollar", symbol: "$" },
  { code: "EUR", name: "Euro", symbol: "€" },
  { code: "GBP", name: "British Pound", symbol: "£" },
  { code: "NGN", name: "Nigerian Naira", symbol: "₦" },
  { code: "GHS", name: "Ghanaian Cedi", symbol: "₵" },
  { code: "ZAR", name: "South African Rand", symbol: "R" },
  { code: "KES", name: "Kenyan Shilling", symbol: "KSh" },
  { code: "CAD", name: "Canadian Dollar", symbol: "CA$" },
  { code: "AUD", name: "Australian Dollar", symbol: "A$" },
  { code: "JPY", name: "Japanese Yen", symbol: "¥" },
  { code: "INR", name: "Indian Rupee", symbol: "₹" },
  { code: "BRL", name: "Brazilian Real", symbol: "R$" },
  { code: "MXN", name: "Mexican Peso", symbol: "MX$" },
  { code: "SGD", name: "Singapore Dollar", symbol: "S$" },
  { code: "CHF", name: "Swiss Franc", symbol: "CHF" },
  { code: "SEK", name: "Swedish Krona", symbol: "kr" },
  { code: "NOK", name: "Norwegian Krone", symbol: "kr" },
  { code: "DKK", name: "Danish Krone", symbol: "kr" },
  { code: "PLN", name: "Polish Zloty", symbol: "zł" },
  { code: "AED", name: "UAE Dirham", symbol: "د.إ" },
  { code: "SAR", name: "Saudi Riyal", symbol: "﷼" },
  { code: "EGP", name: "Egyptian Pound", symbol: "E£" },
  { code: "HKD", name: "Hong Kong Dollar", symbol: "HK$" },
  { code: "NZD", name: "New Zealand Dollar", symbol: "NZ$" },
  { code: "COP", name: "Colombian Peso", symbol: "COL$" },
  { code: "CNY", name: "Chinese Yuan", symbol: "¥" },
] as const;
