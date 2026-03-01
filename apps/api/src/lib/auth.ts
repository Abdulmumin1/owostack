import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import { createDb, schema } from "@owostack/db";
import type { Env } from "../index";
import { dash } from "@better-auth/infra";
import { sendEmail } from "./email";

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
  const isProduction =
    env.BETTER_AUTH_URL && !env.BETTER_AUTH_URL.includes("localhost");

  return betterAuth({
    appName: "Owostack",
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
      forgetPassword: {
        enabled: true,
      },
      async sendResetPassword({ user, token }, request) {
        // In dev, use the origin or localhost dashboard
        const origin =
          request?.headers.get("origin") || "http://localhost:5173";
        const resetURL = `${origin}/reset-password?token=${token}`;

        console.log(`[AUTH] 🔑 Password reset requested for ${user.email}`);
        console.log(`[AUTH] 🔗 Reset URL: ${resetURL}`);

        await sendEmail(env, {
          to: user.email,
          subject: "Reset your Owostack password",
          text: `Hi,\n\nYou requested a password reset for your Owostack account. Click the link below to set a new password:\n\n${resetURL}\n\nIf you didn't request this, you can safely ignore this email.\n\nThanks!`,
          html: `
            <div style="background-color: #fafaf5; padding: 48px 24px; font-family: 'Outfit', 'DM Sans', system-ui, sans-serif; color: #1a1a1a;">
              <div style="max-width: 480px; margin: 0 auto; background-color: #ffffff; padding: 32px; border: 1px solid #e0d9cc; border-radius: 12px; box-shadow: 6px 6px 0 0 #e0d9cc;">
                <h2 style="font-size: 20px; margin: 0 0 16px 0; font-weight: 700; color: #1a1a1a;">Reset Your Password</h2>
                <p style="font-size: 14px; line-height: 1.6; color: #3d3d3d; margin-bottom: 24px;">
                  Hi,<br><br>
                  You requested a password reset for your Owostack account. Click the button below to set a new password:
                </p>
                <a href="${resetURL}" style="display: inline-block; background-color: #e8a855; color: #1a1a1a; padding: 12px 24px; border: 1px solid #c07515; border-radius: 4px; text-decoration: none; font-weight: 700; font-size: 14px; box-shadow: 0 4px 0 0 #c07515;">
                  Reset Password →
                </a>
                <p style="font-size: 12px; color: #8b8b8b; margin-top: 32px; border-top: 1px solid #ede9df; padding-top: 16px;">
                  If you didn't request this, you can safely ignore this email.
                </p>
              </div>
            </div>
          `.trim(),
        });
      },
    },

    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID || "",
        clientSecret: env.GOOGLE_CLIENT_SECRET || "",
      },
      github: {
        clientId: env.GITHUB_CLIENT_ID || "",
        clientSecret: env.GITHUB_CLIENT_SECRET || "",
      },
    },

    trustedOrigins: [
      "http://localhost:5173",
      "http://localhost:5174",
      "http://localhost:5175",
      "http://localhost:5176",
      "https://app.owostack.com",
    ],

    advanced: {
      ipAddress: {
        // For Cloudflare
        ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for"],
      },
    },

    // Cross-subdomain cookies so session works on both sandbox and api workers
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
        async sendInvitationEmail(data) {
          // Use dashboard URL for the invite link (not API)
          // Fallback to constructing from BETTER_AUTH_URL or localhost
          const dashboardUrl =
            env.DASHBOARD_URL ||
            env.BETTER_AUTH_URL?.replace(/localhost:\d+/, "localhost:5173") ||
            "http://localhost:5173";
          const inviteLink = `${dashboardUrl}/join/${data.id}`;
          console.log(
            `[AUTH] 📧 Organization invitation sent to ${data.email}`,
          );
          console.log(`[AUTH] 🔗 Invite link: ${inviteLink}`);

          await sendEmail(env, {
            to: data.email,
            subject: `Join ${data.organization.name} on Owostack`,
            text: `Hi,\n\n${data.inviter.user.email} has invited you to join the organization "${data.organization.name}" on Owostack as a ${data.role}.\n\nClick the link below to accept the invitation:\n\n${inviteLink}\n\nThanks!`,
            html: `
              <div style="background-color: #fafaf5; padding: 48px 24px; font-family: 'Outfit', 'DM Sans', system-ui, sans-serif; color: #1a1a1a;">
                <div style="max-width: 480px; margin: 0 auto; background-color: #ffffff; padding: 32px; border: 1px solid #e0d9cc; border-radius: 12px; box-shadow: 6px 6px 0 0 #e0d9cc;">
                  <h2 style="font-size: 20px; margin: 0 0 16px 0; font-weight: 700; color: #1a1a1a;">Organization Invitation</h2>
                  <p style="font-size: 14px; line-height: 1.6; color: #3d3d3d; margin-bottom: 24px;">
                    Hi,<br><br>
                    <strong>${data.inviter.user.email}</strong> has invited you to join the organization <strong>${data.organization.name}</strong> on Owostack as a <strong>${data.role}</strong>.
                  </p>
                  <a href="${inviteLink}" style="display: inline-block; background-color: #e8a855; color: #1a1a1a; padding: 12px 24px; border: 1px solid #c07515; border-radius: 4px; text-decoration: none; font-weight: 700; font-size: 14px; box-shadow: 0 4px 0 0 #c07515;">
                    Join Organization →
                  </a>
                  <p style="font-size: 12px; color: #8b8b8b; margin-top: 32px; border-top: 1px solid #ede9df; padding-top: 16px;">
                    If you didn't expect this invitation, you can safely ignore this email.
                  </p>
                </div>
              </div>
            `.trim(),
          });
        },
      }),
      dash(),
    ],
  });
}

export type Auth = ReturnType<typeof auth>;
