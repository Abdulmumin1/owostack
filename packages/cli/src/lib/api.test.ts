import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCreditPacks, fetchCreditSystems } from "./api.js";

const originalFetch = globalThis.fetch;
const originalExit = process.exit;

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.exit = originalExit;
  vi.restoreAllMocks();
});

describe("credit catalog fetches", () => {
  it("aborts instead of returning an empty credit system list on API failure", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ success: false, error: "boom" }), {
          status: 500,
        }),
    ) as any;
    process.exit = vi.fn(() => undefined as never) as any;

    await expect(
      fetchCreditSystems("sk_test", "https://api.test"),
    ).rejects.toThrow("boom");
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("aborts instead of returning an empty credit pack list on network failure", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as any;
    process.exit = vi.fn(() => undefined as never) as any;

    await expect(
      fetchCreditPacks("sk_test", "https://api.test"),
    ).rejects.toThrow("fetch failed");
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
