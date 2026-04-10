import { json } from "@sveltejs/kit";
import { owo } from "$lib/server/owo";
import { getDemoUser } from "$lib/server/demo-user";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async ({ cookies, url }) => {
  const user = getDemoUser(cookies);
  if (!user) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const callbackUrl = new URL("/", url);
    callbackUrl.searchParams.set("tab", "billing");

    const setup = await owo.wallet.setup(user.id, {
      callbackUrl: callbackUrl.toString(),
    });

    return json(setup);
  } catch (error: any) {
    return json(
      { error: error.message || "Failed to create wallet setup session" },
      { status: 500 },
    );
  }
};
