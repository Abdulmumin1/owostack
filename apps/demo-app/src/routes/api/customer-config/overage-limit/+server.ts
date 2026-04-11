import { json } from "@sveltejs/kit";
import { owo } from "$lib/server/owo";
import { getDemoUser } from "$lib/server/demo-user";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async ({ request, cookies }) => {
  const user = getDemoUser(cookies);
  if (!user) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const rawAmount = body.maxOverageAmount;
  const rawOnLimitReached = body.onLimitReached;

  const onLimitReached = rawOnLimitReached === "notify" ? "notify" : "block";

  let maxOverageAmount: number | null = null;
  if (rawAmount !== null && rawAmount !== undefined) {
    const parsedAmount = Number(rawAmount);
    if (!Number.isInteger(parsedAmount) || parsedAmount <= 0) {
      return json(
        { error: "maxOverageAmount must be a positive amount in minor units" },
        { status: 400 },
      );
    }
    maxOverageAmount = parsedAmount;
  }

  try {
    const customer = await owo.customer.setOverageLimit({
      customer: user.id,
      maxOverageAmount,
      onLimitReached,
    });

    return json(customer);
  } catch (error: any) {
    return json(
      { error: error.message || "Failed to update overage limit" },
      { status: 500 },
    );
  }
};
