import { error } from "@sveltejs/kit";
import { getPricingTemplateBySlug } from "$lib/content/pricing-templates";

export function load({ params }) {
  const template = getPricingTemplateBySlug(params.slug);

  if (!template) {
    throw error(404, "Pricing template not found");
  }

  return {
    template,
  };
}
