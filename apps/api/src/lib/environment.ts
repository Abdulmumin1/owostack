/**
 * Environment detection utilities
 * 
 * Determines whether to use test or live Paystack keys based on:
 * 1. Worker's ENVIRONMENT var (set per deployment)
 * 2. Fallback to project's activeEnvironment
 */

export type PaystackEnvironment = "test" | "live";

/**
 * Get the active Paystack environment from worker config
 * 
 * @param envVar - The ENVIRONMENT variable from worker config
 * @param projectActiveEnv - The project's activeEnvironment setting (fallback)
 * @returns "test" or "live"
 */
export function getPaystackEnvironment(
  envVar: string | undefined,
  projectActiveEnv?: string | null
): PaystackEnvironment {
  // Worker's ENVIRONMENT var takes precedence
  if (envVar === "production" || envVar === "live") {
    return "live";
  }
  if (envVar === "test" || envVar === "development") {
    return "test";
  }
  
  // Fallback to project's activeEnvironment
  if (projectActiveEnv === "live") {
    return "live";
  }
  
  // Default to test
  return "test";
}

/**
 * Select the correct encrypted Paystack key based on environment
 */
export function selectPaystackKey(
  environment: PaystackEnvironment,
  testKey: string | null | undefined,
  liveKey: string | null | undefined
): string | null {
  return environment === "live" ? (liveKey ?? null) : (testKey ?? null);
}
