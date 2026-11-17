import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  _creditSystemRegistry,
  _featureRegistry,
  bindFeatureHandles,
  buildSyncPayload,
  collectSyncWarnings,
  creditPack,
  creditSystem,
  metered,
  plan,
} from "./catalog";

describe("catalog credit system feature binding", () => {
  beforeEach(() => {
    _featureRegistry.clear();
    _creditSystemRegistry.clear();
  });

  afterEach(() => {
    _featureRegistry.clear();
    _creditSystemRegistry.clear();
  });

  it("binds feature handles that are only referenced through a plan credit system", async () => {
    const imageGeneration = metered("image-generation", {
      name: "Image Generation",
    });
    const aiCredits = creditSystem("ai-credits", {
      name: "AI Credits",
      features: [imageGeneration(5)],
    });
    const catalog = [
      plan("starter", {
        name: "Starter",
        price: 1900,
        currency: "NGN",
        interval: "monthly",
        features: [aiCredits.credits(100)],
      }),
    ];

    const payload = buildSyncPayload(catalog);

    expect(payload.features).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: "image-generation",
          type: "metered",
          name: "Image Generation",
        }),
      ]),
    );

    const client = {
      async check(params: { feature: string; customer: string }) {
        return {
          allowed: true,
          feature: params.feature,
          customer: params.customer,
        };
      },
    };

    bindFeatureHandles(client, catalog);

    expect(imageGeneration._client).toBe(client);
    await expect(imageGeneration.check("cust_123")).resolves.toMatchObject({
      allowed: true,
      feature: "image-generation",
      customer: "cust_123",
    });
  });

  it("binds feature handles referenced by direct credit system catalog entries", async () => {
    const textGeneration = metered("text-generation", {
      name: "Text Generation",
    });
    const aiCredits = creditSystem("ai-credits", {
      name: "AI Credits",
      features: [textGeneration(2)],
    });
    const catalog = [aiCredits];

    const payload = buildSyncPayload(catalog);

    expect(payload.features).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: "text-generation",
          type: "metered",
          name: "Text Generation",
        }),
      ]),
    );

    const client = {
      async check(params: { feature: string; customer: string }) {
        return {
          allowed: true,
          feature: params.feature,
          customer: params.customer,
        };
      },
    };

    bindFeatureHandles(client, catalog);

    expect(textGeneration._client).toBe(client);
    await expect(textGeneration.check("cust_456")).resolves.toMatchObject({
      allowed: true,
      feature: "text-generation",
      customer: "cust_456",
    });
  });

  it("includes standalone credit systems and packs without a plan", () => {
    const song = metered("song", { name: "Song" });
    const songs = creditSystem("songs", {
      name: "Song credits",
      features: [song(5)],
    });

    const payload = buildSyncPayload([
      songs,
      creditPack("song-pack", {
        name: "10 songs",
        credits: 50,
        price: 1000,
        currency: "USD",
        creditSystem: "songs",
      }),
    ]);

    expect(payload.features).toEqual([
      expect.objectContaining({ slug: "song", type: "metered" }),
    ]);
    expect(payload.creditSystems).toEqual([
      expect.objectContaining({
        slug: "songs",
        features: [{ feature: "song", creditCost: 5 }],
      }),
    ]);
    expect(payload.creditPacks).toEqual([
      expect.objectContaining({ slug: "song-pack", creditSystem: "songs" }),
    ]);
    expect(collectSyncWarnings(payload)).toEqual([]);
  });

  it("warns when a pack references a credit system absent from the sync", () => {
    const payload = buildSyncPayload([
      creditPack("orphan-pack", {
        name: "Orphan pack",
        credits: 10,
        price: 500,
        currency: "USD",
        creditSystem: "missing-system",
      }),
    ]);

    expect(collectSyncWarnings(payload)).toEqual([
      expect.stringContaining(
        "Credit pack 'orphan-pack' references credit system 'missing-system'",
      ),
    ]);
  });

  it("fails closed when rebinding a shared feature handle to a different client", () => {
    const apiCalls = metered("api-calls", { name: "API Calls" });
    const catalog = [
      plan("starter", {
        name: "Starter",
        price: 1900,
        currency: "NGN",
        interval: "monthly",
        features: [apiCalls.limit(100)],
      }),
    ];
    const sandboxClient = { environment: "sandbox" };
    const liveClient = { environment: "live" };

    bindFeatureHandles(sandboxClient, catalog);

    expect(() => bindFeatureHandles(liveClient, catalog)).toThrow(
      "Feature 'api-calls' is already bound to a different Owostack client",
    );
    expect(apiCalls._client).toBe(sandboxClient);
  });
});
