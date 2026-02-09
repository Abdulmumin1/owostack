import { z } from "zod";
import { errorToResponse, ValidationError } from "./errors";

// =============================================================================
// Shared Helpers
// =============================================================================

export function zodErrorToResponse(zodError: {
  flatten: () => {
    formErrors: string[];
    fieldErrors: Record<string, string[] | undefined>;
  };
}) {
  const flattened = zodError.flatten();
  const fieldErrors = Object.entries(flattened.fieldErrors);

  if (fieldErrors.length > 0) {
    const [field, messages] = fieldErrors[0];
    return errorToResponse(
      new ValidationError({ field, details: messages?.[0] || "Invalid value" }),
    );
  }

  const formError = flattened.formErrors[0];
  return errorToResponse(
    new ValidationError({
      field: "input",
      details: formError || "Invalid request body",
    }),
  );
}

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
  currency: z.string().length(3).toUpperCase().optional(),
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
