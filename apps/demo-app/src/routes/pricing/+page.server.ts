import { owo } from "$lib/server/owo";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ parent }) => {
  const { user } = await parent();

  try {
    const plansRes = await owo.plans();
    return {
      plans: plansRes.plans || [],
      user,
    };
  } catch (e) {
    console.error("Error fetching plans:", e);
    return {
      plans: [],
      user,
    };
  }
};
