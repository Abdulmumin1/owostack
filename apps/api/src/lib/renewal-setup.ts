export const RENEWAL_SETUP_RETRY_DELAYS_MS = [
  15 * 60 * 1000,
  6 * 60 * 60 * 1000,
  24 * 60 * 60 * 1000,
] as const;

export type RenewalSetupStatus =
  | "failed"
  | "scheduled"
  | "retrying"
  | "complete";

export interface RenewalSetupMetadata {
  renewal_setup_status?: RenewalSetupStatus;
  renewal_setup_retry_count?: number;
  renewal_setup_last_error?: string | null;
  renewal_setup_last_attempt_at?: number | null;
  renewal_setup_next_attempt_at?: number | null;
  renewal_setup_updated_at?: number | null;
  renewal_setup_last_source?: string | null;
}

export interface RenewalSetupRecoveryUpdate {
  clearCancelAt: boolean;
  metadata: Record<string, unknown>;
}

export function coerceMetadataRecord(
  metadata: unknown,
): Record<string, unknown> {
  if (!metadata) return {};
  if (typeof metadata === "string") {
    try {
      const parsed = JSON.parse(metadata);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  if (typeof metadata === "object" && !Array.isArray(metadata)) {
    return metadata as Record<string, unknown>;
  }
  return {};
}

export function readRenewalSetupMetadata(
  metadata: unknown,
): RenewalSetupMetadata {
  const record = coerceMetadataRecord(metadata);
  const status = record.renewal_setup_status;
  const retryCount = Number(record.renewal_setup_retry_count);
  const lastAttemptAt = Number(record.renewal_setup_last_attempt_at);
  const nextAttemptAt = Number(record.renewal_setup_next_attempt_at);
  const updatedAt = Number(record.renewal_setup_updated_at);

  return {
    renewal_setup_status:
      status === "failed" ||
      status === "scheduled" ||
      status === "retrying" ||
      status === "complete"
        ? status
        : undefined,
    renewal_setup_retry_count: Number.isFinite(retryCount) ? retryCount : 0,
    renewal_setup_last_error:
      typeof record.renewal_setup_last_error === "string"
        ? record.renewal_setup_last_error
        : null,
    renewal_setup_last_attempt_at: Number.isFinite(lastAttemptAt)
      ? lastAttemptAt
      : null,
    renewal_setup_next_attempt_at: Number.isFinite(nextAttemptAt)
      ? nextAttemptAt
      : null,
    renewal_setup_updated_at: Number.isFinite(updatedAt) ? updatedAt : null,
    renewal_setup_last_source:
      typeof record.renewal_setup_last_source === "string"
        ? record.renewal_setup_last_source
        : null,
  };
}

export function writeRenewalSetupMetadata(
  metadata: unknown,
  patch: Partial<RenewalSetupMetadata>,
): Record<string, unknown> {
  return {
    ...coerceMetadataRecord(metadata),
    ...patch,
  };
}

export function hasRenewalSetupIssue(metadata: unknown): boolean {
  const status = readRenewalSetupMetadata(metadata).renewal_setup_status;
  return status === "failed" || status === "scheduled" || status === "retrying";
}

export function buildRenewalSetupRecoveryUpdate(
  metadata: unknown,
  source: string,
  now: number = Date.now(),
): RenewalSetupRecoveryUpdate | null {
  if (!hasRenewalSetupIssue(metadata)) return null;

  const state = readRenewalSetupMetadata(metadata);
  return {
    clearCancelAt: true,
    metadata: writeRenewalSetupMetadata(metadata, {
      renewal_setup_status: "complete",
      renewal_setup_retry_count: state.renewal_setup_retry_count || 0,
      renewal_setup_last_error: null,
      renewal_setup_last_attempt_at: now,
      renewal_setup_next_attempt_at: null,
      renewal_setup_updated_at: now,
      renewal_setup_last_source: source,
    }),
  };
}

export function isRetryableRenewalSetupFailure(reason: string): boolean {
  const normalized = (reason || "").trim().toLowerCase();
  if (!normalized) return true;

  if (
    normalized === "missing_provider_plan_code" ||
    normalized === "missing_provider_adapter" ||
    normalized === "missing_customer_email" ||
    normalized === "missing_provider_customer_id" ||
    normalized === "missing_provider_payment_method" ||
    normalized === "missing_provider_account"
  ) {
    return false;
  }

  if (
    /invalid_authorization|validation_error|invalid_request|authorization.*(invalid|expired|not found)/i.test(
      normalized,
    )
  ) {
    return false;
  }

  return true;
}
