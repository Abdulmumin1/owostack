import { json } from "@sveltejs/kit";
import { owo } from "$lib/server/owo";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async ({ request, cookies }) => {
  const userId = cookies.get("userId");
  if (!userId) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const modelId = body.model || "gemini";
  const messages = body.messages || [];

  const multipliers: Record<string, number> = {
    gemini: 1,
    pro: 3,
    ultra: 10,
  };
  const cost = 5 * (multipliers[modelId] || 1);
  const featureId = "ai-credits";

  try {
    // Check if user is using a premium model but doesn't have access
    if (modelId !== "gemini") {
      const modelCheck = await owo.check({
        customer: userId,
        feature: "premium-models",
      });
      if (!modelCheck.allowed) {
        return json(
          {
            error: `Upgrade to Pro to use Premium Models (${modelId}).`,
            allowed: false,
            code: modelCheck.code,
          },
          { status: 403 },
        );
      }
    }

    // 1. Pre-generation access check (owo.check)
    const check = await owo.check({
      customer: userId,
      feature: featureId,
      value: cost,
    });

    if (!check.allowed) {
      return json(
        {
          error: `Insufficient credits: ${check.code.replace(/_/g, " ")}. You need ${cost} credits.`,
          allowed: false,
          code: check.code,
        },
        { status: 403 },
      );
    }

    // (Simulation) Pretend we generated a response
    const textResponse = `Simulated response from ${modelId} (${cost} credits). Owostack metered this transaction.`;

    // 2. Post-generation usage tracking (owo.track)
    await owo.track({
      customer: userId,
      feature: featureId,
      value: cost,
    });

    const updatedCheck = await owo.check({
      customer: userId,
      feature: featureId,
      value: 0,
    });

    return json({
      message: textResponse,
      tracked: true,
      cost,
      checkResult: updatedCheck,
    });
  } catch (error: any) {
    return json({ error: error.message }, { status: 500 });
  }
};
