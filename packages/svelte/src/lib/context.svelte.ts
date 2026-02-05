import { Owostack } from "@owostack/core";
import type { OwostackConfig } from "@owostack/types";
import { getContext, setContext } from "svelte";

const OWOSTACK_CONTEXT_KEY = Symbol("owostack");

/**
 * Create Owostack context for Svelte app
 *
 * @example
 * ```svelte
 * <script>
 *   import { createOwostackContext } from '@owostack/svelte';
 *
 *   createOwostackContext({
 *     secretKey: import.meta.env.VITE_PAYSTACK_SECRET_KEY
 *   });
 * </script>
 * ```
 */
export function createOwostackContext(config: OwostackConfig): Owostack {
  const owo = new Owostack(config);
  setContext(OWOSTACK_CONTEXT_KEY, owo);
  return owo;
}

/**
 * Get Owostack instance from context
 */
export function owostack(): Owostack {
  const owo = getContext<Owostack>(OWOSTACK_CONTEXT_KEY);
  if (!owo) {
    throw new Error(
      "Owostack context not found. Did you call createOwostackContext()?",
    );
  }
  return owo;
}
