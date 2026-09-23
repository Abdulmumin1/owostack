import { APIError } from "better-auth/api";

/**
 * Organization slugs that would collide with fixed URL segments.
 *
 * Slugs are used as path segments in two places, so a reserved word there
 * would either shadow a route or be shadowed by one:
 *
 *   API        /webhooks/{slug}/{provider}      ← `sandbox` is the shared
 *                                                 managed-sandbox webhook URL
 *   Dashboard  /{slug}/plans, /{slug}/…         ← top-level dashboard routes
 *
 * Checked on create and update via Better Auth organization hooks, and by
 * `GET /api/organizations/slug-check/:slug` so the UI can say why.
 */
export const RESERVED_ORGANIZATION_SLUGS: ReadonlySet<string> = new Set([
  // API path segments
  "sandbox",
  "webhooks",
  "api",
  "live",
  "test",
  // Dashboard top-level routes
  "onboarding",
  "login",
  "signup",
  "auth",
  "cli",
  "join",
  "accept-invitation",
  "forgot-password",
  "reset-password",
  // Brand / infrastructure
  "owostack",
  "admin",
  "dashboard",
  "docs",
  "www",
]);

export function isReservedOrganizationSlug(slug: string | null | undefined) {
  if (!slug) return false;
  return RESERVED_ORGANIZATION_SLUGS.has(slug.trim().toLowerCase());
}

export function reservedSlugMessage(slug: string) {
  return `"${slug}" is reserved and cannot be used as an organization slug.`;
}

/** Throws the Better Auth error the organization hooks expect. */
export function assertOrganizationSlugAllowed(slug: string | null | undefined) {
  if (isReservedOrganizationSlug(slug)) {
    throw new APIError("BAD_REQUEST", {
      message: reservedSlugMessage(String(slug)),
      code: "RESERVED_ORGANIZATION_SLUG",
    });
  }
}
