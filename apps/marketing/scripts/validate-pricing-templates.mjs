import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const templatesPath = path.resolve(
  __dirname,
  "../src/lib/content/pricing-templates.ts",
);

const source = fs.readFileSync(templatesPath, "utf8");
const snippetMatches = [...source.matchAll(/builderSnippet: `([\s\S]*?)`,/g)];

const errors = [];

for (const match of snippetMatches) {
  const snippet = match[1];
  const line = source.slice(0, match.index).split("\n").length;

  if (/\bfeature\(/.test(snippet)) {
    errors.push(
      `Line ${line}: pricing template uses feature(), but /packages/core only exports boolean(), entity(), and metered().`,
    );
  }

  if (/\.perUnit\([^)]*,\s*\{[\s\S]*billingUnits\s*:/.test(snippet)) {
    errors.push(
      `Line ${line}: perUnit() only accepts { reset? }; use .config() for billingUnits.`,
    );
  }

  if (/\.perUnit\([^)]*,\s*\{[\s\S]*condition\s*:/.test(snippet)) {
    errors.push(
      `Line ${line}: perUnit() does not support conditional pricing config.`,
    );
  }

  const decimalMoney = [
    ...snippet.matchAll(/\bperUnit\((\d+\.\d+)/g),
    ...snippet.matchAll(/\b(?:pricePerUnit|unitPrice):\s*(\d+\.\d+)/g),
  ];

  for (const moneyMatch of decimalMoney) {
    errors.push(
      `Line ${line}: found fractional minor-unit price (${moneyMatch[1]}). /packages/core expects integer minor currency units.`,
    );
  }

  const freePlans = [
    ...snippet.matchAll(/plan\(\s*"[^"]+"\s*,\s*\{([\s\S]*?)\n\}\);/g),
  ];

  for (const freePlan of freePlans) {
    const planBody = freePlan[1];
    if (!/\bprice:\s*0\b/.test(planBody)) continue;

    const hasAutoEnable = /\bautoEnable:\s*true\b/.test(planBody);
    const isUsageBased =
      /\busageModel:\s*"usage_based"/.test(planBody) ||
      /\.(?:perUnit|graduated|volume)\(/.test(planBody);
    const hasOverage =
      /\boverage:\s*"charge"/.test(planBody) ||
      /\boverage:\s*"notify"/.test(planBody);

    if (!isUsageBased && !hasOverage && !hasAutoEnable) {
      errors.push(
        `Line ${line}: non-usage-based free pricing-template plans must set autoEnable: true.`,
      );
    }

    if ((isUsageBased || hasOverage) && hasAutoEnable) {
      errors.push(
        `Line ${line}: free plans with overage or usage-based billing must not set autoEnable: true.`,
      );
    }
  }
}

if (errors.length > 0) {
  console.error("Pricing template validation failed:\n");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("Pricing templates validated successfully.");
