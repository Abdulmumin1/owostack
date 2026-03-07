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

function normalizeFeature(pf: any, creditSystemSlugs: Set<string>) {
  const usageModel = pf.usageModel || "included";
  const isCreditSystemFeature = creditSystemSlugs.has(pf.slug);
  return {
    slug: pf.slug,
    enabled: pf.enabled,
    limit: pf.limit ?? null,
    // Handle both SDK 'reset' and API 'resetInterval'
    reset: normalizeReset(pf.reset || pf.resetInterval),
    usageModel: isCreditSystemFeature ? "included" : usageModel,
    pricePerUnit: isCreditSystemFeature ? null : (pf.pricePerUnit ?? null),
    billingUnits: isCreditSystemFeature ? 1 : (pf.billingUnits ?? 1),
    ratingModel: isCreditSystemFeature ? "package" : (pf.ratingModel || "package"),
    tiers: isCreditSystemFeature ? null : (pf.tiers ?? null),
    // Handle both SDK 'overage' and API 'overage' (same name)
    overage: normalizeOverage(usageModel, pf.overage),
    overagePrice: isCreditSystemFeature ? null : (pf.overagePrice ?? null),
    maxOverageUnits: isCreditSystemFeature ? null : (pf.maxOverageUnits ?? null),
    creditCost: isCreditSystemFeature ? 0 : (pf.creditCost ?? 0),
  };
}

function normalizePlan(plan: any, creditSystemSlugs: Set<string>) {
  return {
    slug: plan.slug,
    name: plan.name ?? null,
    description: plan.description ?? null,
    price: plan.price ?? 0,
    currency: plan.currency ?? null,
    interval: plan.interval ?? null,
    planGroup: plan.planGroup ?? null,
    trialDays: plan.trialDays ?? 0,
    isAddon: plan.isAddon ?? false,
    autoEnable: plan.autoEnable ?? false,
    features: (plan.features || [])
      .map((feature: any) => normalizeFeature(feature, creditSystemSlugs))
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

export interface DiffResult {
  onlyLocal: string[];
  onlyRemote: string[];
  changed: { slug: string; details: string[] }[];
  creditSystems: {
    onlyLocal: string[];
    onlyRemote: string[];
    changed: { slug: string; details: string[] }[];
  };
  creditPacks: {
    onlyLocal: string[];
    onlyRemote: string[];
    changed: { slug: string; details: string[] }[];
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
  };
}

export function diffPlans(
  localPlans: any[],
  remotePlans: any[],
  localCreditSystems: any[] = [],
  remoteCreditSystems: any[] = [],
  localCreditPacks: any[] = [],
  remoteCreditPacks: any[] = [],
): DiffResult {
  const creditSystemSlugs = new Set<string>([
    ...localCreditSystems.map((cs) => cs.slug),
    ...remoteCreditSystems.map((cs) => cs.slug),
  ]);
  const localMap = new Map<string, any>();
  const remoteMap = new Map<string, any>();

  for (const p of localPlans) {
    localMap.set(p.slug, normalizePlan(p, creditSystemSlugs));
  }
  for (const p of remotePlans) {
    remoteMap.set(p.slug, normalizePlan(p, creditSystemSlugs));
  }

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
    const local = localMap.get(slug);
    const remote = remoteMap.get(slug);
    const details: string[] = [];

    const fields: Array<keyof typeof local> = [
      "name",
      "description",
      "price",
      "currency",
      "interval",
      "planGroup",
      "trialDays",
      "isAddon",
      "autoEnable",
    ];
    for (const field of fields) {
      if (local[field] !== remote[field]) {
        const localVal = JSON.stringify(local[field]);
        const remoteVal = JSON.stringify(remote[field]);
        details.push(
          `${String(field)}: ${pc.green(localVal)} → ${pc.red(remoteVal)}`,
        );
      }
    }

    const localFeatures = new Map<string, any>(
      local.features.map((f: any) => [f.slug, f]),
    );
    const remoteFeatures = new Map<string, any>(
      remote.features.map((f: any) => [f.slug, f]),
    );

    for (const fslug of localFeatures.keys()) {
      if (!remoteFeatures.has(fslug)) {
        details.push(`  ${pc.green("+")} feature ${pc.bold(fslug)}`);
        continue;
      }
      const lf = localFeatures.get(fslug);
      const rf = remoteFeatures.get(fslug);
      if (JSON.stringify(lf) !== JSON.stringify(rf)) {
        details.push(`  ${pc.yellow("~")} feature ${pc.bold(fslug)}`);
        const featureFields: Array<keyof typeof lf> = [
          "enabled",
          "limit",
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
        ];
        for (const ff of featureFields) {
          if (JSON.stringify(lf[ff]) !== JSON.stringify(rf[ff])) {
            const lv = lf[ff] === null ? "unlimited" : String(lf[ff]);
            const rv = rf[ff] === null ? "unlimited" : String(rf[ff]);
            details.push(
              `      ${pc.dim(String(ff))}: ${pc.green(lv)} → ${pc.red(rv)}`,
            );
          }
        }
      }
    }
    for (const fslug of remoteFeatures.keys()) {
      if (!localFeatures.has(fslug)) {
        details.push(`  ${pc.red("-")} feature ${pc.bold(fslug)}`);
      }
    }

    if (details.length > 0) {
      changed.push({ slug, details });
    }
  }

  // Credit Systems diff
  const localCsMap = new Map<string, any>();
  const remoteCsMap = new Map<string, any>();

  for (const cs of localCreditSystems) {
    localCsMap.set(cs.slug, normalizeCreditSystem(cs));
  }
  for (const cs of remoteCreditSystems) {
    remoteCsMap.set(cs.slug, normalizeCreditSystem(cs));
  }

  const csOnlyLocal: string[] = [];
  const csOnlyRemote: string[] = [];
  const csChanged: { slug: string; details: string[] }[] = [];

  for (const slug of localCsMap.keys()) {
    if (!remoteCsMap.has(slug)) csOnlyLocal.push(slug);
  }
  for (const slug of remoteCsMap.keys()) {
    if (!localCsMap.has(slug)) csOnlyRemote.push(slug);
  }

  for (const slug of localCsMap.keys()) {
    if (!remoteCsMap.has(slug)) continue;
    const local = localCsMap.get(slug);
    const remote = remoteCsMap.get(slug);
    const details: string[] = [];

    if (local.name !== remote.name) {
      details.push(
        `name: ${pc.green(JSON.stringify(local.name))} → ${pc.red(JSON.stringify(remote.name))}`,
      );
    }
    if (local.description !== remote.description) {
      details.push(
        `description: ${pc.green(JSON.stringify(local.description))} → ${pc.red(JSON.stringify(remote.description))}`,
      );
    }

    const localF = new Map<string, any>(
      (local.features || []).map((f: any) => [f.feature, f]),
    );
    const remoteF = new Map<string, any>(
      (remote.features || []).map((f: any) => [f.feature, f]),
    );

    for (const fslug of localF.keys()) {
      if (!remoteF.has(fslug)) {
        details.push(`  ${pc.green("+")} credit cost for ${pc.bold(fslug)}`);
        continue;
      }
      const lf = localF.get(fslug);
      const rf = remoteF.get(fslug);
      if (lf.creditCost !== rf.creditCost) {
        details.push(
          `  ${pc.yellow("~")} credit cost for ${pc.bold(fslug)}: ${pc.green(String(lf.creditCost))} → ${pc.red(String(rf.creditCost))}`,
        );
      }
    }
    for (const fslug of remoteF.keys()) {
      if (!localF.has(fslug)) {
        details.push(`  ${pc.red("-")} credit cost for ${pc.bold(fslug)}`);
      }
    }

    if (details.length > 0) {
      csChanged.push({ slug, details });
    }
  }

  // Credit Packs diff
  const localPackMap = new Map<string, any>();
  const remotePackMap = new Map<string, any>();

  for (const pack of localCreditPacks)
    localPackMap.set(pack.slug, normalizeCreditPack(pack));
  for (const pack of remoteCreditPacks)
    remotePackMap.set(pack.slug, normalizeCreditPack(pack));

  const packOnlyLocal: string[] = [];
  const packOnlyRemote: string[] = [];
  const packChanged: { slug: string; details: string[] }[] = [];

  for (const slug of localPackMap.keys()) {
    if (!remotePackMap.has(slug)) packOnlyLocal.push(slug);
  }
  for (const slug of remotePackMap.keys()) {
    if (!localPackMap.has(slug)) packOnlyRemote.push(slug);
  }

  for (const slug of localPackMap.keys()) {
    if (!remotePackMap.has(slug)) continue;
    const local = localPackMap.get(slug);
    const remote = remotePackMap.get(slug);
    const details: string[] = [];

    const packFields: Array<keyof typeof local> = [
      "name",
      "description",
      "credits",
      "price",
      "currency",
      "creditSystem",
      "provider",
    ];
    for (const field of packFields) {
      if (local[field] !== remote[field]) {
        const localVal = JSON.stringify(local[field]);
        const remoteVal = JSON.stringify(remote[field]);
        details.push(
          `${String(field)}: ${pc.green(localVal)} → ${pc.red(remoteVal)}`,
        );
      }
    }

    if (details.length > 0) {
      packChanged.push({ slug, details });
    }
  }

  return {
    onlyLocal,
    onlyRemote,
    changed,
    creditSystems: {
      onlyLocal: csOnlyLocal,
      onlyRemote: csOnlyRemote,
      changed: csChanged,
    },
    creditPacks: {
      onlyLocal: packOnlyLocal,
      onlyRemote: packOnlyRemote,
      changed: packChanged,
    },
  };
}

export function printDiff(diff: DiffResult): void {
  const hasPlanDiff =
    diff.onlyLocal.length > 0 ||
    diff.onlyRemote.length > 0 ||
    diff.changed.length > 0;
  const hasCsDiff =
    diff.creditSystems.onlyLocal.length > 0 ||
    diff.creditSystems.onlyRemote.length > 0 ||
    diff.creditSystems.changed.length > 0;
  const hasPackDiff =
    diff.creditPacks.onlyLocal.length > 0 ||
    diff.creditPacks.onlyRemote.length > 0 ||
    diff.creditPacks.changed.length > 0;

  if (!hasPlanDiff && !hasCsDiff && !hasPackDiff) {
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

  if (hasCsDiff) {
    const csLines: string[] = [];
    const csDiff = diff.creditSystems;
    if (csDiff.onlyLocal.length > 0) {
      for (const slug of csDiff.onlyLocal) {
        csLines.push(
          `${pc.green("+")} ${pc.bold(slug)} ${pc.dim("(local only — will be created on sync)")}`,
        );
      }
    }
    if (csDiff.onlyRemote.length > 0) {
      for (const slug of csDiff.onlyRemote) {
        csLines.push(
          `${pc.red("-")} ${pc.bold(slug)} ${pc.dim("(remote only — not in local config)")}`,
        );
      }
    }
    if (csDiff.changed.length > 0) {
      for (const item of csDiff.changed) {
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
    const packDiff = diff.creditPacks;
    if (packDiff.onlyLocal.length > 0) {
      for (const slug of packDiff.onlyLocal) {
        packLines.push(
          `${pc.green("+")} ${pc.bold(slug)} ${pc.dim("(local only — will be created on sync)")}`,
        );
      }
    }
    if (packDiff.onlyRemote.length > 0) {
      for (const slug of packDiff.onlyRemote) {
        packLines.push(
          `${pc.red("-")} ${pc.bold(slug)} ${pc.dim("(remote only — not in local config)")}`,
        );
      }
    }
    if (packDiff.changed.length > 0) {
      for (const item of packDiff.changed) {
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

  const parts = [...planParts, ...csParts, ...packParts].join(pc.dim("  ·  "));

  p.log.info(parts);
}
