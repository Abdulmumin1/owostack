import { describe, expect, it } from "vitest";
import {
  checkApiKeyEnvironment,
  extractBearerToken,
  isOwostackApiKey,
  parseApiKeyEnvironment,
  resolvePublicEnvironment,
} from "./public-environment";
import { deriveUnlimited } from "./public-api-envelope";

describe("resolvePublicEnvironment", () => {
  it("only treats explicit live deployments as live", () => {
    expect(resolvePublicEnvironment("live")).toBe("live");
    expect(resolvePublicEnvironment("production")).toBe("live");
    expect(resolvePublicEnvironment("test")).toBe("sandbox");
    expect(resolvePublicEnvironment("development")).toBe("sandbox");
    expect(resolvePublicEnvironment(undefined)).toBe("sandbox");
    expect(resolvePublicEnvironment("LIVE")).toBe("sandbox");
  });
});

describe("API key prefixes", () => {
  it("parses the scope from scoped keys and null from legacy keys", () => {
    expect(parseApiKeyEnvironment("owo_sk_test_abc123")).toBe("test");
    expect(parseApiKeyEnvironment("owo_sk_live_abc123")).toBe("live");
    expect(parseApiKeyEnvironment("owo_sk_abc123")).toBeNull();
    // Legacy hex keys that happen to start with "test"/"live" but have no
    // separator are not scoped.
    expect(parseApiKeyEnvironment("owo_sk_testabc123")).toBeNull();
    expect(parseApiKeyEnvironment("sk_test_abc123")).toBeNull();
    expect(parseApiKeyEnvironment("owo_sk_test_")).toBeNull();
  });

  it("recognises scoped and legacy keys but not other tokens", () => {
    expect(isOwostackApiKey("owo_sk_test_abc123")).toBe(true);
    expect(isOwostackApiKey("owo_sk_abc123")).toBe(true);
    expect(isOwostackApiKey("owo_sk_")).toBe(false);
    expect(isOwostackApiKey("owo_sk_test_abc-123")).toBe(false);
    expect(isOwostackApiKey("owo_sk_fixture_key")).toBe(true);
    expect(isOwostackApiKey("Bearer owo_sk_abc")).toBe(false);
  });

  it("extracts bearer tokens case-insensitively", () => {
    expect(extractBearerToken("Bearer owo_sk_test_abc")).toBe(
      "owo_sk_test_abc",
    );
    expect(extractBearerToken("bearer   owo_sk_abc")).toBe("owo_sk_abc");
    expect(extractBearerToken("Basic abc")).toBeNull();
    expect(extractBearerToken(undefined)).toBeNull();
  });
});

describe("checkApiKeyEnvironment", () => {
  it("passes matching, legacy and absent keys", () => {
    expect(checkApiKeyEnvironment("owo_sk_test_abc", "sandbox")).toEqual({
      ok: true,
      keyEnvironment: "sandbox",
    });
    expect(checkApiKeyEnvironment("owo_sk_live_abc", "live")).toEqual({
      ok: true,
      keyEnvironment: "live",
    });
    expect(checkApiKeyEnvironment("owo_sk_abc", "live")).toEqual({
      ok: true,
      keyEnvironment: null,
    });
    expect(checkApiKeyEnvironment(null, "live")).toEqual({
      ok: true,
      keyEnvironment: null,
    });
  });

  it("fails on mismatch with an actionable message", () => {
    const result = checkApiKeyEnvironment("owo_sk_test_abc", "live");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.keyEnvironment).toBe("sandbox");
    expect(result.requestEnvironment).toBe("live");
    expect(result.message).toContain("owo_sk_live_");
    expect(result.message).toContain("https://sandbox.owostack.com");
    expect(result.message).toContain("https://api.owostack.com");
  });
});

describe("deriveUnlimited", () => {
  it("is true only for granted access with no finite cap", () => {
    expect(deriveUnlimited({ allowed: true, limit: null, credits: null })).toBe(
      true,
    );
    expect(deriveUnlimited({ allowed: true, limit: 100, credits: null })).toBe(
      false,
    );
    expect(
      deriveUnlimited({ allowed: false, limit: null, credits: null }),
    ).toBe(false);
  });

  it("uses the credits balance for credit-backed features", () => {
    expect(
      deriveUnlimited({
        allowed: true,
        limit: null,
        credits: { source: "credit_system", totalBalance: 40 },
      }),
    ).toBe(false);
    expect(
      deriveUnlimited({
        allowed: true,
        limit: null,
        credits: { source: "credit_system", totalBalance: null },
      }),
    ).toBe(true);
  });
});
