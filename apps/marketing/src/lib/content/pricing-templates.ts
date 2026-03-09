export type PricingTemplateAccent = "amber" | "teal" | "blue" | "rose";
export const PRICING_TEMPLATES_LAST_VERIFIED_AT = "2026-03-09";

export type PricingTemplate = {
  slug: string;
  title: string;
  shortTitle: string;
  eyebrow: string;
  inspiredBy: string;
  logoUrl: string;
  pricingUrl: string;
  summary: string;
  headline: string;
  description: string;
  category: string;
  accent: PricingTemplateAccent;
  tags: string[];
  highlights: string[];
  socialProof: string;
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
    inspiredBy: "Basecamp",
    logoUrl:
      "https://cdn.brandfetch.io/domain/basecamp.com?c=1iduQCu8CNcitTrpDvi",
    pricingUrl: "https://basecamp.com/pricing/",
    summary:
      "Basecamp's current pricing page offers Free, Plus, and Pro Unlimited tiers.",
    headline: "Pro Unlimited is $299/month billed annually, or $349 monthly.",
    description:
      "The fixed-price snapshot here is Basecamp's Pro Unlimited tier: one org-wide price, unlimited projects, and no per-user billing.",
    category: "Vendor snapshot",
    accent: "amber",
    tags: ["snapshot", "fixed-price", "org-wide"],
    highlights: [
      "$299/month billed annually",
      "no per-user charges",
      "unlimited projects",
    ],
    socialProof: "Verified against official pricing page",
    whyItWorks:
      "This is a clean example of a self-serve fixed-price org plan sitting above a free tier and a per-user tier.",
    breakdown: [
      { label: "Free", value: "One project at a time" },
      { label: "Plus", value: "$15 / user / month" },
      { label: "Pro Unlimited", value: "$299 / month billed annually" },
    ],
    rules: [
      "Basecamp currently sells three plans: Free, Plus, and Pro Unlimited.",
      "Pro Unlimited is the fixed org-wide tier, not a seat-based tier.",
      "The public page also offers a $349 month-to-month option for Pro Unlimited.",
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
    inspiredBy: "Notion",
    logoUrl: "https://cdn.brandfetch.io/domain/notion.so?c=1iduQCu8CNcitTrpDvi",
    pricingUrl: "https://www.notion.com/pricing",
    summary:
      "Notion's live pricing is seat-based across Free, Plus, Business, and Enterprise tiers.",
    headline: "Plus starts at $10/member/month; Business starts at $20/member/month.",
    description:
      "This is not an included-usage quota product today. The official pricing page is organized around per-member collaboration plans.",
    category: "Vendor snapshot",
    accent: "teal",
    tags: ["snapshot", "seat-based", "collaboration"],
    highlights: [
      "free starter tier",
      "per-member pricing",
      "enterprise upgrade path",
    ],
    socialProof: "Verified against official pricing page",
    whyItWorks:
      "The pricing ladder is straightforward: free entry, then predictable per-seat expansion as teams need more governance and features.",
    breakdown: [
      { label: "Free", value: "$0" },
      { label: "Plus", value: "$10 / member / month" },
      { label: "Business", value: "$20 / member / month" },
    ],
    rules: [
      "Notion's public pricing is per member, not quota-based metering.",
      "Annual billing can reduce the effective seat price.",
      "Enterprise pricing is custom.",
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
    slug: "openai-codex-rate-window-credits",
    title: "Rate Window + Credits Fallback",
    shortTitle: "OpenAI Codex",
    eyebrow: "Burst quota with credit fallback",
    inspiredBy: "OpenAI Codex",
    logoUrl:
      "https://cdn.brandfetch.io/domain/openai.com?c=1iduQCu8CNcitTrpDvi",
    pricingUrl: "https://developers.openai.com/codex/pricing/",
    summary:
      "Codex is currently packaged through ChatGPT plans, with higher limits on paid tiers.",
    headline: "Free and Go have limited access; paid plans raise limits and credits.",
    description:
      "The public pricing is plan-based rather than a single standalone Codex SKU. OpenAI also notes that Free and Go access is temporary.",
    category: "Vendor snapshot",
    accent: "blue",
    tags: ["snapshot", "plan-based", "credits"],
    highlights: [
      "short reset windows",
      "credit fallback layer",
      "no hard failures",
    ],
    socialProof: "Verified against official pricing page",
    whyItWorks:
      "Codex access is now a tiered plan benefit rather than a standalone line item, with credits and limits expanding as the plan level increases.",
    breakdown: [
      { label: "Free & Go", value: "Limited-time access" },
      { label: "Paid plans", value: "Higher limits and credits" },
      { label: "Top-ups", value: "Additional credits available" },
    ],
    rules: [
      "OpenAI presents Codex as part of ChatGPT plan packaging.",
      "Free and Go access is temporary on the public page.",
      "The Owostack snippet below is the closest code-first approximation of that plan-plus-credits model.",
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
  autoEnable: true,
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
    inspiredBy: "AWS Lambda",
    logoUrl:
      "https://upload.wikimedia.org/wikipedia/commons/9/93/Amazon_Web_Services_Logo.svg",
    pricingUrl: "https://aws.amazon.com/lambda/pricing/",
    summary:
      "Lambda is priced on requests and compute duration, with a permanent monthly free tier.",
    headline: "1M free requests and 400,000 GB-seconds each month.",
    description:
      "After the free tier, the public page prices requests separately from GB-second compute usage.",
    category: "Vendor snapshot",
    accent: "blue",
    tags: ["pay-as-you-go", "zero-upfront", "developer-first"],
    highlights: [
      "no upfront cost",
      "no monthly commitment",
      "spend cap protection",
    ],
    socialProof: "Verified against official pricing page",
    whyItWorks:
      "Lambda is a classic infrastructure usage model: no commit required, two billable meters, and a generous free tier to smooth adoption.",
    breakdown: [
      { label: "Free tier", value: "1M requests + 400k GB-seconds" },
      { label: "Requests", value: "$0.20 / 1M requests" },
      { label: "Compute", value: "$16.67 / 1M GB-seconds" },
    ],
    rules: [
      "Requests and compute are billed separately after the free tier.",
      "The public rate is published per GB-second for compute.",
      "The code sample focuses on one meter, but the live product prices two meters.",
    ],
    builderSnippet: `const requests = metered("requests", {
  name: "Requests",
});

plan("api", {
  name: "API",
  price: 0,
  currency: "USD",
  interval: "monthly",
  features: [
    requests.config({
      usageModel: "usage_based",
      pricePerUnit: 20,
      billingUnits: 100,
      reset: "monthly",
    }),
  ],
});`,
  },
  {
    slug: "included-package-overage",
    title: "Included Units With Package Overage",
    shortTitle: "Package overage",
    eyebrow: "Classic SaaS overage",
    inspiredBy: "Stripe",
    logoUrl:
      "https://cdn.brandfetch.io/domain/stripe.com?c=1iduQCu8CNcitTrpDvi",
    pricingUrl: "https://stripe.com/billing/pricing",
    summary:
      "Stripe Billing is priced as billing software, based on billing volume rather than request blocks.",
    headline: "Pay-as-you-go is 0.7% of billing volume; contracted starts from $620/month.",
    description:
      "The official pricing page does not present Stripe Billing as included API units plus overage. It is volume-based software pricing.",
    category: "Vendor snapshot",
    accent: "amber",
    tags: ["simple-math", "human-readable", "clean-bills"],
    highlights: [
      "0.7% pay-as-you-go",
      "contract option from $620/month",
      "software fee tied to billing volume",
    ],
    socialProof: "Verified against official pricing page",
    whyItWorks:
      "This pricing aligns Stripe's fee with the amount of revenue you bill through the product rather than with API call counts.",
    breakdown: [
      { label: "PAYG", value: "0.7% of billing volume" },
      { label: "Contract", value: "From $620 / month" },
      { label: "Billing mode", value: "Software fee on billed revenue" },
    ],
    rules: [
      "The public pricing is based on billing volume, not API request blocks.",
      "Annual contracted pricing starts from $620/month paid monthly.",
      "The code sample below models the 0.7% pay-as-you-go fee as the closest Owostack approximation.",
    ],
    builderSnippet: `const apiCalls = metered("api-calls", {
  name: "Billing Volume (cents)",
});

plan("billing-payg", {
  name: "Billing PAYG",
  price: 0,
  currency: "USD",
  interval: "monthly",
  features: [
    apiCalls.config({
      usageModel: "usage_based",
      pricePerUnit: 70,
      billingUnits: 10_000,
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
    inspiredBy: "AWS S3",
    logoUrl:
      "https://upload.wikimedia.org/wikipedia/commons/9/93/Amazon_Web_Services_Logo.svg",
    pricingUrl: "https://aws.amazon.com/s3/pricing/",
    summary:
      "S3 pricing varies by storage class, request type, and data transfer rather than a simple public tier ladder.",
    headline: "Storage class first, then request and transfer charges on top.",
    description:
      "The public pricing page mixes storage, request, and transfer dimensions. It is not presented as a three-band graduated API plan.",
    category: "Vendor snapshot",
    accent: "teal",
    tags: ["bulk-discounts", "fair-pricing", "reward-growth"],
    highlights: [
      "storage-class pricing",
      "request charges",
      "transfer-dependent costs",
    ],
    socialProof: "Verified against official pricing page",
    whyItWorks:
      "S3 is a multi-axis infrastructure bill: which storage class you choose matters just as much as how many requests you send.",
    breakdown: [
      { label: "Storage", value: "Varies by storage class" },
      { label: "GET requests", value: "From $0.0004 / 1,000" },
      { label: "Lifecycle transitions", value: "$0.01 / 1,000" },
    ],
    rules: [
      "Storage class selection changes the storage economics.",
      "Request charges vary by operation type.",
      "The code sample below remains an Owostack approximation, not a literal copy of S3's public page.",
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
    title: "Edition-Based Consumption",
    shortTitle: "Snowflake editions",
    eyebrow: "Edition-first data platform pricing",
    inspiredBy: "Snowflake",
    logoUrl: "https://cdn.brandfetch.io/idJz-fGD_q/w/400/h/400/theme/dark/icon.png?c=1bxid64Mup7aczewSAYMX&t=1667589077114",
    pricingUrl: "https://www.snowflake.com/en/pricing-options//",
    summary:
      "Snowflake sells editions and consumption models rather than a simple public volume ladder.",
    headline: "Standard, Enterprise, Business Critical, and VPS editions.",
    description:
      "The official pricing page emphasizes edition selection plus on-demand or prepaid capacity. Public threshold pricing is not the primary story.",
    category: "Vendor snapshot",
    accent: "blue",
    tags: ["carrot", "thresholds", "bulk"],
    highlights: [
      "edition-based packaging",
      "on-demand or prepaid capacity",
      "usage-based compute and storage",
    ],
    socialProof: "Verified against official pricing page",
    whyItWorks:
      "Snowflake's model is designed around enterprise packaging and consumption commitments, not around a public all-units discount table.",
    breakdown: [
      { label: "Editions", value: "Standard to VPS" },
      { label: "Capacity", value: "On-demand or prepaid" },
      { label: "Billing model", value: "Consumption-based" },
    ],
    rules: [
      "Snowflake's public page is edition-led, not threshold-led.",
      "Capacity can be purchased on-demand or pre-paid.",
      "The code sample remains a simplified Owostack approximation of usage-based enterprise pricing.",
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
    inspiredBy: "Slack",
    logoUrl: "https://cdn.brandfetch.io/domain/slack.com?c=1iduQCu8CNcitTrpDvi",
    pricingUrl: "https://slack.com/pricing/pro",
    summary: "Slack is priced per user across Pro, Business+, and Enterprise Grid.",
    headline: "Pro starts at $8.75/user/month or $7.25 billed annually.",
    description:
      "The current pricing page is seat-based. The number in the old template was too high for today's public Pro plan.",
    category: "Vendor snapshot",
    accent: "rose",
    tags: ["b2b", "teams", "straightforward"],
    highlights: ["price per user", "no usage tracking", "predictable billing"],
    socialProof: "Verified against official pricing page",
    whyItWorks:
      "Slack's public pricing is a straightforward collaboration seat ladder with a discount for annual billing.",
    breakdown: [
      { label: "Pro monthly", value: "$8.75 / user / month" },
      { label: "Pro annual", value: "$7.25 / user / month" },
      { label: "Higher tiers", value: "Business+ and Enterprise Grid" },
    ],
    rules: [
      "Slack's public pricing is explicitly per-user.",
      "Annual billing lowers the effective monthly seat price.",
      "The Owostack snippet below models the seat-based shape, not Slack's entire packaging matrix.",
    ],
    builderSnippet: `const seats = entity("seats", {
  name: "Seats",
});

plan("team", {
  name: "Team",
  price: 0,
  autoEnable: true,
  currency: "USD",
  interval: "monthly",
  features: [seats.limit(5, { overage: "block" })],
});`,
  },
  {
    slug: "clerk-mau-pricing",
    title: "Monthly Active User Pricing",
    shortTitle: "MAU pricing",
    eyebrow: "Auth infrastructure",
    inspiredBy: "Clerk",
    logoUrl: "https://cdn.brandfetch.io/clerk.com/",
    pricingUrl: "https://clerk.com/pricing",
    summary:
      "Clerk's pricing starts with a free Hobby tier and moves to Pro with included usage plus overage.",
    headline: "Pro starts at $20/month billed annually with 50,000 included users.",
    description:
      "The current page is usage-based around active/retained users and add-ons, rather than a generic flat $25 MAU tier.",
    category: "Vendor snapshot",
    accent: "rose",
    tags: ["b2b", "growth-friendly", "usage-based"],
    highlights: [
      "50K included users",
      "$0.02 per additional user",
      "paid add-ons for SMS and more",
    ],
    socialProof: "Verified against official pricing page",
    whyItWorks:
      "Clerk combines a generous included user allowance with predictable overage and optional add-ons.",
    breakdown: [
      { label: "Hobby", value: "$0" },
      { label: "Pro", value: "$20 / month billed annually" },
      { label: "Overage", value: "$0.02 / additional user" },
    ],
    rules: [
      "The public page includes 50,000 users before overage on Pro.",
      "Clerk's pricing page also lists add-ons such as SMS.",
      "The old $25/month figure was only one billing presentation, not the clearest current snapshot.",
    ],
    builderSnippet: `const mau = metered("mau", {
  name: "Monthly Active Users",
});

plan("pro", {
  name: "Pro",
  price: 2500,
  currency: "USD",
  interval: "monthly",
  features: [
    mau.config({
      usageModel: "included",
      limit: 50_000,
      overage: "charge",
      pricePerUnit: 2,
      billingUnits: 1,
      reset: "monthly",
    }),
  ],
});`,
  },
  {
    slug: "seats-plus-usage",
    title: "Seats Plus Metered Usage",
    shortTitle: "Seats + usage",
    eyebrow: "Hybrid B2B pricing",
    inspiredBy: "Figma",
    logoUrl: "https://cdn.brandfetch.io/domain/figma.com?c=1iduQCu8CNcitTrpDvi",
    pricingUrl: "https://www.figma.com/pricing/",
    summary:
      "Figma's public pricing is role- and seat-based first, with AI features layered into the plans.",
    headline: "Starter, Professional, Organization, and Enterprise plans.",
    description:
      "The live pricing page does not present Figma as a plain metered AI-ops bill. Seats and plan roles are still the core packaging unit.",
    category: "Vendor snapshot",
    accent: "amber",
    tags: ["hybrid", "ai-ready", "modern-saas"],
    highlights: [
      "seat and role pricing",
      "AI bundled into plans",
      "enterprise governance tiers",
    ],
    socialProof: "Verified against official pricing page",
    whyItWorks:
      "Figma is still primarily sold as collaboration seats, but AI packaging is now a visible layer inside those plans.",
    breakdown: [
      { label: "Starter", value: "Free" },
      { label: "Professional", value: "Seat-based pricing" },
      { label: "Org/Enterprise", value: "Admin and governance upgrades" },
    ],
    rules: [
      "Figma's public pricing is still seat-led.",
      "AI appears inside the plan packaging, not as a public standalone compute meter.",
      "The snippet below is an Owostack adaptation of that seat-plus-AI shape.",
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
        { upTo: 10_000, unitPrice: 90 },
        { upTo: null, unitPrice: 70 },
      ],
      reset: "monthly",
    }),
  ],
});`,
  },
  {
    slug: "pinecone-minimum-usage",
    title: "Minimum Usage Commitment",
    shortTitle: "Minimum commitment",
    eyebrow: "Vector database pricing",
    inspiredBy: "Pinecone",
    logoUrl: "https://cdn.brandfetch.io/idCLuo1dQ8/w/178/h/178/theme/dark/icon.png?c=1bxid64Mup7aczewSAYMX&t=1718349235873",
    pricingUrl: "https://www.pinecone.io/pricing/",
    summary: "$50/month minimum commitment, then pay-as-you-go beyond.",
    headline: "Commitment-based minimums.",
    description:
      "Requires a minimum monthly spend. Usage up to that point is included; beyond that, standard rates apply.",
    category: "Usage-based",
    accent: "teal",
    tags: ["commitment", "predictable-minimum", "enterprise"],
    highlights: [
      "$50/month minimum",
      "guaranteed revenue floor",
      "scales beyond minimum",
    ],
    socialProof: "$100M+ ARR vector database",
    whyItWorks:
      "Creates revenue predictability while allowing natural scaling. Minimum commitment aligns customer intent with resource allocation. Common for infrastructure products.",
    breakdown: [
      { label: "Minimum", value: "$50 / month" },
      { label: "Standard plan", value: "$0.33/GB + $4-24/M units" },
      { label: "Enterprise", value: "$500 / month minimum" },
    ],
    rules: [
      "Customer is charged the minimum even if usage is lower.",
      "Usage above minimum is charged at standard rates.",
      "Minimum commitments typically come with annual contracts.",
    ],
    builderSnippet: `const storage = metered("storage", {
  name: "Storage",
});

const readOps = metered("read-ops", {
  name: "Read Operations",
});

plan("standard", {
  name: "Standard",
  price: 5000,
  currency: "USD",
  interval: "monthly",
  features: [
    storage.config({
      usageModel: "usage_based",
      pricePerUnit: 33,
      billingUnits: 100,
      reset: "monthly",
    }),
    readOps.config({
      usageModel: "usage_based",
      pricePerUnit: 16,
      billingUnits: 1_000_000,
      reset: "monthly",
    }),
  ],
});`,
  },
  {
    slug: "resend-volume-tiers",
    title: "Volume Tier Pricing",
    shortTitle: "Volume tiers",
    eyebrow: "Email infrastructure",
    inspiredBy: "Resend",
    logoUrl: "https://cdn.brandfetch.io/resend.com/",
    pricingUrl: "https://resend.com/pricing",
    summary: "Clear volume tiers with generous free tier.",
    headline: "Scale through clear tiers.",
    description:
      "Generous free tier (3K emails), then clear volume-based tiers. Pro at 50K emails, Scale at 100K emails.",
    category: "Subscription + quota",
    accent: "amber",
    tags: ["clear-tiers", "volume-discount", "email-saas"],
    highlights: [
      "3K emails free",
      "clear tier breakpoints",
      "volume-based pricing",
    ],
    socialProof: "Used by Warner Bros, eBay, Replit",
    whyItWorks:
      "Clear tier breakpoints make pricing predictable. Free tier removes adoption friction. Volume-based pricing rewards growth with better unit economics.",
    breakdown: [
      { label: "Free", value: "3,000 emails" },
      { label: "Pro", value: "$20 / 50,000 emails" },
      { label: "Scale", value: "$90 / 100,000 emails" },
    ],
    rules: [
      "Tiers are based on total monthly volume.",
      "Each tier includes a specific email allowance.",
      "Overage is charged per 1,000 emails beyond tier limit.",
    ],
    builderSnippet: `const emails = metered("emails", {
  name: "Emails",
});

plan("pro", {
  name: "Pro",
  price: 2000,
  currency: "USD",
  interval: "monthly",
  features: [
    emails.config({
      usageModel: "included",
      limit: 50_000,
      overage: "charge",
      pricePerUnit: 90,
      billingUnits: 1_000,
      reset: "monthly",
    }),
  ],
});

plan("scale", {
  name: "Scale",
  price: 9000,
  currency: "USD",
  interval: "monthly",
  features: [
    emails.config({
      usageModel: "included",
      limit: 100_000,
      overage: "charge",
      pricePerUnit: 90,
      billingUnits: 1_000,
      reset: "monthly",
    }),
  ],
});`,
  },
  {
    slug: "replicate-gpu-pricing",
    title: "GPU Hardware Tier Pricing",
    shortTitle: "GPU tiers",
    eyebrow: "AI inference billing",
    inspiredBy: "Replicate",
    logoUrl: "https://cdn.brandfetch.io/replicate.com/",
    pricingUrl: "https://replicate.com/pricing",
    summary: "Per-second billing based on GPU hardware tier.",
    headline: "Pay for compute time by hardware.",
    description:
      "Different GPU tiers (T4, A100, H100) with per-second billing. You pay only for the time your model is running.",
    category: "Usage-based",
    accent: "blue",
    tags: ["per-second", "gpu-tiers", "ai-inference"],
    highlights: [
      "per-second billing",
      "hardware-based tiers",
      "no idle charges",
    ],
    socialProof: "25K+ models, 1B+ predictions",
    whyItWorks:
      "Aligns cost with actual compute resources used. Hardware tiers let customers optimize for speed vs cost. Per-second billing ensures fair pricing for short inference jobs.",
    breakdown: [
      { label: "T4 GPU", value: "$0.000225/sec ($0.81/hr)" },
      { label: "A100 GPU", value: "$0.0014/sec ($5.04/hr)" },
      { label: "H100 GPU", value: "$0.001525/sec ($5.49/hr)" },
    ],
    rules: [
      "Billing starts when inference begins, ends when complete.",
      "Different models can run on different GPU tiers.",
      "Per-second granularity ensures fair pricing.",
    ],
    builderSnippet: `const t4Seconds = metered("t4-seconds", {
  name: "T4 Inference Seconds",
});

const a100Seconds = metered("a100-seconds", {
  name: "A100 Inference Seconds",
});

plan("inference", {
  name: "Inference",
  price: 0,
  currency: "USD",
  interval: "monthly",
  features: [
    t4Seconds.config({
      usageModel: "usage_based",
      pricePerUnit: 81,
      billingUnits: 3600,
      reset: "monthly",
    }),
    a100Seconds.config({
      usageModel: "usage_based",
      pricePerUnit: 504,
      billingUnits: 3600,
      reset: "monthly",
    }),
  ],
});`,
  },
  {
    slug: "cursor-credit-tiers",
    title: "Tiered Request Limits",
    shortTitle: "Request tiers",
    eyebrow: "AI coding assistant",
    inspiredBy: "Cursor",
    logoUrl: "https://cdn.brandfetch.io/cursor.com/",
    pricingUrl: "https://cursor.com/pricing",
    summary: "Free tier with request limits, paid tiers with higher limits.",
    headline: "Usage-based request tiers.",
    description:
      "Free tier with limited requests. Pro tier ($20) extends limits. Pro+ ($60) gives 3x usage. Ultra ($200) gives 20x usage.",
    category: "Subscription + quota",
    accent: "rose",
    tags: ["request-limits", "tiered-usage", "ai-tools"],
    highlights: [
      "clear request limits",
      "tiered by usage needs",
      "no surprises",
    ],
    socialProof: "Fastest growing dev tool",
    whyItWorks:
      "Clear usage limits prevent abuse while letting power users pay for more. Tiered structure aligns with different user needs. Predictable costs at each tier.",
    breakdown: [
      { label: "Hobby", value: "Limited requests" },
      { label: "Pro", value: "$20/mo - Extended limits" },
      { label: "Pro+", value: "$60/mo - 3x usage" },
    ],
    rules: [
      "Request limits reset monthly.",
      "Each tier has clearly defined usage limits.",
      "Users can upgrade/downgrade between tiers.",
    ],
    builderSnippet: `const requests = metered("requests", {
  name: "Requests",
});

plan("hobby", {
  name: "Hobby",
  price: 0,
  autoEnable: true,
  currency: "USD",
  interval: "monthly",
  features: [
    requests.config({
      usageModel: "included",
      limit: 500,
      overage: "block",
      reset: "monthly",
    }),
  ],
});

plan("pro", {
  name: "Pro",
  price: 2000,
  currency: "USD",
  interval: "monthly",
  features: [
    requests.config({
      usageModel: "included",
      limit: 5_000,
      overage: "charge",
      pricePerUnit: 10,
      billingUnits: 100,
      reset: "monthly",
    }),
  ],
});`,
  },
  {
    slug: "replit-builder-credits",
    title: "Builder Plan With Included Credits",
    shortTitle: "Replit credits",
    eyebrow: "AI builder platform",
    inspiredBy: "Replit",
    logoUrl: "https://cdn.brandfetch.io/replit.com/",
    pricingUrl: "https://replit.com/pricing",
    summary:
      "Replit currently packages plans around included monthly credits, collaborator limits, and higher-capability AI access.",
    headline: "Core is $20/month billed annually with $25 monthly credits and up to 5 collaborators.",
    description:
      "The live pricing page combines a subscription tier with bundled usage credits, collaborator limits, and optional pay-as-you-go once the included credits are exhausted.",
    category: "Vendor snapshot",
    accent: "blue",
    tags: ["snapshot", "credits", "collaboration"],
    highlights: [
      "$25 monthly credits on Core",
      "up to 5 collaborators on Core",
      "higher limits on Pro",
    ],
    socialProof: "Verified against official pricing page",
    whyItWorks:
      "Replit uses the plan fee to package access, collaboration, and included AI spend together, then expands both credits and team limits on higher tiers.",
    breakdown: [
      { label: "Starter", value: "Free daily Agent credits" },
      { label: "Core", value: "$20 / month billed annually + $25 credits" },
      { label: "Pro", value: "$100 credits + up to 15 collaborators" },
    ],
    rules: [
      "Replit's pricing page is plan-led, with monthly credits bundled into paid tiers.",
      "Core currently includes up to 5 collaborators; Pro includes up to 15 collaborators and 50 viewers.",
      "The Owostack snippet below models the bundled-credit structure and collaborator caps, not every product entitlement on the page.",
    ],
    builderSnippet: `const collaborators = entity("collaborators", {
  name: "Collaborators",
});

const agentRuns = metered("agent-runs", {
  name: "Agent Runs",
});

const agentCredits = creditSystem("agent-credits", {
  name: "Agent Credits",
  features: [agentRuns(1)],
});

plan("core", {
  name: "Core",
  price: 2000,
  currency: "USD",
  interval: "monthly",
  features: [
    collaborators.limit(5, { overage: "block" }),
    agentCredits.credits(2_500, { reset: "monthly" }),
  ],
});

plan("pro", {
  name: "Pro",
  price: 10000,
  currency: "USD",
  interval: "monthly",
  features: [
    collaborators.limit(15, { overage: "block" }),
    agentCredits.credits(10_000, { reset: "monthly" }),
  ],
});

creditPack("agent-credit-topup", {
  name: "Agent Credit Top-up",
  price: 10000,
  currency: "USD",
  credits: 10_000,
  creditSystem: "agent-credits",
});`,
  },
];

export function getPricingTemplates() {
  return pricingTemplates;
}

export function getPricingTemplateBySlug(slug: string) {
  return pricingTemplates.find((template) => template.slug === slug);
}
