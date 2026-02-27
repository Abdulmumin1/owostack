import { eq } from "drizzle-orm";
import * as schema from "@owostack/db";

/**
 * Resolve an organization identifier (ID or slug) to the actual organization ID.
 */
export async function resolveOrganizationId(
  db: any,
  identifier: string,
): Promise<string | null> {
  if (!identifier) return null;

  // First try to find by ID (UUID format check)
  const orgById = await db.query.organizations.findFirst({
    where: eq(schema.organizations.id, identifier),
    columns: { id: true },
  });

  if (orgById) {
    return orgById.id;
  }

  // If not found by ID, try by slug
  const orgBySlug = await db.query.organizations.findFirst({
    where: eq(schema.organizations.slug, identifier),
    columns: { id: true },
  });

  return orgBySlug?.id || null;
}

/**
 * Hono middleware to resolve organizationId from query params.
 * Updates c.req.query() to replace the slug with the actual ID.
 */
export function organizationResolver() {
  return async (c: any, next: any) => {
    const db = c.get("db");

    // Check query params
    const orgIdFromQuery = c.req.query("organizationId");
    if (orgIdFromQuery) {
      const resolvedId = await resolveOrganizationId(db, orgIdFromQuery);
      if (resolvedId && resolvedId !== orgIdFromQuery) {
        // Store resolved ID in context for later use
        c.set("resolvedOrganizationId", resolvedId);
      }
    }

    await next();
  };
}
