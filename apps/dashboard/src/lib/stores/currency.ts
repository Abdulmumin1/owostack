import { writable } from "svelte/store";

/**
 * Org-level default currency store.
 * Set once when the layout loads, consumed by all forms/components.
 * Falls back to "USD" if the org hasn't configured one yet.
 */
export const defaultCurrency = writable<string>("USD");
