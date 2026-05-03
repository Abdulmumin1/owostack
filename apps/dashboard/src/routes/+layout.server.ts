import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async ({ cookies, locals }) => {
  return {
    theme: cookies.get("theme") || "light",
    user: locals.user,
    session: locals.session,
  };
};
