import pc from "picocolors";
import * as p from "@clack/prompts";

function normalizeReset(reset: string | null | undefined): string {
  switch (reset) {
    case "hour":
      return "hourly";
    case "day":
      return "daily";
    case "week":
      return "weekly";
    case "month":
      return "monthly";
    case "quarter":
      return "quarterly";
    case "year":
    case "annually":
      return "yearly";
    default:
      return reset || "monthly";
  }
}

function normalizeOverage(
  usageModel: string | null | undefined,
  overage: string | null | undefined,
): "block" | "charge" {
  if (usageModel === "usage_based") return "charge";
  return overage === "charge" ? "charge" : "block";
}

function normalizeMetadata(value: unknown): string | null {
  if (value == null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeFeature(
  pf: any,
  creditSystemSlugs: Set<string>,
  featureDefs: Map<string, any>,
) {
  const def = featureDefs.get(pf.slug) || {};
  const usageModel = pf.usageModel || "included";
  const isCreditSystemFeature = creditSystemSlugs.has(pf.slug);
  const type = pf.type ?? def.type ?? null;

  return {
    slug: pf.slug,
    name: pf.name ?? def.name ?? null,
    type,
    meterType:
      type === "boolean"
        ? null
        : (pf.meterType ?? def.meterType ?? "consumable"),
    enabled: pf.enabled,
    limit: pf.limit ?? null,
    trialLimit: pf.trialLimit ?? null,
    // Handle both SDK 'reset' and API 'resetInterval'
    reset: normalizeReset(pf.reset || pf.resetInterval),
    usageModel: isCreditSystemFeature ? "included" : usageModel,
    pricePerUnit: isCreditSystemFeature ? null : (pf.pricePerUnit ?? null),
    billingUnits: isCreditSystemFeature ? 1 : (pf.billingUnits ?? 1),
    ratingModel: isCreditSystemFeature
      ? "package"
      : pf.ratingModel || "package",
    tiers: isCreditSystemFeature ? null : (pf.tiers ?? null),
    // Handle both SDK 'overage' and API 'overage' (same name)
    overage: normalizeOverage(usageModel, pf.overage),
    overagePrice: isCreditSystemFeature ? null : (pf.overagePrice ?? null),
    maxOverageUnits: isCreditSystemFeature
      ? null
      : (pf.maxOverageUnits ?? null),
    creditCost: isCreditSystemFeature ? 0 : (pf.creditCost ?? 0),
  };
}

function normalizePlan(
  plan: any,
  creditSystemSlugs: Set<string>,
  featureDefs: Map<string, any>,
) {
  return {
    slug: plan.slug,
    name: plan.name ?? null,
    description: plan.description ?? null,
    price: plan.price ?? 0,
    currency: plan.currency ?? null,
    interval: plan.interval ?? null,
    billingType: plan.billingType ?? "recurring",
    planGroup: plan.planGroup ?? null,
    trialDays: plan.trialDays ?? 0,
    isAddon: plan.isAddon ?? false,
    autoEnable: plan.autoEnable ?? false,
    provider: plan.provider ?? plan.providerId ?? null,
    metadata: normalizeMetadata(plan.metadata),
    features: (plan.features || [])
      .map((feature: any) =>
        normalizeFeature(feature, creditSystemSlugs, featureDefs),
      )
      .sort((a: any, b: any) => a.slug.localeCompare(b.slug)),
  };
}

function normalizeCreditSystem(cs: any) {
  return {
    slug: cs.slug,
    name: cs.name ?? null,
    description: cs.description ?? null,
    features: (cs.features || [])
      .map((feature: any) => ({
        feature: feature.feature,
        creditCost: feature.creditCost ?? 0,
      }))
      .sort((a: any, b: any) => a.feature.localeCompare(b.feature)),
  };
}

function normalizeFeatureDef(feature: any) {
  const type = feature.type ?? null;
  return {
    slug: feature.slug,
    name: feature.name ?? null,
    type,
    meterType: type === "boolean" ? null : (feature.meterType ?? "consumable"),
  };
}

function normalizeCreditPack(pack: any) {
  return {
    slug: pack.slug,
    name: pack.name ?? null,
    description: pack.description ?? null,
    credits: pack.credits ?? 0,
    price: pack.price ?? 0,
    currency: pack.currency ?? null,
    creditSystem: pack.creditSystem || pack.creditSystemId || null,
    provider: pack.provider ?? null,
    metadata: normalizeMetadata(pack.metadata),
  };
}

export interface DiffSection {
  onlyLocal: string[];
  onlyRemote: string[];
  changed: { slug: string; details: string[] }[];
}

export interface DiffResult {
  onlyLocal: string[];
  onlyRemote: string[];
  changed: { slug: string; details: string[] }[];
  features: DiffSection;
  creditSystems: DiffSection;
  creditPacks: DiffSection;
}

function compareObjects<T extends Record<string, any>>(
  local: T,
  remote: T,
  fields: Array<keyof T>,
): string[] {
  const details: string[] = [];
  for (const field of fields) {
    const localVal = local[field];
    const remoteVal = remote[field];
    if (JSON.stringify(localVal) !== JSON.stringify(remoteVal)) {
      details.push(
        `${String(field)}: ${pc.green(JSON.stringify(localVal))} → ${pc.red(
          JSON.stringify(remoteVal),
        )}`,
      );
    }
  }
  return details;
}

function diffMaps<T extends Record<string, any>>(
  localMap: Map<string, T>,
  remoteMap: Map<string, T>,
  fields: Array<keyof T>,
): DiffSection {
  const onlyLocal: string[] = [];
  const onlyRemote: string[] = [];
  const changed: { slug: string; details: string[] }[] = [];

  for (const slug of localMap.keys()) {
    if (!remoteMap.has(slug)) onlyLocal.push(slug);
  }
  for (const slug of remoteMap.keys()) {
    if (!localMap.has(slug)) onlyRemote.push(slug);
  }

  for (const slug of localMap.keys()) {
    if (!remoteMap.has(slug)) continue;
    const local = localMap.get(slug)!;
    const remote = remoteMap.get(slug)!;
    const details = compareObjects(local, remote, fields);
    if (details.length > 0) {
      changed.push({ slug, details });
    }
  }

  return { onlyLocal, onlyRemote, changed };
}

function collectFeatureDefs(plans: any[]): Map<string, any> {
  const defs = new Map<string, any>();
  for (const plan of plans) {
    for (const feature of plan.features || []) {
      if (feature.slug && !defs.has(feature.slug)) {
        defs.set(feature.slug, feature);
      }
    }
  }
  return defs;
}

export interface DiffPlansInput {
  localPlans: any[];
  remotePlans: any[];
  localFeatures?: any[];
  remoteFeatures?: any[];
  localCreditSystems?: any[];
  remoteCreditSystems?: any[];
  localCreditPacks?: any[];
  remoteCreditPacks?: any[];
}

export function diffPlans(input: DiffPlansInput): DiffResult {
  const {
    localPlans = [],
    remotePlans = [],
    localFeatures = [],
    remoteFeatures = [],
    localCreditSystems = [],
    remoteCreditSystems = [],
    localCreditPacks = [],
    remoteCreditPacks = [],
  } = input;

  const creditSystemSlugs = new Set<string>([
    ...localCreditSystems.map((cs) => cs.slug),
    ...remoteCreditSystems.map((cs) => cs.slug),
  ]);

  // Build feature-definition maps so feature metadata (name/type/meterType)
  // is included when normalizing per-plan features.
  const localFeatureDefs = new Map<string, any>(
    localFeatures.map((f) => [f.slug, normalizeFeatureDef(f)]),
  );
  for (const [slug, def] of collectFeatureDefs(localPlans)) {
    if (!localFeatureDefs.has(slug)) localFeatureDefs.set(slug, def);
  }

  const remoteFeatureDefs = new Map<string, any>(
    remoteFeatures.map((f) => [f.slug, normalizeFeatureDef(f)]),
  );
  for (const [slug, def] of collectFeatureDefs(remotePlans)) {
    if (!remoteFeatureDefs.has(slug)) remoteFeatureDefs.set(slug, def);
  }

  const localPlanMap = new Map<string, any>();
  const remotePlanMap = new Map<string, any>();

  for (const plan of localPlans) {
    localPlanMap.set(
      plan.slug,
      normalizePlan(plan, creditSystemSlugs, localFeatureDefs),
    );
  }
  for (const plan of remotePlans) {
    remotePlanMap.set(
      plan.slug,
      normalizePlan(plan, creditSystemSlugs, remoteFeatureDefs),
    );
  }

  const planSection = diffMaps(localPlanMap, remotePlanMap, [
    "name",
    "description",
    "price",
    "currency",
    "interval",
    "billingType",
    "planGroup",
    "trialDays",
    "isAddon",
    "autoEnable",
    "provider",
    "metadata",
  ]);

  // Compute per-feature differences inside each changed plan so the
  // summary shows which feature settings drifted.
  const changed: { slug: string; details: string[] }[] = [];
  for (const slug of localPlanMap.keys()) {
    if (!remotePlanMap.has(slug)) continue;
    const local = localPlanMap.get(slug);
    const remote = remotePlanMap.get(slug);
    const details: string[] = [
      ...(planSection.changed.find((c) => c.slug === slug)?.details ?? []),
    ];

    const localFeatureMap = new Map<string, any>(
      local.features.map((f: any) => [f.slug, f]),
    );
    const remoteFeatureMap = new Map<string, any>(
      remote.features.map((f: any) => [f.slug, f]),
    );

    for (const fslug of localFeatureMap.keys()) {
      if (!remoteFeatureMap.has(fslug)) {
        details.push(`  ${pc.green("+")} feature ${pc.bold(fslug)}`);
        continue;
      }
      const lf = localFeatureMap.get(fslug);
      const rf = remoteFeatureMap.get(fslug);
      const featureDetails = compareObjects(lf, rf, [
        "enabled",
        "name",
        "type",
        "meterType",
        "limit",
        "trialLimit",
        "reset",
        "usageModel",
        "pricePerUnit",
        "billingUnits",
        "ratingModel",
        "tiers",
        "overage",
        "overagePrice",
        "maxOverageUnits",
        "creditCost",
      ]).map((line) => `      ${line}`);
      if (featureDetails.length > 0) {
        details.push(`  ${pc.yellow("~")} feature ${pc.bold(fslug)}`);
        details.push(...featureDetails);
      }
    }
    for (const fslug of remoteFeatureMap.keys()) {
      if (!localFeatureMap.has(fslug)) {
        details.push(`  ${pc.red("-")} feature ${pc.bold(fslug)}`);
      }
    }

    if (details.length > 0) {
      changed.push({ slug, details });
    }
  }

  // Top-level feature definitions diff (name, type, meterType).
  // Only compare this section when the remote side explicitly provides a
  // features collection; otherwise plan-embedded feature metadata is already
  // compared above, and credit-system-only feature metadata is not fetchable.
  const featureSection =
    remoteFeatures.length > 0
      ? diffMaps(
          new Map<string, any>(
            [
              ...localFeatures.map(normalizeFeatureDef),
              ...Array.from(localFeatureDefs.values()),
            ].map((f) => [f.slug, f]),
          ),
          new Map<string, any>(
            [
              ...remoteFeatures.map(normalizeFeatureDef),
              ...Array.from(remoteFeatureDefs.values()),
            ].map((f) => [f.slug, f]),
          ),
          ["name", "type", "meterType"],
        )
      : { onlyLocal: [], onlyRemote: [], changed: [] };

  // Credit Systems diff
  const localCsMap = new Map<string, any>();
  const remoteCsMap = new Map<string, any>();

  for (const cs of localCreditSystems) {
    localCsMap.set(cs.slug, normalizeCreditSystem(cs));
  }
  for (const cs of remoteCreditSystems) {
    remoteCsMap.set(cs.slug, normalizeCreditSystem(cs));
  }

  const csSection = diffMaps(localCsMap, remoteCsMap, ["name", "description"]);
  // Re-add credit-system feature-level details using the existing custom format.
  for (const slug of localCsMap.keys()) {
    if (!remoteCsMap.has(slug)) continue;
    const local = localCsMap.get(slug);
    const remote = remoteCsMap.get(slug);
    const csFeatureDetails: string[] = [];

    const localF = new Map<string, any>(
      (local.features || []).map((f: any) => [f.feature, f]),
    );
    const remoteF = new Map<string, any>(
      (remote.features || []).map((f: any) => [f.feature, f]),
    );

    for (const fslug of localF.keys()) {
      if (!remoteF.has(fslug)) {
        csFeatureDetails.push(
          `  ${pc.green("+")} credit cost for ${pc.bold(fslug)}`,
        );
        continue;
      }
      const lf = localF.get(fslug);
      const rf = remoteF.get(fslug);
      if (lf.creditCost !== rf.creditCost) {
        csFeatureDetails.push(
          `  ${pc.yellow("~")} credit cost for ${pc.bold(fslug)}: ${pc.green(String(lf.creditCost))} → ${pc.red(String(rf.creditCost))}`,
        );
      }
    }
    for (const fslug of remoteF.keys()) {
      if (!localF.has(fslug)) {
        csFeatureDetails.push(
          `  ${pc.red("-")} credit cost for ${pc.bold(fslug)}`,
        );
      }
    }

    if (csFeatureDetails.length > 0) {
      const existing = csSection.changed.find((c) => c.slug === slug);
      if (existing) {
        existing.details.push(...csFeatureDetails);
      } else {
        csSection.changed.push({ slug, details: csFeatureDetails });
      }
    }
  }

  // Credit Packs diff
  const localPackMap = new Map<string, any>();
  const remotePackMap = new Map<string, any>();

  for (const pack of localCreditPacks)
    localPackMap.set(pack.slug, normalizeCreditPack(pack));
  for (const pack of remoteCreditPacks)
    remotePackMap.set(pack.slug, normalizeCreditPack(pack));

  const packSection = diffMaps(localPackMap, remotePackMap, [
    "name",
    "description",
    "credits",
    "price",
    "currency",
    "creditSystem",
    "provider",
    "metadata",
  ]);

  return {
    onlyLocal: planSection.onlyLocal,
    onlyRemote: planSection.onlyRemote,
    changed,
    features: featureSection,
    creditSystems: csSection,
    creditPacks: packSection,
  };
}

export function printDiff(diff: DiffResult): void {
  const hasPlanDiff =
    diff.onlyLocal.length > 0 ||
    diff.onlyRemote.length > 0 ||
    diff.changed.length > 0;
  const hasFeatureDiff =
    diff.features.onlyLocal.length > 0 ||
    diff.features.onlyRemote.length > 0 ||
    diff.features.changed.length > 0;
  const hasCsDiff =
    diff.creditSystems.onlyLocal.length > 0 ||
    diff.creditSystems.onlyRemote.length > 0 ||
    diff.creditSystems.changed.length > 0;
  const hasPackDiff =
    diff.creditPacks.onlyLocal.length > 0 ||
    diff.creditPacks.onlyRemote.length > 0 ||
    diff.creditPacks.changed.length > 0;

  if (!hasPlanDiff && !hasFeatureDiff && !hasCsDiff && !hasPackDiff) {
    p.log.success(pc.green("Everything is in sync. No differences found."));
    return;
  }

  if (hasPlanDiff) {
    const lines: string[] = [];
    if (diff.onlyLocal.length > 0) {
      for (const slug of diff.onlyLocal) {
        lines.push(
          `${pc.green("+")} ${pc.bold(slug)} ${pc.dim("(local only — will be created on sync)")}`,
        );
      }
    }
    if (diff.onlyRemote.length > 0) {
      for (const slug of diff.onlyRemote) {
        lines.push(
          `${pc.red("-")} ${pc.bold(slug)} ${pc.dim("(remote only — not in local config)")}`,
        );
      }
    }
    if (diff.changed.length > 0) {
      for (const item of diff.changed) {
        lines.push(`${pc.yellow("~")} ${pc.bold(item.slug)}`);
        for (const line of item.details) {
          lines.push(`  ${line}`);
        }
      }
    }
    p.note(lines.join("\n"), "Plans Diff");
  }

  if (hasFeatureDiff) {
    const lines: string[] = [];
    if (diff.features.onlyLocal.length > 0) {
      for (const slug of diff.features.onlyLocal) {
        lines.push(
          `${pc.green("+")} ${pc.bold(slug)} ${pc.dim("(local only — will be created on sync)")}`,
        );
      }
    }
    if (diff.features.onlyRemote.length > 0) {
      for (const slug of diff.features.onlyRemote) {
        lines.push(
          `${pc.red("-")} ${pc.bold(slug)} ${pc.dim("(remote only — not in local config)")}`,
        );
      }
    }
    if (diff.features.changed.length > 0) {
      for (const item of diff.features.changed) {
        lines.push(`${pc.yellow("~")} ${pc.bold(item.slug)}`);
        for (const line of item.details) {
          lines.push(`  ${line}`);
        }
      }
    }
    p.note(lines.join("\n"), "Features Diff");
  }

  if (hasCsDiff) {
    const csLines: string[] = [];
    if (diff.creditSystems.onlyLocal.length > 0) {
      for (const slug of diff.creditSystems.onlyLocal) {
        csLines.push(
          `${pc.green("+")} ${pc.bold(slug)} ${pc.dim("(local only — will be created on sync)")}`,
        );
      }
    }
    if (diff.creditSystems.onlyRemote.length > 0) {
      for (const slug of diff.creditSystems.onlyRemote) {
        csLines.push(
          `${pc.red("-")} ${pc.bold(slug)} ${pc.dim("(remote only — not in local config)")}`,
        );
      }
    }
    if (diff.creditSystems.changed.length > 0) {
      for (const item of diff.creditSystems.changed) {
        csLines.push(`${pc.yellow("~")} ${pc.bold(item.slug)}`);
        for (const line of item.details) {
          csLines.push(`  ${line}`);
        }
      }
    }
    p.note(csLines.join("\n"), "Credit Systems Diff");
  }

  if (hasPackDiff) {
    const packLines: string[] = [];
    if (diff.creditPacks.onlyLocal.length > 0) {
      for (const slug of diff.creditPacks.onlyLocal) {
        packLines.push(
          `${pc.green("+")} ${pc.bold(slug)} ${pc.dim("(local only — will be created on sync)")}`,
        );
      }
    }
    if (diff.creditPacks.onlyRemote.length > 0) {
      for (const slug of diff.creditPacks.onlyRemote) {
        packLines.push(
          `${pc.red("-")} ${pc.bold(slug)} ${pc.dim("(remote only — not in local config)")}`,
        );
      }
    }
    if (diff.creditPacks.changed.length > 0) {
      for (const item of diff.creditPacks.changed) {
        packLines.push(`${pc.yellow("~")} ${pc.bold(item.slug)}`);
        for (const line of item.details) {
          packLines.push(`  ${line}`);
        }
      }
    }
    p.note(packLines.join("\n"), "Credit Packs Diff");
  }

  const planParts = [
    diff.onlyLocal.length > 0
      ? `${pc.green(pc.bold(diff.onlyLocal.length.toString()))} plans to add`
      : "",
    diff.onlyRemote.length > 0
      ? `${pc.red(pc.bold(diff.onlyRemote.length.toString()))} plans to remove`
      : "",
    diff.changed.length > 0
      ? `${pc.yellow(pc.bold(diff.changed.length.toString()))} plans modified`
      : "",
  ].filter(Boolean);

  const featureParts = [
    diff.features.onlyLocal.length > 0
      ? `${pc.green(pc.bold(diff.features.onlyLocal.length.toString()))} features to add`
      : "",
    diff.features.onlyRemote.length > 0
      ? `${pc.red(pc.bold(diff.features.onlyRemote.length.toString()))} features to remove`
      : "",
    diff.features.changed.length > 0
      ? `${pc.yellow(pc.bold(diff.features.changed.length.toString()))} features modified`
      : "",
  ].filter(Boolean);

  const csParts = [
    diff.creditSystems.onlyLocal.length > 0
      ? `${pc.green(pc.bold(diff.creditSystems.onlyLocal.length.toString()))} systems to add`
      : "",
    diff.creditSystems.onlyRemote.length > 0
      ? `${pc.red(pc.bold(diff.creditSystems.onlyRemote.length.toString()))} systems to remove`
      : "",
    diff.creditSystems.changed.length > 0
      ? `${pc.yellow(pc.bold(diff.creditSystems.changed.length.toString()))} systems modified`
      : "",
  ].filter(Boolean);

  const packParts = [
    diff.creditPacks.onlyLocal.length > 0
      ? `${pc.green(pc.bold(diff.creditPacks.onlyLocal.length.toString()))} packs to add`
      : "",
    diff.creditPacks.onlyRemote.length > 0
      ? `${pc.red(pc.bold(diff.creditPacks.onlyRemote.length.toString()))} packs to remove`
      : "",
    diff.creditPacks.changed.length > 0
      ? `${pc.yellow(pc.bold(diff.creditPacks.changed.length.toString()))} packs modified`
      : "",
  ].filter(Boolean);

  const parts = [...planParts, ...featureParts, ...csParts, ...packParts].join(
    pc.dim("  ·  "),
  );

  p.log.info(parts);
}
