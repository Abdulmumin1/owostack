/**
 * Redirects for paths people (and agents) commonly guess.
 *
 * Fumadocs route groups keep URLs short (`/getting-started/quickstart`), but
 * the nav label is just "Quickstart", so `/quickstart` is a natural guess —
 * and used to 404. Same for `/docs/...` prefixes copied from other products.
 *
 * Pure function so it can be unit-tested and shared between the HTML route
 * and the `.md` route.
 */
const EXACT: Record<string, string> = {
  // Get started
  "/quickstart": "/getting-started/quickstart",
  "/quick-start": "/getting-started/quickstart",
  "/getting-started": "/getting-started/installation",
  "/get-started": "/getting-started/installation",
  "/installation": "/getting-started/installation",
  "/install": "/getting-started/installation",
  "/how-it-works": "/getting-started/how-it-works",
  "/data-model": "/getting-started/data-model",
  "/providers": "/getting-started/providers",
  "/api-keys": "/getting-started/api-keys",
  "/keys": "/getting-started/api-keys",
  "/environments": "/getting-started/environments",
  "/environment": "/getting-started/environments",
  "/sandbox": "/getting-started/environments",
  "/webhooks": "/getting-started/webhook-setup",
  "/webhook-setup": "/getting-started/webhook-setup",

  // SDK
  "/sdk": "/sdk/configuration",
  "/configuration": "/sdk/configuration",
  "/config": "/sdk/configuration",
  "/track": "/sdk/track",
  "/check": "/sdk/check",
  "/attach": "/sdk/attach",
  "/customer": "/sdk/customer",
  "/customers": "/sdk/customer",
  "/entities": "/sdk/entities",
  "/wallet": "/sdk/wallet",
  "/billing": "/sdk/billing",
  "/catalog": "/sdk/catalog",
  "/plans": "/sdk/plans",
  "/addon": "/sdk/addon",
  "/addons": "/sdk/addon",

  // Pricing
  "/pricing": "/pricing/pricing-models",
  "/credits": "/pricing/credits",
  "/overage": "/pricing/overage",
  "/seats": "/pricing/seat-pricing",
  "/seat-pricing": "/pricing/seat-pricing",

  // Lifecycle
  "/subscriptions": "/subscriptions/checkout",
  "/checkout": "/subscriptions/checkout",
  "/trials": "/subscriptions/trials",

  // Reference
  "/api": "/api-reference",
  "/api-ref": "/api-reference",
  "/reference": "/api-reference",
  "/openapi": "/openapi.json",
  "/cli/reference": "/cli/commands",
  "/cli/auth/connect": "/cli/auth",
};

/** Prefixes that are simply stripped (`/docs/sdk/track` -> `/sdk/track`). */
const STRIP_PREFIXES = ["/docs"];

/**
 * Return the canonical path for a legacy/guessed path, or null when the path
 * should be served as-is. Works on both `/foo` and `/foo.md`.
 */
export function resolveRedirect(pathname: string): string | null {
  const md = pathname.endsWith(".md");
  let path = md ? pathname.slice(0, -3) : pathname;
  path = normalize(path);

  let changed = false;
  for (const prefix of STRIP_PREFIXES) {
    if (path === prefix) {
      path = "/";
      changed = true;
      break;
    }
    if (path.startsWith(`${prefix}/`)) {
      path = path.slice(prefix.length);
      changed = true;
      break;
    }
  }

  const mapped = EXACT[path];
  if (mapped) {
    path = mapped;
    changed = true;
  }

  if (!changed) return null;
  if (md && !path.endsWith(".json")) {
    return path === "/" ? "/index.md" : `${path}.md`;
  }
  return path;
}

function normalize(path: string): string {
  let out = path.startsWith("/") ? path : `/${path}`;
  out = out.replace(/\/{2,}/g, "/");
  if (out.length > 1 && out.endsWith("/")) out = out.slice(0, -1);
  return out.toLowerCase();
}

/** Known redirect sources — handy for tests and for a sanity list. */
export const REDIRECT_SOURCES = Object.keys(EXACT);
