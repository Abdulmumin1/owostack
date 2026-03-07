export type PricingTemplateAccent = "amber" | "teal" | "blue" | "rose";

export type PricingTemplate = {
  slug: string;
  title: string;
  shortTitle: string;
  eyebrow: string;
  inspiredBy: string;
  summary: string;
  headline: string;
  description: string;
  category: string;
  accent: PricingTemplateAccent;
  tags: string[];
  highlights: string[];
  whyItWorks: string;
  breakdown: Array<{ label: string; value: string }>;
  rules: string[];
  builderSnippet: string;
};

export const pricingTemplates: PricingTemplate[] = [
  {
    slug: "flat-subscription",
    title: "Flat Subscription",
    shortTitle: "Flat subscription",
    eyebrow: "Predictable recurring SaaS",
    inspiredBy: "Basecamp-style access",
    summary: "Single monthly price with no usage tracking.",
    headline: "One price for everything.",
    description:
      "Fixed monthly fee with included features. No per-user charges or usage metering.",
    category: "Subscription",
    accent: "amber",
    tags: ["simple", "predictable", "no-surprises"],
    highlights: [
      "flat monthly fee",
      "no per-user charges",
      "predictable billing",
    ],
    whyItWorks:
      "Eliminates billing complexity for both customers and operators. No usage tracking overhead, no variable invoices. Customers know exactly what they'll pay each month.",
    breakdown: [
      { label: "Base fee", value: "$49 / month" },
      { label: "Usage model", value: "Included" },
      { label: "Overage", value: "Block" },
    ],
    rules: [
      "Customers pay the plan price only.",
      "Feature limits gate access but do not create extra charges.",
      "Invoice copy stays short because there is no metered reconciliation.",
    ],
    builderSnippet: `const projects = metered("projects", {
  name: "Projects",
});

plan("starter", {
  name: "Starter",
  price: 4900,
  currency: "USD",
  interval: "monthly",
  features: [
    projects.config({
      usageModel: "included",
      limit: 10,
      overage: "block",
      reset: "monthly",
    }),
  ],
});`,
  },
  {
    slug: "included-quota-saas",
    title: "Subscription With Included Quota",
    shortTitle: "Included quota SaaS",
    eyebrow: "Quota-driven SaaS",
    inspiredBy: "Notion-style allowances",
    summary: "Base fee with included usage allowance.",
    headline: "Subscription with usage buffer.",
    description:
      "Monthly subscription includes a usage quota. Access is blocked when quota is exhausted.",
    category: "Subscription + quota",
    accent: "teal",
    tags: ["fair", "safety-net", "growth-ready"],
    highlights: [
      "stable monthly revenue",
      "included allowance",
      "predictable costs",
    ],
    whyItWorks:
      "Balances predictable revenue with usage protection. Customers get generous allowances without surprise charges. Prevents abuse while keeping billing simple.",
    breakdown: [
      { label: "Base fee", value: "$99 / month" },
      { label: "Included", value: "50,000 events" },
      { label: "After limit", value: "Block or upsell" },
    ],
    rules: [
      "Included units reset on the plan interval.",
      "No spend-cap logic is needed when overage is blocked.",
      "This is usually the cleanest step before pure usage-based billing.",
    ],
    builderSnippet: `const events = metered("events", {
  name: "Events",
});

plan("growth", {
  name: "Growth",
  price: 9900,
  currency: "USD",
  interval: "monthly",
  features: [
    events.config({
      usageModel: "included",
      limit: 50_000,
      overage: "block",
      reset: "monthly",
    }),
  ],
});`,
  },
  {
    slug: "openai-rate-window-credits",
    title: "Rate Window + Credits Fallback",
    shortTitle: "OpenAI fallback",
    eyebrow: "Burst quota with credit fallback",
    inspiredBy: "OpenAI-style access waterfall",
    summary:
      "Short-window quota with credit-based overflow.",
    headline: "Rate limiting with graceful fallback.",
    description:
      "Primary quota resets frequently. When exhausted, requests consume prepaid credits instead of failing.",
    category: "Usage-based",
    accent: "blue",
    tags: ["forgiving", "scaling", "no-crashes"],
    highlights: [
      "short reset windows",
      "credit fallback layer",
      "no hard failures",
    ],
    whyItWorks:
      "Prevents service interruption during usage spikes. Primary quota handles normal traffic, credits absorb bursts. Users stay operational without hitting rate limits.",
    breakdown: [
      { label: "Window", value: "500 requests / hour" },
      { label: "Primary layer", value: "Included usage" },
      { label: "Fallback layer", value: "Add-on credits" },
    ],
    rules: [
      "The short reset included quota is checked first on every request.",
      "If the window is exhausted, add-on credits are consumed before denying access.",
      "Responses should make the allowance source obvious: window or credits.",
    ],
    builderSnippet: `const agentRuns = metered("agent-runs", {
  name: "Agent Runs",
});

const agentCredits = creditSystem("agent-credits", {
  name: "Agent Credits",
  features: [agentRuns(1)],
});

plan("codex", {
  name: "Codex",
  price: 0,
  currency: "USD",
  interval: "monthly",
  features: [
    agentRuns.config({
      usageModel: "included",
      limit: 500,
      reset: "hourly",
      overage: "block",
    }),
    agentCredits.credits(5_000, { reset: "monthly" }),
  ],
});

creditPack("agent-topup", {
  name: "Agent Top-up",
  price: 2000,
  currency: "USD",
  credits: 5_000,
  creditSystem: "agent-credits",
});`,
  },
  {
    slug: "pay-as-you-go-api",
    title: "Pay As You Go API",
    shortTitle: "Pay as you go",
    eyebrow: "Pure postpaid usage",
    inspiredBy: "Usage-first API billing",
    summary: "Pay only for actual usage with no base fee.",
    headline: "Pure usage-based billing.",
    description:
      "Zero upfront cost. Charges based on actual consumption with spend caps for protection.",
    category: "Usage-based",
    accent: "blue",
    tags: ["pay-as-you-go", "zero-upfront", "developer-first"],
    highlights: [
      "no upfront cost",
      "no monthly commitment",
      "spend cap protection",
    ],
    whyItWorks:
      "Removes adoption friction by eliminating upfront costs. Scales naturally with usage. Spend caps prevent unexpected bills while maintaining flexibility.",
    breakdown: [
      { label: "Usage model", value: "usage_based" },
      { label: "Rating model", value: "package" },
      { label: "Example rate", value: "$0.002 / request" },
    ],
    rules: [
      "An active payment method must exist before billable usage is allowed.",
      "Projected post-event usage is what spend-cap checks evaluate.",
      "Invoices should show usage, billable quantity, and final amount explicitly.",
    ],
    builderSnippet: `const requests = metered("requests", {
  name: "Requests",
});

plan("api", {
  name: "API",
  price: 0,
  currency: "USD",
  interval: "monthly",
  features: [requests.perUnit(0.2, { reset: "monthly" })],
});`,
  },
  {
    slug: "included-package-overage",
    title: "Included Units With Package Overage",
    shortTitle: "Package overage",
    eyebrow: "Classic SaaS overage",
    inspiredBy: "Stripe-style metered overage",
    summary: "Included units with block-based overage pricing.",
    headline: "Simple overage in fixed blocks.",
    description:
      "Monthly plan includes base units. Additional usage is charged in fixed-size packages.",
    category: "Included + overage",
    accent: "amber",
    tags: ["simple-math", "human-readable", "clean-bills"],
    highlights: [
      "included monthly units",
      "block-based overage",
      "readable invoices",
    ],
    whyItWorks:
      "Package-based overage keeps invoices clean and understandable. Customers see clear unit blocks instead of fractional pricing. Bridges free tier and scaling needs.",
    breakdown: [
      { label: "Included", value: "10,000 API calls" },
      { label: "Overage rate", value: "$5 / 1,000 calls" },
      { label: "Tier basis", value: "Billable usage only" },
    ],
    rules: [
      "Billable usage starts only after the included grant is exhausted.",
      "Package math applies to the billable remainder, not total usage.",
      "Spend caps still matter if overage is chargeable.",
    ],
    builderSnippet: `const apiCalls = metered("api-calls", {
  name: "API Calls",
});

plan("pro", {
  name: "Pro",
  price: 4900,
  currency: "USD",
  interval: "monthly",
  features: [
    apiCalls.config({
      usageModel: "included",
      limit: 10_000,
      overage: "charge",
      ratingModel: "package",
      pricePerUnit: 500,
      billingUnits: 1_000,
      reset: "monthly",
    }),
  ],
});`,
  },
  {
    slug: "graduated-api-pricing",
    title: "Graduated API Pricing",
    shortTitle: "Graduated pricing",
    eyebrow: "Tiered unit economics",
    inspiredBy: "AWS-style graduated tiers",
    summary: "Each usage band has its own price.",
    headline: "Stacked tier pricing.",
    description:
      "Different price per unit across usage tiers. Higher volume gets lower per-unit rates, but each tier only prices the usage inside its own band.",
    category: "Tiered usage",
    accent: "teal",
    tags: ["bulk-discounts", "fair-pricing", "reward-growth"],
    highlights: [
      "lower rates at scale",
      "clear tier structure",
      "rewards growth",
    ],
    whyItWorks:
      "Aligns pricing with customer growth. Unit economics improve at scale, reducing churn risk from high-volume users. Each tier applies its own rate to usage within that range.",
    breakdown: [
      { label: "Tier 1", value: "First 100k at $2.00" },
      { label: "Tier 2", value: "Next 400k at $1.60" },
      { label: "Tier 3", value: "Beyond at $1.20" },
    ],
    rules: [
      "For included plans, graduated tiers start at billable usage, not total usage.",
      "Every invoice should include one row per used tier.",
      "A tier flat fee only applies if that tier is actually entered.",
    ],
    builderSnippet: `const tokens = metered("tokens", {
  name: "Tokens",
});

plan("scale", {
  name: "Scale",
  price: 0,
  currency: "USD",
  interval: "monthly",
  features: [
    tokens.graduated(
      [
        { upTo: 100_000, unitPrice: 200 },
        { upTo: 500_000, unitPrice: 160 },
        { upTo: null, unitPrice: 120 },
      ],
      { reset: "monthly" },
    ),
  ],
});`,
  },
  {
    slug: "volume-api-pricing",
    title: "Volume API Pricing",
    shortTitle: "Volume pricing",
    eyebrow: "Single reached-tier price",
    inspiredBy: "Cloud data platform pricing",
    summary: "One reached tier prices all billable usage.",
    headline: "Tier-based bulk pricing.",
    description:
      "All usage is priced at the rate of the highest tier reached. Crossing thresholds reduces the price for all units.",
    category: "Tiered usage",
    accent: "blue",
    tags: ["carrot", "thresholds", "bulk"],
    highlights: [
      "single rate for all units",
      "strong scaling incentive",
      "simple to explain",
    ],
    whyItWorks:
      "Creates strong incentive to reach higher tiers. All usage reprices when crossing thresholds. Simple for finance teams to model and forecast.",
    breakdown: [
      { label: "Up to 100k", value: "$2.00 / unit" },
      { label: "Up to 500k", value: "$1.50 / unit" },
      { label: "Beyond", value: "$1.10 / unit" },
    ],
    rules: [
      "For included plans, volume tiers evaluate the billable remainder only.",
      "Invoices should highlight the reached tier and final applied unit price.",
      "Use this only when repricing all billable usage is expected behavior.",
    ],
    builderSnippet: `const inferenceOps = metered("inference-ops", {
  name: "Inference Ops",
});

plan("enterprise-api", {
  name: "Enterprise API",
  price: 0,
  currency: "USD",
  interval: "monthly",
  features: [
    inferenceOps.volume(
      [
        { upTo: 100_000, unitPrice: 200 },
        { upTo: 500_000, unitPrice: 150 },
        { upTo: null, unitPrice: 110 },
      ],
      { reset: "monthly" },
    ),
  ],
});`,
  },
  {
    slug: "per-seat-billing",
    title: "Per Seat Billing",
    shortTitle: "Per seat",
    eyebrow: "Collaborative software",
    inspiredBy: "Slack-style seat pricing",
    summary: "Charge per active user on the account.",
    headline: "User-based pricing.",
    description:
      "Price scales with team size. Each active user incurs a fixed monthly charge.",
    category: "Seats",
    accent: "rose",
    tags: ["b2b", "teams", "straightforward"],
    highlights: [
      "price per user",
      "no usage tracking",
      "predictable billing",
    ],
    whyItWorks:
      "Revenue scales naturally with team growth. Simple to understand and forecast. No complex usage metering required.",
    breakdown: [
      { label: "Base", value: "$18 / active seat" },
      { label: "Reset", value: "Monthly" },
      { label: "Metering", value: "Entity-based" },
    ],
    rules: [
      "Seat removal and seat activation need predictable lifecycle rules.",
      "Invoices should state active seat count clearly.",
      "Seats should use entity lifecycle methods like add/remove, not track().",
    ],
    builderSnippet: `const seats = entity("seats", {
  name: "Seats",
});

plan("team", {
  name: "Team",
  price: 0,
  currency: "USD",
  interval: "monthly",
  features: [seats.limit(5, { overage: "block" })],
});`,
  },
  {
    slug: "seats-plus-usage",
    title: "Seats Plus Metered Usage",
    shortTitle: "Seats + usage",
    eyebrow: "Hybrid B2B pricing",
    inspiredBy: "Figma plus AI credits",
    summary: "Per-seat base with metered compute charges.",
    headline: "Hybrid seat and usage billing.",
    description:
      "Team seats provide base revenue. Compute-intensive features are metered separately.",
    category: "Hybrid",
    accent: "amber",
    tags: ["hybrid", "ai-ready", "modern-saas"],
    highlights: [
      "stable seat revenue",
      "elastic compute billing",
      "cost-aligned pricing",
    ],
    whyItWorks:
      "Separates team access costs from compute costs. Keeps base pricing predictable while protecting margins on expensive operations. Common for AI-powered features.",
    breakdown: [
      { label: "Seats", value: "$24 / seat / month" },
      { label: "Included AI ops", value: "2,000 / workspace" },
      { label: "Overage", value: "Graduated after allowance" },
    ],
    rules: [
      "Keep seat charges and metered charges as distinct invoice sections.",
      "Included AI allowance should apply before graduated overage math begins.",
      "Seats should be managed through entity lifecycle methods while AI usage stays metered.",
    ],
    builderSnippet: `const seats = entity("seats", {
  name: "Seats",
});

const aiRuns = metered("ai-runs", {
  name: "AI Runs",
});

plan("collab-ai", {
  name: "Collab AI",
  price: 0,
  currency: "USD",
  interval: "monthly",
  features: [
    seats.limit(10, { overage: "block" }),
    aiRuns.config({
      usageModel: "included",
      limit: 2_000,
      overage: "charge",
      ratingModel: "graduated",
      tiers: [
        { upTo: 10_000, unitPrice: 0.9 },
        { upTo: null, unitPrice: 0.7 },
      ],
      reset: "monthly",
    }),
  ],
});`,
  },
];

export function getPricingTemplates() {
  return pricingTemplates;
}

export function getPricingTemplateBySlug(slug: string) {
  return pricingTemplates.find((template) => template.slug === slug);
}
