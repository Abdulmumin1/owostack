import pc from "picocolors";
import * as p from "@clack/prompts";

function normalizeFeature(pf: any) {
  return {
    slug: pf.slug,
    enabled: pf.enabled,
    limit: pf.limit ?? null,
    // Handle both SDK 'reset' and API 'resetInterval'
    reset: pf.reset || pf.resetInterval || "monthly",
    // Handle both SDK 'overage' and API 'overage' (same name)
    overage: pf.overage || "block",
    overagePrice: pf.overagePrice ?? null,
  };
}

function normalizePlan(plan: any) {
  return {
    slug: plan.slug,
    name: plan.name ?? null,
    description: plan.description ?? null,
    price: plan.price ?? 0,
    currency: plan.currency ?? null,
    interval: plan.interval ?? null,
    planGroup: plan.planGroup ?? null,
    trialDays: plan.trialDays ?? 0,
    features: (plan.features || [])
      .map(normalizeFeature)
      .sort((a: any, b: any) => a.slug.localeCompare(b.slug)),
  };
}

export interface DiffResult {
  onlyLocal: string[];
  onlyRemote: string[];
  changed: { slug: string; details: string[] }[];
}

export function diffPlans(localPlans: any[], remotePlans: any[]): DiffResult {
  const localMap = new Map<string, any>();
  const remoteMap = new Map<string, any>();

  for (const p of localPlans) localMap.set(p.slug, normalizePlan(p));
  for (const p of remotePlans) remoteMap.set(p.slug, normalizePlan(p));

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

    const localFeatures = new Map(local.features.map((f: any) => [f.slug, f]));
    const remoteFeatures = new Map(
      remote.features.map((f: any) => [f.slug, f]),
    );

    for (const fslug of localFeatures.keys()) {
      if (!remoteFeatures.has(fslug)) {
        details.push(`feature ${fslug}: ${pc.green("[local only]")}`);
        continue;
      }
      const lf = localFeatures.get(fslug);
      const rf = remoteFeatures.get(fslug);
      if (JSON.stringify(lf) !== JSON.stringify(rf)) {
        details.push(`feature ${fslug}:`);
        details.push(`  ${pc.green(JSON.stringify(lf))}`);
        details.push(`  ${pc.red(JSON.stringify(rf))}`);
      }
    }
    for (const fslug of remoteFeatures.keys()) {
      if (!localFeatures.has(fslug)) {
        details.push(`feature ${fslug}: ${pc.red("[remote only]")}`);
      }
    }

    if (details.length > 0) {
      changed.push({ slug, details });
    }
  }

  return { onlyLocal, onlyRemote, changed };
}

export function printDiff(diff: DiffResult): void {
  if (
    diff.onlyLocal.length === 0 &&
    diff.onlyRemote.length === 0 &&
    diff.changed.length === 0
  ) {
    p.log.success(pc.green("No differences found."));
    return;
  }

  if (diff.onlyLocal.length > 0) {
    p.note(
      diff.onlyLocal.map((slug) => `${pc.green("+")} ${slug}`).join("\n"),
      "Only in Local",
    );
  }

  if (diff.onlyRemote.length > 0) {
    p.note(
      diff.onlyRemote.map((slug) => `${pc.red("-")} ${slug}`).join("\n"),
      "Only in Remote",
    );
  }

  if (diff.changed.length > 0) {
    let changedText = "";
    for (const item of diff.changed) {
      changedText += `\n${pc.bold(item.slug)}\n`;
      for (const line of item.details) {
        changedText += `  ${line}\n`;
      }
    }
    p.note(changedText.trim(), "Changed Plans");
  }

  const summary = [
    diff.onlyLocal.length > 0
      ? `${pc.green(diff.onlyLocal.length.toString())} added`
      : "",
    diff.onlyRemote.length > 0
      ? `${pc.red(diff.onlyRemote.length.toString())} removed`
      : "",
    diff.changed.length > 0
      ? `${pc.yellow(diff.changed.length.toString())} changed`
      : "",
  ]
    .filter(Boolean)
    .join("  ");

  p.log.info(summary);
}
