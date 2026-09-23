import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@owostack/db";
import { auth } from "../../../src/lib/auth";
import type { Env } from "../../../src/index";
import { createRuntimeBusinessDb } from "../helpers/business-db";
import {
  isReservedOrganizationSlug,
  RESERVED_ORGANIZATION_SLUGS,
} from "../../../src/lib/reserved-slugs";

/**
 * Real Better Auth instance over the SQLite-backed D1: sign a user up, then
 * try to create / rename organizations onto reserved slugs. This is the only
 * place a slug is ever written, so the hook is the whole guarantee.
 */
describe("Reserved organization slugs", () => {
  let businessDb: ReturnType<typeof createRuntimeBusinessDb>;
  let api: ReturnType<typeof auth>["api"];
  let headers: Headers;

  beforeEach(async () => {
    businessDb = createRuntimeBusinessDb();
    api = auth({
      DB: businessDb.d1,
      DB_AUTH: businessDb.d1,
      BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-1234",
      BETTER_AUTH_URL: "http://localhost:8787",
    } as unknown as Env).api;

    const signUp = await api.signUpEmail({
      body: {
        name: "Slug Tester",
        email: "slugs@example.com",
        password: "correct-horse-battery-staple",
      },
      returnHeaders: true,
    });
    const cookie = signUp.headers.get("set-cookie");
    expect(cookie).toBeTruthy();
    headers = new Headers({ cookie: cookie! });
  });

  afterEach(() => {
    businessDb.close();
  });

  it("covers the shared sandbox webhook segment and the dashboard's top-level routes", () => {
    for (const slug of ["sandbox", "webhooks", "onboarding", "login", "cli"]) {
      expect(RESERVED_ORGANIZATION_SLUGS.has(slug)).toBe(true);
    }
    expect(isReservedOrganizationSlug("SANDBOX")).toBe(true);
    expect(isReservedOrganizationSlug(" sandbox ")).toBe(true);
    expect(isReservedOrganizationSlug("my-sandbox")).toBe(false);
    expect(isReservedOrganizationSlug(null)).toBe(false);
  });

  it("refuses to create an organization on a reserved slug and writes nothing", async () => {
    await expect(
      api.createOrganization({
        body: { name: "Hijack", slug: "sandbox" },
        headers,
      }),
    ).rejects.toMatchObject({
      status: "BAD_REQUEST",
      body: {
        code: "RESERVED_ORGANIZATION_SLUG",
        message: expect.stringContaining('"sandbox" is reserved'),
      },
    });

    const rows = await businessDb.db.query.organizations.findMany({
      where: eq(schema.organizations.slug, "sandbox"),
    });
    expect(rows).toHaveLength(0);
  });

  it("still creates organizations on ordinary slugs", async () => {
    const org = await api.createOrganization({
      body: { name: "Acme", slug: "acme-sandbox" },
      headers,
    });

    expect(org?.slug).toBe("acme-sandbox");
  });

  it("refuses to rename an existing organization onto a reserved slug", async () => {
    const org = await api.createOrganization({
      body: { name: "Acme", slug: "acme" },
      headers,
    });

    await expect(
      api.updateOrganization({
        body: { organizationId: org!.id, data: { slug: "webhooks" } },
        headers,
      }),
    ).rejects.toMatchObject({
      body: { code: "RESERVED_ORGANIZATION_SLUG" },
    });

    const stillAcme = await businessDb.db.query.organizations.findFirst({
      where: eq(schema.organizations.id, org!.id),
    });
    expect(stillAcme?.slug).toBe("acme");
  });
});
