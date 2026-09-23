import type { Context, MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  checkApiKeyEnvironment,
  ENVIRONMENT_HEADER,
  environmentMismatchBody,
  extractBearerToken,
  ORGANIZATION_HEADER,
  resolvePublicEnvironment,
  type PublicEnvironment,
} from "./public-environment";

type EnvelopeBindings = { ENVIRONMENT?: string };
type EnvelopeVariables = { organizationId?: string };

/**
 * Public API envelope: enforces API key environment scope and echoes the
 * serving environment (and resolved organization) on every response so a
 * caller can always tell where a request landed.
 *
 * Mounted on the public `/v1` router, before per-route API key auth.
 */
export const publicApiEnvelope: MiddlewareHandler<{
  Bindings: EnvelopeBindings;
  Variables: EnvelopeVariables;
}> = async (c, next) => {
  const environment = resolvePublicEnvironment(c.env?.ENVIRONMENT);
  const check = checkApiKeyEnvironment(
    extractBearerToken(c.req.header("Authorization")),
    environment,
  );

  if (!check.ok) {
    c.header(ENVIRONMENT_HEADER, environment);
    return c.json(environmentMismatchBody(check), 401);
  }

  await next();

  applyEnvelopeHeaders(c.res.headers, environment, c.get("organizationId"));
  return;
};

export function applyEnvelopeHeaders(
  headers: Headers,
  environment: PublicEnvironment,
  organizationId: string | undefined,
): void {
  headers.set(ENVIRONMENT_HEADER, environment);
  if (organizationId) {
    headers.set(ORGANIZATION_HEADER, organizationId);
  }
}

/**
 * Adds `environment` (always) and `unlimited` (for entitlement results) to a
 * check/track JSON body.
 *
 * `unlimited` is derived rather than set at each of the ~50 response sites in
 * the entitlement handlers: access is unlimited when it was granted and no
 * finite cap applies. For credit-backed features the cap lives on the credits
 * object (`totalBalance`), otherwise on the top-level `limit`.
 */
export function decorateEntitlementBody<T extends Record<string, unknown>>(
  body: T,
  environment: PublicEnvironment,
): T & { environment: PublicEnvironment; unlimited?: boolean } {
  if (!("allowed" in body)) {
    return { ...body, environment };
  }
  return {
    ...body,
    environment,
    unlimited: deriveUnlimited(body),
  };
}

export function deriveUnlimited(body: {
  allowed?: unknown;
  limit?: unknown;
  credits?: unknown;
}): boolean {
  if (body.allowed !== true) return false;

  const credits = body.credits;
  if (credits && typeof credits === "object") {
    return (credits as { totalBalance?: unknown }).totalBalance === null;
  }

  return body.limit === null;
}

/**
 * Typed `c.json` replacement for the /check and /track handlers. Every exit
 * of those handlers goes through this so the body always carries
 * `environment` (and `unlimited` for entitlement results) without the
 * handlers needing to know about the deployment.
 */
export function createEntitlementResponder<
  C extends {
    env?: EnvelopeBindings;
    json: Context["json"];
  },
>(
  c: C,
  options: {
    /**
     * Extra `details` merged into granted responses, resolved at respond
     * time so the handler can decide after it knows which subscription
     * granted access (e.g. dunning state).
     */
    grantedDetails?: () => Record<string, unknown> | null;
  } = {},
) {
  const environment = resolvePublicEnvironment(c.env?.ENVIRONMENT);

  return function respond<
    T extends Record<string, unknown>,
    S extends ContentfulStatusCode = 200,
  >(body: T, status?: S) {
    const decorated = decorateEntitlementBody(body, environment);
    const extra = body.allowed === true ? options.grantedDetails?.() : null;
    if (!extra || Object.keys(extra).length === 0) {
      return c.json(decorated, status);
    }
    const details =
      decorated.details && typeof decorated.details === "object"
        ? (decorated.details as Record<string, unknown>)
        : {};
    return c.json(
      { ...decorated, details: { ...details, ...extra } } as typeof decorated,
      status,
    );
  };
}
