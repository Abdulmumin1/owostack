import type { Cookies } from "@sveltejs/kit";

export type DemoUser = {
  id: string;
  email: string;
  name: string;
};

export function getDemoUser(cookies: Cookies): DemoUser | null {
  const id = cookies.get("userId");
  const email = cookies.get("userEmail");
  const name = cookies.get("userName");

  if (!id || !email) {
    return null;
  }

  return {
    id,
    email,
    name: name || email.split("@")[0],
  };
}
