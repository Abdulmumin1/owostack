/**
 * Stable exit codes for scripting / CI.
 *
 *   0  success (including "nothing to do")
 *   1  operation failed (API error, network error, sync rejected)
 *   2  usage or configuration error (missing key/mode, key/mode mismatch, no config file)
 *   3  differences detected (`diff --exit-code`)
 */
export const EXIT_CODES = {
  ok: 0,
  failure: 1,
  usage: 2,
  drift: 3,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

export type CliErrorCode =
  | "config_not_found"
  | "config_invalid"
  | "missing_api_key"
  | "missing_mode"
  | "mode_mismatch"
  | "api_error"
  | "network_error"
  | "sync_failed"
  | "cancelled";

export class CliError extends Error {
  readonly name = "CliError";

  constructor(
    readonly code: CliErrorCode,
    message: string,
    readonly exitCode: ExitCode,
    readonly hint?: string,
  ) {
    super(message);
  }
}

export function isCliError(error: unknown): error is CliError {
  return error instanceof CliError;
}

export function usageError(
  code: Extract<
    CliErrorCode,
    | "config_not_found"
    | "config_invalid"
    | "missing_api_key"
    | "missing_mode"
    | "mode_mismatch"
  >,
  message: string,
  hint?: string,
): CliError {
  return new CliError(code, message, EXIT_CODES.usage, hint);
}

export function failure(
  code: Extract<CliErrorCode, "api_error" | "network_error" | "sync_failed">,
  message: string,
  hint?: string,
): CliError {
  return new CliError(code, message, EXIT_CODES.failure, hint);
}
