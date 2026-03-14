import * as p from "@clack/prompts";
import pc from "picocolors";
import {
  loadConfigSettings,
  loadOwostackFromConfig,
  resolveConfigPath,
} from "../lib/loader.js";
import { fetchPlans } from "../lib/api.js";
import { getApiKey, getLiveApiUrl, getTestApiUrl } from "../lib/config.js";

interface ValidateOptions {
  config?: string;
  prod?: boolean;
}

export async function runValidate(options: ValidateOptions) {
  p.intro(pc.bgYellow(pc.black(" validate ")));

  const fullPath = resolveConfigPath(options.config);

  if (!fullPath) {
    p.log.error(pc.red("No configuration file found."));
    process.exit(1);
  }

  const s = p.spinner();

  s.start(`Loading ${pc.cyan(fullPath)}`);
  let owo: any;
  try {
    owo = await loadOwostackFromConfig(fullPath);
  } catch (e: any) {
    s.stop(pc.red("Failed to load configuration"));
    p.log.error(pc.red(`Error: ${e.message}`));
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

  if (!owo._config?.catalog || owo._config.catalog.length === 0) {
    s.stop(pc.red("No catalog found"));
    p.log.error("Config has no catalog to validate.");
    process.exit(1);
  }

  s.stop(
    pc.green(`Configuration loaded (${owo._config.catalog.length} entries)`),
  );

  const { buildSyncPayload } = (await import("owostack").catch(() => ({
    buildSyncPayload: null,
  }))) as any;

  if (!buildSyncPayload) {
    p.log.error("buildSyncPayload unavailable from owostack.");
    process.exit(1);
  }

  try {
    const payload = buildSyncPayload(owo._config.catalog);

    p.log.step(pc.bold("Features"));
    for (const f of payload.features) {
      p.log.message(`${pc.green("✓")} ${f.slug} ${pc.dim(`(${f.type})`)}`);
    }

    if (payload.creditSystems && payload.creditSystems.length > 0) {
      p.log.step(pc.bold("Credit Systems"));
      for (const cs of payload.creditSystems) {
        p.log.message(
          `${pc.green("✓")} ${pc.bold(cs.slug)} ${pc.dim(`(${cs.features.length} features)`)}`,
        );
      }
    }

    p.log.step(pc.bold("Plans"));
    for (const p_obj of payload.plans) {
      p.log.message(
        `${pc.green("✓")} ${p_obj.isAddon ? pc.cyan("(addon)") : ""} ${pc.bold(p_obj.slug)} ${pc.dim(`${p_obj.currency} ${p_obj.price} / ${p_obj.interval}`)}`,
      );
    }

    // Default to test environment, prod only with --prod flag
    const configSettings = await loadConfigSettings(options.config);
    const testUrl = getTestApiUrl(configSettings.environments?.test);
    const liveUrl = getLiveApiUrl(configSettings.environments?.live);
    const apiKey = getApiKey();

    if (options.prod) {
      p.log.step(pc.magenta("Production Mode: Checking PROD environment"));
      const apiUrl = `${liveUrl}/api/v1`;
      try {
        const livePlans = await fetchPlans({
          apiKey,
          apiUrl: apiUrl,
        });
        p.log.success(
          `PROD environment accessible (${livePlans.length} remote plans)`,
        );
      } catch (e: any) {
        p.log.error(`PROD environment check failed: ${e.message}`);
      }
    } else {
      p.log.step(pc.cyan("Sandbox Mode: Checking SANDBOX environment"));
      const apiUrl = `${testUrl}/api/v1`;
      try {
        const testPlans = await fetchPlans({
          apiKey,
          apiUrl: apiUrl,
        });
        p.log.success(
          `SANDBOX environment accessible (${testPlans.length} remote plans)`,
        );
      } catch (e: any) {
        p.log.error(`SANDBOX environment check failed: ${e.message}`);
      }
    }

    p.outro(pc.green("Validation passed! ✨"));
  } catch (e: any) {
    p.log.error(`Validation failed: ${e.message}`);
    process.exit(1);
  }
}
