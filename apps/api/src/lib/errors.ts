import { TaggedError } from "better-result";

// =============================================================================
// Domain Errors
// =============================================================================

export class NotFoundError extends TaggedError("NotFoundError")<{
  resource: string;
  id: string;
  message: string;
}>() {
  constructor(args: { resource: string; id: string }) {
    super({ ...args, message: `${args.resource} not found: ${args.id}` });
  }
}

export class ValidationError extends TaggedError("ValidationError")<{
  field: string;
  details: string;
  message: string;
}>() {
  constructor(args: { field: string; details: string }) {
    super({ ...args, message: `Invalid ${args.field}: ${args.details}` });
  }
}

export class AuthError extends TaggedError("AuthError")<{
  reason:
    | "missing_key"
    | "invalid_key"
    | "expired_key"
    | "insufficient_permissions";
  message: string;
}>() {
  constructor(args: { reason: AuthError["reason"] }) {
    const messages = {
      missing_key: "API key is required",
      invalid_key: "Invalid API key",
      expired_key: "API key has expired",
      insufficient_permissions: "Insufficient permissions for this operation",
    };
    super({ ...args, message: messages[args.reason] });
  }
}

export class QuotaExceededError extends TaggedError("QuotaExceededError")<{
  feature: string;
  current: number;
  limit: number;
  message: string;
}>() {
  constructor(args: { feature: string; current: number; limit: number }) {
    super({
      ...args,
      message: `Quota exceeded for ${args.feature}: ${args.current}/${args.limit}`,
    });
  }
}

// =============================================================================
// Infrastructure Errors
// =============================================================================

export class PaystackError extends TaggedError("PaystackError")<{
  statusCode: number;
  paystackMessage: string;
  message: string;
  cause?: unknown;
}>() {
  constructor(args: {
    statusCode: number;
    paystackMessage: string;
    cause?: unknown;
  }) {
    super({
      ...args,
      message: `Paystack API error (${args.statusCode}): ${args.paystackMessage}`,
    });
  }
}

export class DatabaseError extends TaggedError("DatabaseError")<{
  operation: string;
  message: string;
  cause: unknown;
}>() {
  constructor(args: { operation: string; cause: unknown }) {
    const msg =
      args.cause instanceof Error ? args.cause.message : String(args.cause);
    super({ ...args, message: `Database ${args.operation} failed: ${msg}` });
  }
}

export class WebhookError extends TaggedError("WebhookError")<{
  reason: "missing_signature" | "invalid_signature" | "parse_failed";
  message: string;
}>() {
  constructor(args: { reason: WebhookError["reason"] }) {
    const messages = {
      missing_signature: "Missing x-paystack-signature header",
      invalid_signature: "Invalid webhook signature",
      parse_failed: "Failed to parse webhook payload",
    };
    super({ ...args, message: messages[args.reason] });
  }
}

// =============================================================================
// Error Unions
// =============================================================================

export type AppError =
  | NotFoundError
  | ValidationError
  | AuthError
  | QuotaExceededError
  | PaystackError
  | DatabaseError
  | WebhookError;

// =============================================================================
// HTTP Response Helpers
// =============================================================================

export function errorToHttpStatus(error: AppError): number {
  switch (error._tag) {
    case "NotFoundError":
      return 404;
    case "ValidationError":
      return 400;
    case "AuthError":
      return error.reason === "insufficient_permissions" ? 403 : 401;
    case "QuotaExceededError":
      return 429;
    case "PaystackError":
      return 502;
    case "DatabaseError":
      return 500;
    case "WebhookError":
      return error.reason === "missing_signature" ||
        error.reason === "invalid_signature"
        ? 401
        : 400;
    default:
      return 500;
  }
}

export function errorToResponse(error: AppError) {
  return {
    success: false as const,
    error: {
      code: error._tag,
      message: error.message,
    },
  };
}
