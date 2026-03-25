import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async ({ cookies }) => {
  const userId = cookies.get("userId");
  const userEmail = cookies.get("userEmail");
  const userName = cookies.get("userName");

  return {
    user: userId ? { id: userId, email: userEmail, name: userName } : null,
  };
};
