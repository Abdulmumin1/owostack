import * as p from "@clack/prompts";
import pc from "picocolors";
import { getApiKey, getApiUrl, getTestApiUrl } from "../lib/config.js";
import {
  loadConfigSettings,
  loadOwostackFromConfig,
  resolveConfigPath,
} from "../lib/loader.js";
import { printBrand } from "../lib/brand.js";

interface SyncOptions {
  config: string;
  dryRun?: boolean;
  key?: string;
  prod?: boolean;
}

async function runSyncSingle(options: {
  configPath: string;
  dryRun: boolean;
  apiKey: string;
  apiUrl: string;
}) {
  const { configPath, dryRun, apiUrl } = options;
  const apiKey = getApiKey(options.apiKey);
  const fullPath = resolveConfigPath(configPath);

  const s = p.spinner();
  s.start(`Loading ${pc.cyan(configPath)}`);

  let owo: any;
  try {
    owo = await loadOwostackFromConfig(fullPath);
  } catch (e: any) {
    s.stop(pc.red("Failed to load configuration"));
    p.log.error(pc.red(`Error: ${e.message}`));
    p.note(
      `import { Owostack, metered, boolean, plan } from "owostack";\nexport default new Owostack({ secretKey: "...", catalog: [...] });`,
      "Example owo.config.ts",
    );
    p.log.info(
      pc.dim(
        "Make sure 'owostack' is installed in your project: 'npm install owostack'",
      ),
    );
    process.exit(1);
  }

  if (!owo || typeof owo.sync !== "function") {
    s.stop(pc.red("Invalid configuration"));
    p.log.error("Config file must export an Owostack instance.");
    process.exit(1);
  }

  s.message("Syncing with API...");

  if (apiKey && typeof owo.setSecretKey === "function") {
    owo.setSecretKey(apiKey);
  }
  if (apiUrl && typeof owo.setApiUrl === "function") {
    owo.setApiUrl(apiUrl);
  }

  try {
    if (dryRun) {
      s.stop(pc.yellow("Dry run mode (showing catalog payload)"));

      const { buildSyncPayload } = (await import("owostack").catch(() => {
        return { buildSyncPayload: null };
      })) as any;

      if (buildSyncPayload && owo._config?.catalog) {
        const payload = buildSyncPayload(owo._config.catalog);

        let featureSummary = payload.features
          .map(
            (f: any) =>
              `${pc.green("+")} ${pc.bold(f.slug)} ${pc.dim(`(${f.type})`)}`,
          )
          .join("\n");

        p.note(
          featureSummary || pc.dim("No features defined"),
          "Features to Sync",
        );

        let planSummary = "";
        for (const p_obj of payload.plans) {
          planSummary += `${pc.green("+")} ${pc.bold(p_obj.slug)} ${pc.dim(`${p_obj.currency} ${p_obj.price}/${p_obj.interval}`)}\n`;
          for (const f of p_obj.features) {
            const status = f.enabled ? pc.green("✓") : pc.red("✗");
            const configParts = [];
            if (f.limit !== undefined)
              configParts.push(
                `limit: ${f.limit === null ? "unlimited" : f.limit}`,
              );
            if (f.reset) configParts.push(`reset: ${f.reset}`);
            if (f.overage) configParts.push(`overage: ${f.overage}`);
            if (f.overagePrice) configParts.push(`price: ${f.overagePrice}`);

            const configStr =
              configParts.length > 0
                ? ` ${pc.dim(`(${configParts.join(", ")})`)}`
                : "";
            planSummary += `  ${status} ${pc.dim(f.slug)}${configStr}\n`;
          }
          planSummary += "\n";
        }

        p.note(
          planSummary.trim() || pc.dim("No plans defined"),
          "Plans to Sync",
        );
      }

      p.log.info(pc.yellow("No changes were applied to the server."));
      return;
    }

    const result = await owo.sync();
    s.stop(pc.green("Sync completed"));

    if (!result.success) {
      p.log.error(pc.red("Sync failed"));
      process.exit(1);
    }

    const fc = result.features;
    const pc_res = result.plans;

    let summary = [];
    if (fc.created.length)
      summary.push(pc.green(`+ ${fc.created.length} features`));
    if (fc.updated.length)
      summary.push(pc.cyan(`~ ${fc.updated.length} features`));
    if (pc_res.created.length)
      summary.push(pc.green(`+ ${pc_res.created.length} plans`));
    if (pc_res.updated.length)
      summary.push(pc.cyan(`~ ${pc_res.updated.length} plans`));

    if (summary.length > 0) {
      p.note(summary.join("\n"), "Changes applied");
    } else {
      p.log.info(pc.dim("No changes detected. Catalog is up to date."));
    }

    if (result.warnings.length) {
      p.log.warn(pc.yellow(`Warnings:\n${result.warnings.join("\n")}`));
    }
  } catch (e: any) {
    s.stop(pc.red("Sync failed"));
    p.log.error(e.message);
    throw e;
  }
}

export async function runSync(options: SyncOptions) {
  p.intro(pc.bgYellow(pc.black(" sync ")));

  const configSettings = await loadConfigSettings(options.config);
  let apiUrl = configSettings.apiUrl;

  const testUrl = getTestApiUrl(configSettings.environments?.test);
  const liveUrl = getApiUrl(configSettings.environments?.live);

  if (options.prod) {
    p.log.step(pc.magenta("Production Mode: Syncing both environments"));

    await runSyncSingle({
      configPath: options.config,
      dryRun: !!options.dryRun,
      apiKey: options.key || "",
      apiUrl: apiUrl || `${testUrl}/api/v1`,
    });

    await runSyncSingle({
      configPath: options.config,
      dryRun: !!options.dryRun,
      apiKey: options.key || "",
      apiUrl: apiUrl || `${liveUrl}/api/v1`,
    });
  } else {
    await runSyncSingle({
      configPath: options.config,
      dryRun: !!options.dryRun,
      apiKey: options.key || "",
      apiUrl: apiUrl || `${liveUrl}/api/v1`,
    });
  }

  p.outro(pc.green("Done! ✨"));
}
