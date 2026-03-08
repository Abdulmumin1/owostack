import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Owostack, OwostackError } from "./index";

describe("Owostack client error handling", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("surfaces string API errors", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          success: false,
          error: "Stripe checkout requires a callbackUrl",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const client = new Owostack({
      secretKey: "owo_sk_test",
      apiUrl: "http://localhost:8787/api/v1",
    });

    await expect(
      client.attach({
        customer: "customer@example.com",
        product: "paid",
      }),
    ).rejects.toMatchObject<Partial<OwostackError>>({
      name: "OwostackError",
      code: "unknown_error",
      message: "Stripe checkout requires a callbackUrl",
    });
  });

  it("surfaces nested error objects", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "ValidationError",
            message: "Product slug is required",
          },
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const client = new Owostack({
      secretKey: "owo_sk_test",
      apiUrl: "http://localhost:8787/api/v1",
    });

    await expect(
      client.attach({
        customer: "customer@example.com",
        product: "",
      }),
    ).rejects.toMatchObject<Partial<OwostackError>>({
      name: "OwostackError",
      code: "ValidationError",
      message: "Product slug is required",
    });
  });
});
