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

  it("builds customer usage history requests with query params", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          customer: { id: "cust_123" },
          query: {
            range: { from: "2026-04-01", to: "2026-04-30" },
            granularity: "day",
            feature: "api_calls",
            groupBy: "feature",
            timezone: "Africa/Lagos",
          },
          totals: { usage: 42, records: 3 },
          series: [{ bucket: "2026-04-01", value: 42 }],
          breakdown: [],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const client = new Owostack({
      secretKey: "owo_sk_test",
      apiUrl: "http://localhost:8787/api/v1",
    });

    const result = await client.customer.usageHistory({
      customer: "cust_123",
      range: "custom",
      granularity: "day",
      feature: "api_calls",
      groupBy: "feature",
      timezone: "Africa/Lagos",
      from: "2026-04-01",
      to: "2026-04-30",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8787/api/v1/customers/cust_123/usage/history?range=custom&granularity=day&feature=api_calls&groupBy=feature&timezone=Africa%2FLagos&from=2026-04-01&to=2026-04-30",
      expect.objectContaining({
        method: "GET",
        headers: {
          Authorization: "Bearer owo_sk_test",
        },
      }),
    );
    expect(result).toEqual({
      customer: { id: "cust_123" },
      query: {
        range: { from: "2026-04-01", to: "2026-04-30" },
        granularity: "day",
        feature: "api_calls",
        groupBy: "feature",
        timezone: "Africa/Lagos",
      },
      totals: { usage: 42, records: 3 },
      series: [{ bucket: "2026-04-01", value: 42 }],
      breakdown: [],
    });
  });
});
