import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import { createDb, schema } from "@owostack/db";
import type { Env } from "../index";

/**
 * Wrap a D1Database binding so that any Date objects passed to
 * prepared-statement .bind() are converted to Unix-ms integers.
 * D1 doesn't support binding Date objects directly and drizzle-orm's
 * D1 session doesn't apply column-level mapToDriverValue, so we
 * intercept here as a safety net.
 */
function wrapD1ForDates(d1: D1Database): D1Database {
  return new Proxy(d1, {
    get(target, prop, receiver) {
      if (prop === "prepare") {
        return (sql: string) => {
          const stmt = target.prepare(sql);
          const origBind = stmt.bind.bind(stmt);
          return Object.assign(stmt, {
            bind(...args: unknown[]) {
              const safe = args.map((a) =>
                a instanceof Date ? a.getTime() : a,
              );
              return origBind(...safe);
            },
          });
        };
      }
      const val = Reflect.get(target, prop, receiver);
      return typeof val === "function" ? val.bind(target) : val;
    },
  });
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
  const d1 = env.DB_AUTH ?? env.DB;
  const db = createDb(wrapD1ForDates(d1));

  // Determine if running in production (non-localhost)
  const isProduction = env.BETTER_AUTH_URL && !env.BETTER_AUTH_URL.includes("localhost");

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
