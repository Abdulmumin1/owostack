import { browser } from "$app/environment";
import type { LayoutLoad } from "./$types";
import { hydrateEnvironment, type AppEnvironment } from "$lib/env";

export const load: LayoutLoad = async ({ data, params }) => {
  const activeEnvironment: AppEnvironment =
    data.activeEnvironment === "live" ? "live" : "test";

  if (browser) {
    hydrateEnvironment(activeEnvironment, params.projectId);
  }

  return {
    activeEnvironment,
  };
};
