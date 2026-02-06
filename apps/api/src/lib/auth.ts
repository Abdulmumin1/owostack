import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import { createDb, schema } from "@owostack/db";
import type { Env } from "../index";

/**
 * Convert Date objects to timestamps (milliseconds) for D1 compatibility.
 * D1 doesn't support binding Date objects directly.
 */
function convertDatesToTimestamps(data: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value instanceof Date) {
      result[key] = value.getTime();
    } else {
      result[key] = value;
    }
  }
  return result;
}

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
  // Auth uses the shared DB_AUTH so users/sessions/orgs are consistent
  // across test and live API workers. Falls back to DB for local dev.
  const db = createDb(env.DB_AUTH ?? env.DB);

  // Create base adapter
  const baseAdapterFactory = drizzleAdapter(db, {
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
  });

  // Wrap the adapter factory to intercept create/update calls and convert Dates
  const d1AdapterFactory = (options: any) => {
    const adapter = baseAdapterFactory(options);
    
    return {
      ...adapter,
      create: async (createOpts: any) => {
        return adapter.create({
          ...createOpts,
          data: convertDatesToTimestamps(createOpts.data),
        });
      },
      update: async (updateOpts: any) => {
        return adapter.update({
          ...updateOpts,
          update: convertDatesToTimestamps(updateOpts.update),
        });
      },
    };
  };

  // Determine if running in production (non-localhost)
  const isProduction = env.BETTER_AUTH_URL && !env.BETTER_AUTH_URL.includes("localhost");

  return betterAuth({
    database: d1AdapterFactory as any,

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
    },

    trustedOrigins: [
      "http://localhost:5173",
      "http://localhost:5174",
      "http://localhost:5175",
      "http://localhost:5176",
      "https://dashboard.owostack.com",
    ],

    // Cross-subdomain cookies so session works on both api-test and api workers
    ...(isProduction
      ? {
          advanced: {
            crossSubDomainCookies: {
              enabled: true,
              domain: ".owostack.com",
            },
          },
        }
      : {}),

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
