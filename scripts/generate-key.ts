import { createHash, randomBytes, randomUUID } from "node:crypto";

/**
 * Generate an environment-scoped Owostack API key for local development.
 *
 *   pnpm keygen <test|live> <organizationId> [name]
 *
 * Keys are stored hashed in the shared auth DB (`api_keys`); the SQL printed
 * below inserts the hash so the key is accepted by the matching environment:
 *   owo_sk_test_… -> sandbox (ENVIRONMENT=test|development)
 *   owo_sk_live_… -> live    (ENVIRONMENT=live|production)
 */
type KeyEnvironment = "test" | "live";

function generateApiKey(environment: KeyEnvironment): string {
  return `owo_sk_${environment}_${randomBytes(24).toString("hex")}`;
}

function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function main() {
  const [environmentArg, organizationId, name = "Local dev key"] =
    process.argv.slice(2);

  if (
    (environmentArg !== "test" && environmentArg !== "live") ||
    !organizationId
  ) {
    console.error(
      "Usage: pnpm keygen <test|live> <organizationId> [name]\n" +
        "Example: pnpm keygen test org_123 'My sandbox key'",
    );
    process.exit(2);
  }

  const environment: KeyEnvironment = environmentArg;
  const apiKey = generateApiKey(environment);
  const hash = hashApiKey(apiKey);
  const id = randomUUID();
  const prefix = `owo_sk_${environment}_`;

  console.log("\nGenerated Owostack API key\n");
  console.log("--------------------------------------------------");
  console.log(`Key:          ${apiKey}`);
  console.log(`Environment:  ${environment === "test" ? "sandbox" : "live"}`);
  console.log(`Organization: ${organizationId}`);
  console.log("--------------------------------------------------\n");
  console.log(
    "Store the key now; only its hash is persisted. Insert it into the auth DB with:\n",
  );
  console.log(
    `npx wrangler d1 execute owostack-auth --local --command "INSERT INTO api_keys (id, organization_id, name, prefix, hash, environment, created_at) VALUES ('${id}', '${organizationId}', '${name.replace(/'/g, "''")}', '${prefix}', '${hash}', '${environment}', ${Date.now()});"\n`,
  );
}

main();
