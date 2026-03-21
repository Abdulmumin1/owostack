import { z } from "@hono/zod-openapi";

export const metadataSchema = z.record(z.string(), z.unknown());

export const structuredErrorSchema = z
  .object({
    code: z.string(),
    message: z.string(),
  })
  .passthrough();

export const errorResponseSchema = z
  .object({
    success: z.boolean().optional(),
    error: z.union([z.string(), structuredErrorSchema]).optional(),
    code: z.string().optional(),
    message: z.string().optional(),
  })
  .passthrough();

export const successResponseSchema = z
  .object({
    success: z.literal(true),
  })
  .passthrough();

export const jsonContent = <T extends z.ZodTypeAny>(schema: T) => ({
  content: {
    "application/json": {
      schema,
    },
  },
});

export const apiKeySecurity = [{ bearerAuth: [] }];

export const badRequestResponse = {
  description: "Invalid request",
  ...jsonContent(errorResponseSchema),
};

export const unauthorizedResponse = {
  description: "Authentication failed",
  ...jsonContent(errorResponseSchema),
};

export const notFoundResponse = {
  description: "Resource not found",
  ...jsonContent(errorResponseSchema),
};

export const conflictResponse = {
  description: "Request conflicts with existing data",
  ...jsonContent(errorResponseSchema),
};

export const internalServerErrorResponse = {
  description: "Internal server error",
  ...jsonContent(errorResponseSchema),
};

export const pricingTierSchema = z
  .object({
    upTo: z.number().nullable(),
    unitPrice: z.number().optional(),
    flatFee: z.number().optional(),
  })
  .openapi("PricingTier");

export const billingTierBreakdownSchema = z
  .object({
    tier: z.number(),
    units: z.number(),
    unitPrice: z.number(),
    flatFee: z.number().optional(),
    amount: z.number(),
  })
  .openapi("BillingTierBreakdown");

export const pricingDetailsSchema = z
  .object({
    usageModel: z.enum(["included", "usage_based", "prepaid"]).optional(),
    ratingModel: z.enum(["package", "graduated", "volume"]).optional(),
    pricePerUnit: z.number().nullable().optional(),
    billingUnits: z.number().nullable().optional(),
    currentTier: z
      .object({
        index: z.number(),
        startsAt: z.number(),
        endsAt: z.number().nullable(),
        unitPrice: z.number(),
        flatFee: z.number().optional(),
      })
      .optional(),
  })
  .openapi("PricingDetails");

export const customerDataSchema = z
  .object({
    email: z.string().email(),
    name: z.string().optional(),
    metadata: metadataSchema.optional(),
  })
  .openapi("CustomerData");

export const paymentMethodSchema = z
  .object({
    id: z.string(),
    type: z.enum(["card", "provider_managed"]),
    provider: z.string(),
    isDefault: z.boolean(),
    isValid: z.boolean(),
    card: z
      .object({
        id: z.string(),
        last4: z.string(),
        brand: z.string(),
        exp: z.string(),
        provider: z.string(),
      })
      .nullable(),
  })
  .openapi("PaymentMethod");
