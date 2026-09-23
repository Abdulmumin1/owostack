import { describe, expect, it } from "vitest";
import {
  resolveApiBaseUrl,
  resolveApiHost,
  resolveMode,
} from "./environment.js";
import { isCliError } from "./errors.js";

function failsWith(fn: () => unknown, code: string, exitCode: number) {
  try {
    fn();
  } catch (error) {
    expect(isCliError(error)).toBe(true);
    if (!isCliError(error)) throw error;
    expect(error.code).toBe(code);
    expect(error.exitCode).toBe(exitCode);
    return error;
  }
  throw new Error("expected the call to throw");
}

describe("resolveMode", () => {
  it("takes --mode first", () => {
    expect(resolveMode({ flagMode: "live", apiKey: "owo_sk_legacy" })).toEqual({
      mode: "live",
      source: "flag",
      legacyProdFlag: false,
    });
    expect(resolveMode({ flagMode: "sandbox", envMode: "live" }).mode).toBe(
      "sandbox",
    );
  });

  it("treats --prod as a deprecated alias for --mode live", () => {
    expect(resolveMode({ prod: true, apiKey: "owo_sk_legacy" })).toEqual({
      mode: "live",
      source: "flag",
      legacyProdFlag: true,
    });
  });

  it("falls back to OWOSTACK_MODE, accepting common spellings", () => {
    expect(resolveMode({ envMode: "live" }).source).toBe("env");
    expect(resolveMode({ envMode: "production" }).mode).toBe("live");
    expect(resolveMode({ envMode: "test" }).mode).toBe("sandbox");
  });

  it("infers the mode from an environment-scoped key", () => {
    expect(resolveMode({ apiKey: "owo_sk_test_abc" })).toEqual({
      mode: "sandbox",
      source: "key",
      legacyProdFlag: false,
    });
    expect(resolveMode({ apiKey: "owo_sk_live_abc" }).mode).toBe("live");
  });

  it("refuses to run when nothing selects a mode (no silent default)", () => {
    const error = failsWith(
      () => resolveMode({ apiKey: "owo_sk_legacy" }),
      "missing_mode",
      2,
    );
    expect(error.message).toContain("--mode sandbox");
    failsWith(() => resolveMode({}), "missing_mode", 2);
  });

  it("refuses a mode that contradicts the key scope before any network call", () => {
    const error = failsWith(
      () => resolveMode({ flagMode: "live", apiKey: "owo_sk_test_abc" }),
      "mode_mismatch",
      2,
    );
    expect(error.message).toContain("scoped to sandbox");
    expect(error.hint).toContain("--mode sandbox");

    failsWith(
      () => resolveMode({ envMode: "sandbox", apiKey: "owo_sk_live_abc" }),
      "mode_mismatch",
      2,
    );
    failsWith(
      () => resolveMode({ flagMode: "sandbox", prod: true }),
      "mode_mismatch",
      2,
    );
  });

  it("rejects unknown mode values", () => {
    failsWith(() => resolveMode({ flagMode: "staging" }), "missing_mode", 2);
    failsWith(() => resolveMode({ envMode: "prd" }), "missing_mode", 2);
  });
});

describe("resolveApiHost / resolveApiBaseUrl", () => {
  it("uses the public host for the mode by default", () => {
    expect(resolveApiHost({ mode: "sandbox" })).toBe(
      "https://sandbox.owostack.com",
    );
    expect(resolveApiBaseUrl({ mode: "live" })).toBe(
      "https://api.owostack.com/api/v1",
    );
  });

  it("lets OWOSTACK_API_URL override the selected mode's host (one knob)", () => {
    expect(
      resolveApiHost({ mode: "live", envApiUrl: "http://localhost:8787/" }),
    ).toBe("http://localhost:8787");
    expect(
      resolveApiHost({
        mode: "sandbox",
        envApiUrl: "http://localhost:8787",
        configEnvironments: { test: "https://ignored.example.com" },
      }),
    ).toBe("http://localhost:8787");
  });

  it("falls back to per-mode env overrides, then owo.config environments", () => {
    expect(
      resolveApiHost({
        mode: "live",
        envLiveUrl: "https://live.internal",
        configEnvironments: { live: "https://config.internal" },
      }),
    ).toBe("https://live.internal");
    expect(
      resolveApiHost({
        mode: "sandbox",
        envLiveUrl: "https://live.internal",
        configEnvironments: { test: "https://sandbox.internal" },
      }),
    ).toBe("https://sandbox.internal");
  });
});
