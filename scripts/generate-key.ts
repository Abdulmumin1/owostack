import { randomBytes, randomUUID } from "node:crypto";

/**
 * Helper to generate a production-ready API key
 */
function generateApiKey(): string {
  return `owo_sk_${randomBytes(24).toString("hex")}`;
}

async function main() {
  const apiKey = generateApiKey();
  const projectId = `proj_${randomUUID().slice(0, 8)}`;

  const keyData = {
    projectId,
    organizationId: `org_${randomUUID().slice(0, 8)}`,
    permissions: ["*"],
    rateLimit: 1000,
    createdAt: new Date().toISOString(),
  };

  console.log("\n🚀 Generated New Owostack API Key:\n");
  console.log("--------------------------------------------------");
  console.log(`Key:    ${apiKey}`);
  console.log(`Project: ${projectId}`);
  console.log("--------------------------------------------------\n");

  console.log("To add this to your local development environment, run:");
  console.log(
    `npx wrangler kv:key put --binding API_KEYS --local "${apiKey}" '${JSON.stringify(keyData)}'\n`,
  );

  console.log("To add this to production, run:");
  console.log(
    `npx wrangler kv:key put --binding API_KEYS "${apiKey}" '${JSON.stringify(keyData)}'\n`,
  );
}

main().catch(console.error);
