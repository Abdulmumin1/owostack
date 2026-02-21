import * as p from "@clack/prompts";
import pc from "picocolors";
import {
  loadConfigSettings,
  loadOwostackFromConfig,
  resolveConfigPath,
} from "../lib/loader.js";
import { fetchPlans } from "../lib/api.js";
import { getApiKey, getApiUrl, getTestApiUrl } from "../lib/config.js";
import { printBrand } from "../lib/brand.js";

interface ValidateOptions {
  config: string;
  prod?: boolean;
}

export async function runValidate(options: ValidateOptions) {
  printBrand();
  p.intro(pc.bgYellow(pc.black(" validate ")));

  const fullPath = resolveConfigPath(options.config);
  const s = p.spinner();

  s.start(`Loading ${pc.cyan(options.config)}`);
  const owo = await loadOwostackFromConfig(fullPath);

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

  const { buildSyncPayload } = (await import("@owostack/core").catch(() => ({
    buildSyncPayload: null,
  }))) as any;

  if (!buildSyncPayload) {
    p.log.error("buildSyncPayload unavailable from @owostack/core.");
    process.exit(1);
  }

  try {
    const payload = buildSyncPayload(owo._config.catalog);

    p.log.step(pc.bold("Features"));
    for (const f of payload.features) {
      p.log.message(`${pc.green("✓")} ${f.slug} ${pc.dim(`(${f.type})`)}`);
    }

    p.log.step(pc.bold("Plans"));
    for (const p_obj of payload.plans) {
      p.log.message(
        `${pc.green("✓")} ${pc.bold(p_obj.slug)} ${pc.dim(`${p_obj.currency} ${p_obj.price} / ${p_obj.interval}`)}`,
      );
    }

    if (options.prod) {
      p.log.step(pc.magenta("Production Mode Check"));
      const configSettings = await loadConfigSettings(options.config);
      const testUrl = getTestApiUrl(configSettings.environments?.test);
      const liveUrl = getApiUrl(configSettings.environments?.live);
      const apiKey = getApiKey();

      try {
        const testPlans = await fetchPlans({
          apiKey,
          apiUrl: `${testUrl}/api/v1`,
        });
        p.log.success(
          `TEST environment accessible (${testPlans.length} remote plans)`,
        );
      } catch (e: any) {
        p.log.error(`TEST environment check failed: ${e.message}`);
      }

      try {
        const livePlans = await fetchPlans({
          apiKey,
          apiUrl: `${liveUrl}/api/v1`,
        });
        p.log.success(
          `LIVE environment accessible (${livePlans.length} remote plans)`,
        );
      } catch (e: any) {
        p.log.error(`LIVE environment check failed: ${e.message}`);
      }
    }

    p.outro(pc.green("Validation passed! ✨"));
  } catch (e: any) {
    p.log.error(`Validation failed: ${e.message}`);
    process.exit(1);
  }
}
