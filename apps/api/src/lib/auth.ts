import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import { createDb, schema } from "@owostack/db";
import type { Env } from "../index";

/**
 * Better Auth Configuration
 *
 * Features:
 * - Email/Password authentication
 * - OAuth providers (Google, GitHub)
 * - Organization plugin for teams
 * - Session management
 */
export function auth(env: Env) {
  const db = createDb(env.DB);

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: {
        user: schema.users,
        session: schema.sessions,
        account: schema.accounts,
        verification: schema.verifications,
        organization: schema.organizations,
        member: schema.members,
        invitation: schema.invitations,
      },
    }),

    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,

    emailAndPassword: {
      enabled: true,
    },

    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID || "",
        clientSecret: env.GOOGLE_CLIENT_SECRET || "",
      },
      // github: {
      //   clientId: env.GITHUB_CLIENT_ID || "",
      //   clientSecret: env.GITHUB_CLIENT_SECRET || "",
      // },
    },

    trustedOrigins: [
      "http://localhost:5173",
      "http://localhost:5174",
      "http://localhost:5175",
      "http://localhost:5176",
    ],

    plugins: [
      organization({
        allowUserToCreateOrganization: true,
        organizationLimit: 5,
        creatorRole: "owner",
        membershipLimit: 100,
      }),
    ],
  });
}

export type Auth = ReturnType<typeof auth>;
