import * as p from "@clack/prompts";
import pc from "picocolors";
import { EXIT_CODES, isCliError, type ExitCode } from "./errors.js";

/**
 * Output abstraction so every command can run in two modes:
 *
 *   human  — clack spinners/notes on stderr-ish TTY output (default)
 *   json   — nothing but a single JSON document on stdout, no ANSI, no
 *            spinner frames; errors are JSON too. Built for CI logs.
 */
export interface Spinner {
  start(message: string): void;
  stop(message?: string): void;
}

export interface Reporter {
  readonly json: boolean;
  intro(label: string): void;
  outro(message: string): void;
  step(message: string): void;
  info(message: string): void;
  success(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  note(body: string, title?: string): void;
  spinner(): Spinner;
  /** Terminal output for --json mode. No-op for human mode. */
  emit(payload: Record<string, unknown>): void;
}

class HumanReporter implements Reporter {
  readonly json = false;
  intro(label: string) {
    p.intro(pc.bgYellow(pc.black(` ${label} `)));
  }
  outro(message: string) {
    p.outro(message);
  }
  step(message: string) {
    p.log.step(message);
  }
  info(message: string) {
    p.log.info(message);
  }
  success(message: string) {
    p.log.success(message);
  }
  warn(message: string) {
    p.log.warn(message);
  }
  error(message: string) {
    p.log.error(message);
  }
  note(body: string, title?: string) {
    p.note(body, title);
  }
  spinner(): Spinner {
    const s = p.spinner();
    return {
      start: (message) => s.start(message),
      stop: (message) => s.stop(message),
    };
  }
  emit() {}
}

class JsonReporter implements Reporter {
  readonly json = true;
  intro() {}
  outro() {}
  step() {}
  info() {}
  success() {}
  warn() {}
  error() {}
  note() {}
  spinner(): Spinner {
    return { start() {}, stop() {} };
  }
  emit(payload: Record<string, unknown>) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  }
}

export function createReporter(json: boolean | undefined): Reporter {
  return json ? new JsonReporter() : new HumanReporter();
}

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;

export function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, "");
}

/**
 * Convert any thrown error into the right exit code and, in --json mode, a
 * machine-readable error document. Used by the command runner in index.ts.
 */
export function reportFailure(
  reporter: Reporter,
  command: string,
  error: unknown,
): ExitCode {
  const cli = isCliError(error) ? error : null;
  const exitCode: ExitCode = cli?.exitCode ?? EXIT_CODES.failure;

  // "cancelled" is a controlled stop (user declined, or `diff --exit-code`
  // drift): the command already produced its output, only the code matters.
  if (cli?.code === "cancelled") return exitCode;
  const message =
    cli?.message ??
    (error instanceof Error ? error.message : String(error ?? "Unknown error"));

  if (reporter.json) {
    reporter.emit({
      ok: false,
      command,
      error: {
        code: cli?.code ?? "unexpected_error",
        message: stripAnsi(message),
        ...(cli?.hint ? { hint: cli.hint } : {}),
      },
      exitCode,
    });
  } else {
    reporter.error(pc.red(message));
    if (cli?.hint) reporter.info(pc.dim(cli.hint));
  }

  return exitCode;
}
