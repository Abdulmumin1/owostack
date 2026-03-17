import { json } from "@sveltejs/kit";
import { owo } from "$lib/server/owo";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async ({ cookies }) => {
  const userId = cookies.get("userId");
  if (!userId) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const attachRes = await owo.attach({
      customer: userId,
      product: "starter", // The free plan slug
    });

    return json(attachRes);
  } catch (error: any) {
    return json({ error: error.message }, { status: 500 });
  }
};
