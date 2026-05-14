import { browser } from "$app/environment";
import type { LayoutLoad } from "./$types";
import { hydrateEnvironment, type AppEnvironment } from "$lib/env";

export const load: LayoutLoad = async ({ data, params }) => {
  const activeEnvironment: AppEnvironment =
    data.activeEnvironment === "live" ? "live" : "test";
  const projectId =
    (data.organization as { id?: string } | undefined)?.id || params.projectId;

  if (browser) {
    hydrateEnvironment(activeEnvironment, projectId);
  }

  return {
    activeEnvironment,
  };
};
