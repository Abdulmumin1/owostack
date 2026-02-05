import { z } from "zod";

// =============================================================================
// Zod Schemas
// =============================================================================

const paymentChannelSchema = z.enum([
  "card",
  "bank",
  "bank_transfer",
  "ussd",
  "mobile_money",
  "qr",
]);

export const attachParamsSchema = z.object({
  customer: z.string().email("Customer must be a valid email"),
  product: z.string().min(1, "Product slug is required"),
  metadata: z.record(z.string(), z.unknown()).optional(),
  channels: z.array(paymentChannelSchema).optional(),
  currency: z.enum(["NGN", "GHS", "ZAR", "KES", "USD"]).optional(),
  callbackUrl: z.string().url().optional(),
});

export const checkParamsSchema = z.object({
  customer: z.string().email("Customer must be a valid email"),
  feature: z.string().min(1, "Feature slug is required"),
  amount: z.number().int().positive().default(1),
});

export const trackParamsSchema = z.object({
  customer: z.string().email("Customer must be a valid email"),
  feature: z.string().min(1, "Feature slug is required"),
  amount: z.number().int().positive().default(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
  credits: z.number().int().positive().optional(),
});

// =============================================================================
// Type Inference
// =============================================================================

export type ValidatedAttachParams = z.infer<typeof attachParamsSchema>;
export type ValidatedCheckParams = z.infer<typeof checkParamsSchema>;
export type ValidatedTrackParams = z.infer<typeof trackParamsSchema>;
