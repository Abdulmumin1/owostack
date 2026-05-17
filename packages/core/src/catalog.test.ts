import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  _creditSystemRegistry,
  _featureRegistry,
  bindFeatureHandles,
  buildSyncPayload,
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
    const aiCreditsDefinition = creditSystem("ai-credits", {
      name: "AI Credits",
      features: [textGeneration(2)],
    })._buildDefinition();
    const catalog = [aiCreditsDefinition];

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
});
