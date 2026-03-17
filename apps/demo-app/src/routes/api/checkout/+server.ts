import { json } from "@sveltejs/kit";
import { owo } from "$lib/server/owo";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async ({ request, cookies, url }) => {
  const userId = cookies.get("userId");
  if (!userId) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const plan = body.plan;

  // Build callback URL for after payment
  const origin = url.origin;
  const callbackUrl = `${origin}/?checkout=success`;

  try {
    console.log(`[Checkout] Attaching plan ${plan} for user ${userId}`);

    const attachRes = await owo.attach({
      customer: userId,
      product: plan,
      callbackUrl,
    });

    console.log(`[Checkout] Attach response:`, attachRes);

    // Return checkout URL if available
    if (attachRes.checkoutUrl) {
      return json({
        success: true,
        checkoutUrl: attachRes.checkoutUrl,
        reference: attachRes.reference,
      });
    }

    // If no URL, plan was attached directly (e.g., free plan)
    return json({
      success: true,
      attached: true,
      plan,
    });
  } catch (error: any) {
    console.error(`[Checkout] Error:`, error);
    return json(
      {
        success: false,
        error: error.message || "Failed to create checkout",
      },
      { status: 500 },
    );
  }
};
