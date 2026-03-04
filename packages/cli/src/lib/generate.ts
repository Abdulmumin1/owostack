function slugToIdentifier(slug: string, used: Set<string>): string {
  const parts = slug
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  let id = parts
    .map((p, i) => {
      const lower = p.toLowerCase();
      return i === 0 ? lower : lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join("");

  if (!id) id = "feature";
  if (/^\d/.test(id)) id = `feature${id}`;

  const reserved = new Set([
    "break",
    "case",
    "catch",
    "class",
    "const",
    "continue",
    "debugger",
    "default",
    "delete",
    "do",
    "else",
    "export",
    "extends",
    "finally",
    "for",
    "function",
    "if",
    "import",
    "in",
    "instanceof",
    "new",
    "return",
    "super",
    "switch",
    "this",
    "throw",
    "try",
    "typeof",
    "var",
    "void",
    "while",
    "with",
    "yield",
  ]);

  if (reserved.has(id)) id = `${id}Feature`;

  let candidate = id;
  let counter = 2;
  while (used.has(candidate)) {
    candidate = `${id}${counter++}`;
  }
  used.add(candidate);
  return candidate;
}

export type ConfigFormat = "ts" | "esm" | "cjs";

export function generateConfig(
  plans: any[],
  creditSystems: any[] = [],
  defaultProvider?: string,
  format: ConfigFormat = "ts",
): string {
  const isTs = format === "ts";
  const isCjs = format === "cjs";

  // Build a map of credit systems by slug
  const creditSystemSlugs = new Set(creditSystems.map((cs) => cs.slug));
  const creditSystemBySlug = new Map(creditSystems.map((cs) => [cs.slug, cs]));

  // ... (rest of logic mostly same, but need to adjust imports and exports)

  // Collect all features, excluding credit system pseudo-features
  const featuresBySlug = new Map<
    string,
    { slug: string; name?: string; type: string; meterType?: string }
  >();
  for (const plan of plans) {
    for (const f of plan.features || []) {
      // Skip credit system features - they'll be handled separately
      if (creditSystemSlugs.has(f.slug)) continue;
      if (!featuresBySlug.has(f.slug)) {
        featuresBySlug.set(f.slug, {
          slug: f.slug,
          name: f.name,
          type: f.type || "metered",
          meterType: f.meterType,
        });
      }
    }
  }

  // Also collect child features from credit systems
  for (const cs of creditSystems) {
    for (const f of cs.features || []) {
      if (!featuresBySlug.has(f.feature)) {
        featuresBySlug.set(f.feature, {
          slug: f.feature,
          name: f.feature,
          type: "metered",
        });
      }
    }
  }

  const usedNames = new Set<string>();
  const featureVars = new Map<string, string>();

  const featureLines: string[] = [];
  for (const feature of featuresBySlug.values()) {
    const varName = slugToIdentifier(feature.slug, usedNames);
    featureVars.set(feature.slug, varName);
    const nameArg = feature.name
      ? `, { name: ${JSON.stringify(feature.name)} }`
      : "";

    const isEntity = feature.meterType === "non_consumable";
    const builder = feature.type === "boolean"
      ? "boolean"
      : isEntity
        ? "entity"
        : "metered";
    const decl = `${builder}(${JSON.stringify(feature.slug)}${nameArg})`;

    if (isCjs) {
      featureLines.push(`const ${varName} = ${decl};`);
      featureLines.push(`exports.${varName} = ${varName};`);
    } else {
      featureLines.push(`export const ${varName} = ${decl};`);
    }
  }

  // Generate credit system definitions
  const creditSystemLines: string[] = [];
  const creditSystemVars = new Map<string, string>();

  for (const cs of creditSystems) {
    const varName = slugToIdentifier(cs.slug, usedNames);
    creditSystemVars.set(cs.slug, varName);

    const nameArg = cs.name ? `name: ${JSON.stringify(cs.name)}` : "";
    const descArg = cs.description
      ? `description: ${JSON.stringify(cs.description)}`
      : "";

    const featureEntries = (cs.features || []).map((f: any) => {
      const childVar = featureVars.get(f.feature) || f.feature;
      return `${childVar}(${f.creditCost})`;
    });

    const optsParts = [
      nameArg,
      descArg,
      `features: [${featureEntries.join(", ")}]`,
    ].filter(Boolean);

    const decl = `creditSystem(${JSON.stringify(cs.slug)}, { ${optsParts.join(", ")} })`;

    if (isCjs) {
      creditSystemLines.push(`const ${varName} = ${decl};`);
      creditSystemLines.push(`exports.${varName} = ${varName};`);
    } else {
      creditSystemLines.push(`export const ${varName} = ${decl};`);
    }
  }

  const planLines: string[] = [];
  for (const plan of plans) {
    const configLines: string[] = [];
    configLines.push(`name: ${JSON.stringify(plan.name)}`);
    if (plan.description)
      configLines.push(`description: ${JSON.stringify(plan.description)}`);
    configLines.push(`price: ${plan.price}`);
    configLines.push(`currency: ${JSON.stringify(plan.currency)}`);
    configLines.push(`interval: ${JSON.stringify(plan.interval)}`);
    if (plan.planGroup)
      configLines.push(`planGroup: ${JSON.stringify(plan.planGroup)}`);
    if (plan.trialDays && plan.trialDays > 0)
      configLines.push(`trialDays: ${plan.trialDays}`);
    if (plan.provider)
      configLines.push(`provider: ${JSON.stringify(plan.provider)}`);

    const featureEntries: string[] = [];
    for (const pf of plan.features || []) {
      // Handle credit system features
      if (creditSystemSlugs.has(pf.slug)) {
        const csVar = creditSystemVars.get(pf.slug);
        if (csVar && pf.enabled) {
          const opts: string[] = [];
          if (pf.resetInterval || pf.reset)
            opts.push(`reset: "${pf.resetInterval || pf.reset || "monthly"}"`);
          if (pf.overage) opts.push(`overage: "${pf.overage}"`);

          if (opts.length > 0) {
            featureEntries.push(
              `${csVar}.credits(${pf.limit ?? 0}, { ${opts.join(", ")} })`,
            );
          } else {
            featureEntries.push(`${csVar}.credits(${pf.limit ?? 0})`);
          }
        }
        continue;
      }

      const varName = featureVars.get(pf.slug) || pf.slug;
      const globalFeature = featuresBySlug.get(pf.slug);
      const featureType = globalFeature?.type || pf.type || "metered";

      if (featureType === "boolean") {
        featureEntries.push(
          pf.enabled ? `${varName}.on()` : `${varName}.off()`,
        );
        continue;
      }

      if (pf.enabled === false) {
        // Preserve config for disabled metered features
        const config: Record<string, unknown> = { enabled: false };
        if (pf.limit !== undefined) config.limit = pf.limit;
        if (pf.resetInterval || pf.reset)
          config.reset = pf.resetInterval || pf.reset;
        if (pf.overage) config.overage = pf.overage;
        if (pf.overagePrice !== undefined)
          config.overagePrice = pf.overagePrice;

        featureEntries.push(`${varName}.config(${JSON.stringify(config)})`);
        continue;
      }

      const isEntityFeature = globalFeature?.meterType === "non_consumable";
      const config: Record<string, unknown> = {};
      if (pf.limit !== undefined) config.limit = pf.limit;
      // Entity features default to reset: "never", so omit reset for them
      if (!isEntityFeature) {
        const reset = pf.resetInterval || pf.reset || "monthly";
        if (reset !== "none") config.reset = reset;
      }
      if (pf.overage) config.overage = pf.overage;
      if (pf.overagePrice !== undefined) config.overagePrice = pf.overagePrice;

      const configKeys = Object.keys(config);
      const hasExtras = configKeys.some((k) => k !== "limit");
      if (config.limit === null && !hasExtras) {
        featureEntries.push(`${varName}.unlimited()`);
      } else if (typeof config.limit === "number" && !hasExtras) {
        featureEntries.push(`${varName}.limit(${config.limit})`);
      } else if (typeof config.limit === "number") {
        const { limit, ...rest } = config;
        featureEntries.push(
          `${varName}.limit(${limit}, ${JSON.stringify(rest)})`,
        );
      } else {
        featureEntries.push(`${varName}.config(${JSON.stringify(config)})`);
      }
    }

    configLines.push(`features: [${featureEntries.join(", ")}]`);
    planLines.push(
      `plan(${JSON.stringify(plan.slug)}, {\n      ${configLines.join(",\n      ")}\n    })`,
    );
  }

  const hasCreditSystems = creditSystemLines.length > 0;
  const hasEntities = Array.from(featuresBySlug.values()).some(
    (f) => f.meterType === "non_consumable",
  );
  const providerLine = defaultProvider
    ? `  provider: ${JSON.stringify(defaultProvider)},\n`
    : "";

  const importParts = ["Owostack", "metered", "boolean"];
  if (hasEntities) importParts.push("entity");
  importParts.push("creditSystem", "plan");

  const imports = isCjs
    ? `const { ${importParts.join(", ")} } = require("owostack");`
    : `import { ${importParts.join(", ")} } from "owostack";`;

  const tsCheck = !isTs ? `// @ts-check` : "";
  const jsDoc = !isTs ? `/** @type {import('owostack').Owostack} */` : "";

  const owoDecl = isCjs ? "exports.owo =" : "export const owo =";
  const secretKey = isTs
    ? "process.env.OWOSTACK_SECRET_KEY!"
    : "process.env.OWOSTACK_SECRET_KEY";

  return [
    tsCheck,
    imports,
    ``,
    ...featureLines,
    ...(hasCreditSystems ? ["", ...creditSystemLines] : []),
    ``,
    jsDoc,
    `${owoDecl} new Owostack({`,
    `  secretKey: ${secretKey},`,
    providerLine,
    `  catalog: [`,
    `    ${planLines.join(",\n    ")}`,
    `  ],`,
    `});`,
    ``,
  ]
    .filter(Boolean)
    .join("\n");
}
