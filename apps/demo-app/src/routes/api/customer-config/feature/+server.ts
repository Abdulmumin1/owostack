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
  const rawOverage = body.overage;
  const rawMaxOverageUnits = body.maxOverageUnits;

  const overage =
    rawOverage === "block" || rawOverage === "charge" ? rawOverage : null;

  let maxOverageUnits: number | null = null;
  if (rawMaxOverageUnits !== null && rawMaxOverageUnits !== undefined) {
    const parsedValue = Number(rawMaxOverageUnits);
    if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
      return json(
        { error: "maxOverageUnits must be a positive whole number" },
        { status: 400 },
      );
    }
    maxOverageUnits = parsedValue;
  }

  try {
    const customer = await owo.customer.setFeatureConfig({
      customer: user.id,
      feature: "ai-credits",
      overage,
      maxOverageUnits,
    });

    return json(customer);
  } catch (error: any) {
    return json(
      { error: error.message || "Failed to update feature config" },
      { status: 500 },
    );
  }
};
