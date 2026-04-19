import { redirect } from "@sveltejs/kit";
import { owo } from "$lib/server/owo";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ cookies }) => {
  if (cookies.get("userId")) {
    throw redirect(302, "/");
  }
};

export const actions: Actions = {
  default: async ({ request, cookies }) => {
    const data = await request.formData();
    const email = data.get("email")?.toString();
    const name = data.get("name")?.toString();

    if (!email || !name) {
      return { error: "Email and name are required" };
    }

    try {
      const customer = await owo.customer({
        id: crypto.randomUUID(),
        email,
        name,
        metadata: { source: "demo-app" },
      });

      cookies.set("userId", customer.id, { path: "/" });
      cookies.set("userEmail", customer.email, { path: "/" });
      cookies.set("userName", customer.name || "", { path: "/" });

      throw redirect(303, "/");
    } catch (error: any) {
      return { error: error.message || "Failed to onboard" };
    }
  },
};
