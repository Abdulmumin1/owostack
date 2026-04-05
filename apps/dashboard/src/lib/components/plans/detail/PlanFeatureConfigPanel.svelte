<script lang="ts">
  import {
    Calendar,
    Check,
    CircleNotch,
    CurrencyDollarIcon,
    FloppyDiskIcon,
    Plus,
    Sliders,
    Trash,
  } from "phosphor-svelte";
  import { fade, fly } from "svelte/transition";
  import SidePanel from "$lib/components/ui/SidePanel.svelte";
  import { defaultCurrency } from "$lib/stores/currency";
  import { COMMON_CURRENCIES } from "$lib/utils/currency";

  type RatingModel = "package" | "graduated" | "volume";
  type TierFormRow = {
    id: string;
    upTo: string;
    unitPrice: string;
    flatFee: string;
  };
  type ParsedPricingTier = {
    upTo: number | null;
    unitPrice?: number;
    flatFee?: number;
  };

  let {
    open = false,
    plan,
    feature = null,
    isSaving = false,
    onClose = () => {},
    onSave = (_data: Record<string, unknown>) => {},
  }: {
    open?: boolean;
    plan: any;
    feature?: any;
    isSaving?: boolean;
    onClose?: () => void;
    onSave?: (data: Record<string, unknown>) => void | Promise<void>;
  } = $props();

  let configLimitValue = $state<string>("");
  let configTrialLimitValue = $state<string>("");
  let configResetInterval = $state<string>("monthly");
  let configUsageModel = $state<"included" | "usage_based">("included");
  let configRatingModel = $state<RatingModel>("package");
  let configPricePerUnit = $state<string>("");
  let configBillingUnits = $state<string>("1");
  let configTiers = $state<TierFormRow[]>([]);
  let configOverage = $state<"block" | "charge">("block");
  let configMaxOverageUnits = $state<string>("");
  let configRolloverEnabled = $state<boolean>(false);
  let configRolloverMaxBalance = $state<string>("");
  let showTrialConfig = $state<boolean>(false);
  let lastFeatureId = $state<string | null>(null);

  function createTierRow(
    tier?: Partial<{
      upTo: number | null;
      unitPrice?: number;
      flatFee?: number;
    }>,
  ): TierFormRow {
    return {
      id: Math.random().toString(36).slice(2, 10),
      upTo:
        tier?.upTo === null || tier?.upTo === undefined
          ? ""
          : String(tier.upTo),
      unitPrice:
        tier?.unitPrice === undefined ? "" : String(tier.unitPrice / 100),
      flatFee: tier?.flatFee === undefined ? "" : String(tier.flatFee / 100),
    };
  }

  function addPricingTier() {
    configTiers = [...configTiers, createTierRow()];
  }

  function removePricingTier(id: string) {
    configTiers = configTiers.filter((tier) => tier.id !== id);
  }

  function parsePricingTiers():
    | { ok: true; tiers: ParsedPricingTier[] }
    | { ok: false; error: string } {
    const parsed: ParsedPricingTier[] = [];
    let previousUpTo = 0;

    for (let index = 0; index < configTiers.length; index += 1) {
      const tier = configTiers[index];
      const upToText = String(tier.upTo).trim();
      const unitPriceText = String(tier.unitPrice).trim();
      const flatFeeText = String(tier.flatFee).trim();

      if (unitPriceText === "" && flatFeeText === "") {
        return {
          ok: false,
          error: `Tier ${index + 1} must define a unit price, flat price, or both.`,
        };
      }

      let upTo: number | null = null;
      if (upToText === "") {
        if (index !== configTiers.length - 1) {
          return {
            ok: false,
            error: `Only the last tier can be open-ended.`,
          };
        }
      } else {
        const parsedUpTo = Number(upToText);
        if (!Number.isFinite(parsedUpTo) || parsedUpTo <= previousUpTo) {
          return {
            ok: false,
            error: `Tier ${index + 1} must end above tier ${index}.`,
          };
        }
        upTo = parsedUpTo;
        previousUpTo = parsedUpTo;
      }

      let unitPrice: number | undefined;
      if (unitPriceText !== "") {
        const parsedUnitPrice = Number(unitPriceText);
        if (!Number.isFinite(parsedUnitPrice) || parsedUnitPrice < 0) {
          return {
            ok: false,
            error: `Tier ${index + 1} has an invalid unit price.`,
          };
        }
        unitPrice = Math.round(parsedUnitPrice * 100);
      }

      let flatFee: number | undefined;
      if (flatFeeText !== "") {
        const parsedFlatFee = Number(flatFeeText);
        if (!Number.isFinite(parsedFlatFee) || parsedFlatFee < 0) {
          return {
            ok: false,
            error: `Tier ${index + 1} has an invalid flat price.`,
          };
        }
        flatFee = Math.round(parsedFlatFee * 100);
      }

      parsed.push({
        upTo,
        ...(unitPrice !== undefined ? { unitPrice } : {}),
        ...(flatFee !== undefined ? { flatFee } : {}),
      });
    }

    return { ok: true, tiers: parsed };
  }

  function usesTieredPricing() {
    return configRatingModel === "graduated" || configRatingModel === "volume";
  }

  function hasUsagePricingConfig() {
    return configUsageModel === "usage_based";
  }

  function hasOveragePricingConfig() {
    return configUsageModel === "included" && configOverage === "charge";
  }

  function requiresPricingConfig() {
    return hasUsagePricingConfig() || hasOveragePricingConfig();
  }

  function selectRatingModel(model: RatingModel) {
    configRatingModel = model;
    if (
      (configRatingModel === "graduated" || configRatingModel === "volume") &&
      configTiers.length === 0
    ) {
      configTiers = [createTierRow()];
    }
  }

  function getCurrencySymbol() {
    return (
      COMMON_CURRENCIES.find(
        (currency) => currency.code === (plan?.currency || $defaultCurrency),
      )?.symbol ||
      plan?.currency ||
      "NGN"
    );
  }

  function initializeForm(currentFeature: any) {
    const rawLimit = currentFeature.limitValue ?? currentFeature.limit_value;
    configLimitValue =
      rawLimit === null || rawLimit === undefined ? "" : String(rawLimit);

    const rawTrialLimit =
      currentFeature.trialLimitValue ?? currentFeature.trial_limit_value;
    configTrialLimitValue =
      rawTrialLimit === null ||
      rawTrialLimit === undefined ||
      isNaN(Number(rawTrialLimit))
        ? ""
        : String(rawTrialLimit);
    showTrialConfig = configTrialLimitValue !== "";

    const rawInterval = currentFeature.resetInterval || "monthly";
    const intervalAliases: Record<string, string> = {
      "5min": "5min",
      "15min": "15min",
      "30min": "30min",
      hour: "hourly",
      hourly: "hourly",
      day: "daily",
      daily: "daily",
      week: "weekly",
      weekly: "weekly",
      month: "monthly",
      monthly: "monthly",
      quarter: "quarterly",
      quarterly: "quarterly",
      semi_annual: "quarterly",
      year: "yearly",
      yearly: "yearly",
      none: "none",
    };
    configResetInterval = intervalAliases[rawInterval] || "monthly";
    configUsageModel = currentFeature.usageModel || "included";
    configRatingModel = currentFeature.ratingModel || "package";

    const storedPrice =
      currentFeature.usageModel === "usage_based"
        ? currentFeature.pricePerUnit
        : (currentFeature.overagePrice ?? currentFeature.pricePerUnit);
    configPricePerUnit =
      typeof storedPrice === "number" ? String(storedPrice / 100) : "";

    configBillingUnits = String(currentFeature.billingUnits || 1);
    const initialTiers =
      Array.isArray(currentFeature.tiers) && currentFeature.tiers.length > 0
        ? currentFeature.tiers.map((tier: ParsedPricingTier) =>
            createTierRow(tier),
          )
        : [];
    configTiers =
      initialTiers.length > 0
        ? initialTiers
        : currentFeature.ratingModel === "graduated" ||
            currentFeature.ratingModel === "volume"
          ? [createTierRow()]
          : [];

    configOverage = currentFeature.overage === "charge" ? "charge" : "block";
    configMaxOverageUnits =
      currentFeature.maxOverageUnits === null ||
      currentFeature.maxOverageUnits === undefined
        ? ""
        : String(currentFeature.maxOverageUnits);

    configRolloverEnabled = Boolean(currentFeature.rolloverEnabled);
    configRolloverMaxBalance =
      currentFeature.rolloverMaxBalance === null ||
      currentFeature.rolloverMaxBalance === undefined
        ? ""
        : String(currentFeature.rolloverMaxBalance);
  }

  $effect(() => {
    if (open && feature) {
      if (feature.id !== lastFeatureId) {
        lastFeatureId = feature.id;
        initializeForm(feature);
      }
    } else {
      lastFeatureId = null;
    }
  });

  function handleSubmit(event: SubmitEvent) {
    event.preventDefault();

    const normalizedPrice =
      String(configPricePerUnit).trim() === ""
        ? null
        : Math.round(Number(configPricePerUnit) * 100);
    const parsedBillingUnits = Number(configBillingUnits);
    const normalizedBillingUnits =
      Number.isFinite(parsedBillingUnits) && parsedBillingUnits > 0
        ? parsedBillingUnits
        : null;
    let tiers: ParsedPricingTier[] | null = null;

    if (requiresPricingConfig()) {
      if (usesTieredPricing()) {
        const parsedTiers = parsePricingTiers();
        if (!parsedTiers.ok) {
          alert(parsedTiers.error);
          return;
        }
        tiers = parsedTiers.tiers;

        if (tiers.length === 0) {
          alert("Add at least one pricing tier before saving.");
          return;
        }
      } else if (normalizedPrice === null) {
        alert("Set a price before saving this pricing configuration.");
        return;
      } else if (normalizedBillingUnits === null) {
        alert("Set a valid billing unit size before saving.");
        return;
      }
    }

    void onSave({
      usageModel: configUsageModel,
      limitValue:
        configUsageModel === "usage_based" ||
        String(configLimitValue).trim() === ""
          ? null
          : Number(configLimitValue),
      trialLimitValue:
        configUsageModel === "usage_based" ||
        String(configTrialLimitValue).trim() === ""
          ? null
          : Number(configTrialLimitValue),
      resetInterval: configResetInterval,
      pricePerUnit:
        configUsageModel === "usage_based" && configRatingModel === "package"
          ? normalizedPrice
          : null,
      billingUnits:
        configRatingModel === "package" ? normalizedBillingUnits || 1 : 1,
      ratingModel: requiresPricingConfig() ? configRatingModel : "package",
      tiers: usesTieredPricing() ? tiers : null,
      overage: configOverage,
      overagePrice:
        configUsageModel === "included" &&
        configOverage === "charge" &&
        configRatingModel === "package"
          ? normalizedPrice
          : null,
      maxOverageUnits:
        String(configMaxOverageUnits).trim() === ""
          ? null
          : Number(configMaxOverageUnits),
      rolloverEnabled: configRolloverEnabled,
      rolloverMaxBalance:
        String(configRolloverMaxBalance).trim() === ""
          ? null
          : Number(configRolloverMaxBalance),
    });
  }
</script>

<SidePanel
  open={open && !!feature}
  title={`Configure ${feature?.feature?.name}`}
  onclose={onClose}
  width="max-w-[450px]"
>
  <div class="text-sm h-full">
    <form class="flex flex-col justify-between h-full" onsubmit={handleSubmit}>
      <div class="p-6 space-y-8">
        <div class="space-y-3">
          <div
            class="text-[11px] font-bold text-text-dim uppercase tracking-wider px-1"
          >
            Feature Type
          </div>
          <div class="grid grid-cols-2 gap-3">
            <button
              type="button"
              class="relative group text-left flex gap-3 p-4 rounded-lg transition-all duration-200 {configUsageModel ===
              'included'
                ? 'bg-accent-light/20 border-accent'
                : 'bg-bg-card border-border hover:border-border-strong hover:bg-bg-card-hover'}"
              style="border-width: 1px;"
              onclick={() => (configUsageModel = "included")}
            >
              <div
                class="w-10 h-10 bg-bg-primary border border-border flex items-center justify-center flex-shrink-0 rounded-md transition-colors {configUsageModel ===
                'included'
                  ? 'border-accent/30'
                  : 'group-hover:border-border-strong'}"
              >
                <Calendar
                  size={20}
                  class={configUsageModel === "included"
                    ? "text-accent"
                    : "text-text-muted"}
                  weight={configUsageModel === "included" ? "fill" : "duotone"}
                />
              </div>
              <div class="min-w-0">
                <div class="text-sm font-bold text-text-primary mb-0.5">
                  Included
                </div>
                <p
                  class="text-[11px] text-text-muted leading-tight font-medium"
                >
                  Included usage limit.
                </p>
              </div>
              {#if configUsageModel === "included"}
                <div
                  class="absolute top-2.5 right-2.5"
                  transition:fade={{ duration: 150 }}
                >
                  <div
                    class="w-4 h-4 rounded-full bg-accent flex items-center justify-center text-accent-contrast"
                  >
                    <Check size={10} weight="bold" />
                  </div>
                </div>
              {/if}
            </button>

            <button
              type="button"
              class="relative group text-left flex gap-3 p-4 rounded-lg transition-all duration-200 {configUsageModel ===
              'usage_based'
                ? 'bg-accent-light/20 border-accent'
                : 'bg-bg-card border-border hover:border-border-strong hover:bg-bg-card-hover'}"
              style="border-width: 1px;"
              onclick={() => {
                configUsageModel = "usage_based";
                configOverage = "charge";
              }}
            >
              <div
                class="w-10 h-10 bg-bg-primary border border-border flex items-center justify-center flex-shrink-0 rounded-md transition-colors {configUsageModel ===
                'usage_based'
                  ? 'border-accent/30'
                  : 'group-hover:border-border-strong'}"
              >
                <CurrencyDollarIcon
                  size={20}
                  class={configUsageModel === "usage_based"
                    ? "text-accent"
                    : "text-text-muted"}
                  weight={configUsageModel === "usage_based"
                    ? "fill"
                    : "duotone"}
                />
              </div>
              <div class="min-w-0">
                <div class="text-sm font-bold text-text-primary mb-0.5">
                  Priced
                </div>
                <p
                  class="text-[11px] text-text-muted leading-tight font-medium"
                >
                  Charge for usage.
                </p>
              </div>
              {#if configUsageModel === "usage_based"}
                <div
                  class="absolute top-2.5 right-2.5"
                  transition:fade={{ duration: 150 }}
                >
                  <div
                    class="w-4 h-4 rounded-full bg-accent flex items-center justify-center text-accent-contrast"
                  >
                    <Check size={10} weight="bold" />
                  </div>
                </div>
              {/if}
            </button>
          </div>
        </div>

        {#if hasUsagePricingConfig()}
          <div
            class="space-y-4 p-5 bg-bg-secondary border border-border rounded-lg"
          >
            <div class="flex flex-col justify-between gap-4">
              <div>
                <div class="text-sm font-semibold text-text-primary">
                  Usage Pricing
                </div>
                <p class="mt-1 text-[11px] text-text-muted">
                  Billing starts from the first tracked unit.
                </p>
              </div>
              <div
                class="relative flex w-fit bg-bg-card border border-border p-1 rounded-md overflow-hidden isolate"
              >
                <!-- Animated background slider -->
                <div
                  class="absolute inset-y-1 rounded-md bg-accent border border-accent-border transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] z-0"
                  style="
                    width: calc((100% - 8px) / 3);
                    left: calc(4px + (100% - 8px) / 3 * {configRatingModel ===
                  'package'
                    ? 0
                    : configRatingModel === 'graduated'
                      ? 1
                      : 2});
                  "
                ></div>
                {#each [{ value: "package", label: "Package" }, { value: "graduated", label: "Graduated" }, { value: "volume", label: "Volume" }] as model}
                  <button
                    type="button"
                    class="px-4 py-1.5 text-xs font-bold transition-colors duration-200 relative z-10 {configRatingModel ===
                    model.value
                      ? 'text-accent-contrast'
                      : 'text-text-muted hover:text-text-primary'}"
                    onclick={() =>
                      selectRatingModel(model.value as RatingModel)}
                  >
                    {model.label}
                  </button>
                {/each}
              </div>
            </div>

            {#if configRatingModel === "package"}
              <div class="grid grid-cols-2 gap-4 pt-1">
                <div class="space-y-1.5">
                  <label
                    for="pricePerUnit"
                    class="text-[10px] font-bold text-text-dim uppercase tracking-wider px-1"
                  >
                    {configUsageModel === "usage_based"
                      ? "Price per Unit"
                      : "Overage Price"}
                  </label>
                  <div class="input-icon-wrapper">
                    <input
                      id="pricePerUnit"
                      type="number"
                      step="0.01"
                      placeholder="5.00"
                      class="input h-9 !text-xs !pl-8"
                      bind:value={configPricePerUnit}
                    />
                    <div
                      class="absolute left-3 top-1/2 -translate-y-1/2 text-[11px] text-text-dim font-medium pointer-events-none"
                    >
                      {getCurrencySymbol()}
                    </div>
                  </div>
                </div>

                <div class="space-y-1.5">
                  <label
                    for="billingUnits"
                    class="text-[10px] font-bold text-text-dim uppercase tracking-wider px-1"
                  >
                    Per X Units
                  </label>
                  <input
                    id="billingUnits"
                    type="number"
                    placeholder="1000"
                    class="input h-9 !text-xs"
                    bind:value={configBillingUnits}
                  />
                </div>
              </div>

              <p class="text-[11px] text-text-muted">
                {#if configPricePerUnit && configBillingUnits}
                  Charging <strong
                    >{getCurrencySymbol()}{configPricePerUnit}</strong
                  >
                  per
                  <strong
                    >{configBillingUnits}
                    {feature?.feature?.unit || "units"}</strong
                  >
                {:else}
                  Set price and units to configure billing.
                {/if}
              </p>
            {:else}
              <div class="space-y-4 pt-2">
                <div class="flex items-center justify-between">
                  <div class="text-sm font-semibold text-text-primary">
                    Pricing Tiers
                  </div>
                  <button
                    type="button"
                    class="btn btn-secondary btn-sm h-7 px-3 gap-1"
                    onclick={addPricingTier}
                  >
                    <Plus size={12} weight="bold" /> Add Tier
                  </button>
                </div>

                <div>
                  <div class="grid grid-cols-[1fr_1fr_1fr_18px] gap-3 px-1">
                    <div
                      class="text-[10px] font-bold text-text-dim uppercase tracking-wider"
                    >
                      Up To
                    </div>
                    <div
                      class="text-[10px] font-bold text-text-dim uppercase tracking-wider"
                    >
                      Unit Price
                    </div>
                    <div
                      class="text-[10px] font-bold text-text-dim uppercase tracking-wider"
                    >
                      Flat Price
                    </div>
                  </div>

                  {#each configTiers as tier, index (tier.id)}
                    <div
                      class="grid grid-cols-[1fr_1fr_1fr_18px] gap-1 items-center group"
                    >
                      <div class="relative">
                        <input
                          type="number"
                          placeholder={index === configTiers.length - 1
                            ? "Infinity"
                            : "1000"}
                          class="input h-9 !text-xs"
                          bind:value={tier.upTo}
                        />
                      </div>
                      <div class="input-icon-wrapper">
                        <input
                          type="number"
                          step="0.01"
                          placeholder="0.50"
                          class="input h-9 !text-xs !pl-7"
                          bind:value={tier.unitPrice}
                        />
                        <div
                          class="absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] text-text-dim font-medium pointer-events-none"
                        >
                          {getCurrencySymbol()}
                        </div>
                      </div>
                      <div class="input-icon-wrapper">
                        <input
                          type="number"
                          step="0.01"
                          placeholder="Optional"
                          class="input h-9 !text-xs !pl-7"
                          bind:value={tier.flatFee}
                        />
                        <div
                          class="absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] text-text-dim font-medium pointer-events-none"
                        >
                          {getCurrencySymbol()}
                        </div>
                      </div>
                      <div class="flex justify-end">
                        {#if configTiers.length > 1}
                          <button
                            type="button"
                            class="p-1.5 text-text-dim hover:text-error hover:bg-error-bg/10 rounded-md transition-all opacity-0 group-hover:opacity-100"
                            onclick={() => removePricingTier(tier.id)}
                          >
                            <Trash size={14} weight="bold" />
                          </button>
                        {/if}
                      </div>
                    </div>
                  {/each}
                </div>

                <p class="text-[10px] text-text-muted px-1">
                  Each tier can charge by unit, by flat price, or both.
                </p>
                <p class="text-[10px] text-text-muted italic px-1">
                  * {configRatingModel === "graduated"
                    ? "Each tier prices only the billable units inside it. Flat price is added once when usage enters that tier."
                    : "All billable units use the reached tier. Flat price can be used on its own for fixed-price bands."}
                </p>
              </div>
            {/if}
          </div>
        {/if}

        {#if configUsageModel === "included"}
          <div class="space-y-2.5">
            <div class="flex items-center justify-between px-1">
              <label
                for="limitValueConfig"
                class="text-[11px] font-bold text-text-dim uppercase tracking-wider"
              >
                Grant Amount
              </label>
              <button
                type="button"
                class="text-[11px] font-bold text-accent hover:text-accent-hover transition-colors uppercase tracking-wider"
                onclick={() => (configLimitValue = "")}
              >
                Set Unlimited
              </button>
            </div>

            <div class="input-icon-wrapper">
              <input
                id="limitValueConfig"
                name="limitValue"
                type="number"
                placeholder="e.g. 100"
                class="input !h-10 !text-sm !pr-16"
                bind:value={configLimitValue}
              />
              <div
                class="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-text-dim pointer-events-none capitalize"
              >
                {feature?.feature?.unit || "units"}
              </div>
            </div>
          </div>

          <div class="space-y-3 pt-1">
            {#if !showTrialConfig}
              <button
                type="button"
                class="flex items-center gap-2 px-1 text-[11px] font-bold text-accent hover:text-accent-hover transition-colors uppercase tracking-wider"
                onclick={() => (showTrialConfig = true)}
              >
                <Plus size={12} weight="bold" /> Set Different Trial Grant
              </button>
            {:else}
              <div
                class="space-y-2.5 pt-1"
                transition:fly={{ y: 5, duration: 150 }}
              >
                <div class="flex items-center justify-between px-1">
                  <label
                    for="trialLimitValueConfig"
                    class="text-[11px] font-bold text-text-dim uppercase tracking-wider"
                  >
                    Trial Grant Amount
                  </label>
                  <button
                    type="button"
                    class="text-[11px] font-bold text-error/80 hover:text-error transition-colors uppercase tracking-wider"
                    onclick={() => {
                      showTrialConfig = false;
                      configTrialLimitValue = "";
                    }}
                  >
                    Remove
                  </button>
                </div>
                <p class="text-[11px] text-text-muted px-1">
                  Custom limit applied during the trial period only.
                </p>

                <div class="input-icon-wrapper">
                  <input
                    id="trialLimitValueConfig"
                    type="number"
                    placeholder="e.g. 50"
                    class="input !h-10 !text-sm !pr-16"
                    bind:value={configTrialLimitValue}
                  />
                  <div
                    class="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-text-dim pointer-events-none capitalize"
                  >
                    {feature?.feature?.unit || "units"}
                  </div>
                </div>
              </div>
            {/if}
          </div>
        {:else}
          <div class="rounded-lg border border-border bg-bg-card p-4">
            <div class="text-sm font-semibold text-text-primary">
              Usage-based billing
            </div>
            <p class="mt-1 text-xs text-text-muted leading-relaxed">
              Billing starts from the first tracked unit. If you want included
              units before charging, switch to <strong>Included</strong> and set
              overage to
              <strong>Charge</strong>.
            </p>
          </div>
        {/if}

        {#if configUsageModel === "included"}
          <div class="space-y-3 pt-2">
            <div
              class="text-[11px] font-bold text-text-dim uppercase tracking-wider px-1"
            >
              When Limit Exceeded
            </div>
            <div
              class="relative flex bg-bg-card border border-border p-1 rounded-md overflow-hidden isolate"
            >
              <!-- Animated background slider -->
              <div
                class="absolute inset-y-1 rounded-md bg-accent border border-accent-border transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] z-0"
                style="
                  width: calc((100% - 8px) / 2);
                  left: calc(4px + (100% - 8px) / 2 * {configOverage === 'block'
                  ? 0
                  : 1});
                "
              ></div>
              {#each [{ value: "block", label: "Block" }, { value: "charge", label: "Charge" }] as option}
                <button
                  type="button"
                  class="flex-1 py-1.5 text-xs font-bold transition-colors duration-200 relative z-10 {configOverage ===
                  option.value
                    ? 'text-accent-contrast'
                    : 'text-text-muted hover:text-text-primary'}"
                  onclick={() =>
                    (configOverage = option.value as typeof configOverage)}
                >
                  {option.label}
                </button>
              {/each}
            </div>

            {#if configOverage === "charge"}
              <div
                class="space-y-5 p-5 bg-bg-elevated border border-border rounded-lg"
                transition:fly={{ y: 5, duration: 150 }}
              >
                <div class="flex flex-col gap-4">
                  <div>
                    <div class="text-sm font-bold text-text-primary">
                      Overage Pricing
                    </div>
                    <p class="mt-1 text-xs text-text-muted">
                      Applied only after the included grant is exhausted.
                    </p>
                  </div>
                  <div
                    class="relative flex w-fit bg-bg-card border border-border p-1 rounded-md overflow-hidden isolate"
                  >
                    <!-- Animated background slider -->
                    <div
                      class="absolute inset-y-1 rounded-md bg-accent border border-accent-border transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] z-0"
                      style="
                        width: calc((100% - 8px) / 3);
                        left: calc(4px + (100% - 8px) / 3 * {configRatingModel ===
                      'package'
                        ? 0
                        : configRatingModel === 'graduated'
                          ? 1
                          : 2});
                      "
                    ></div>
                    {#each [{ value: "package", label: "Package" }, { value: "graduated", label: "Graduated" }, { value: "volume", label: "Volume" }] as model}
                      <button
                        type="button"
                        class="px-4 py-1.5 text-[11px] font-bold transition-colors duration-200 relative z-10 {configRatingModel ===
                        model.value
                          ? 'text-accent-contrast'
                          : 'text-text-muted hover:text-text-primary'}"
                        onclick={() =>
                          selectRatingModel(model.value as RatingModel)}
                      >
                        {model.label}
                      </button>
                    {/each}
                  </div>
                </div>

                {#if configRatingModel === "package"}
                  <div class="grid grid-cols-2 gap-4">
                    <div>
                      <label
                        for="overagePricePerUnit"
                        class="text-[10px] font-bold text-text-dim uppercase tracking-wider px-1"
                      >
                        Overage Price
                      </label>
                      <div class="input-icon-wrapper">
                        <input
                          id="overagePricePerUnit"
                          type="number"
                          step="0.01"
                          placeholder="5.00"
                          class="input h-9 !text-xs !pl-8"
                          bind:value={configPricePerUnit}
                        />
                        <div
                          class="absolute left-3 top-1/2 -translate-y-1/2 text-[11px] text-text-dim font-medium pointer-events-none"
                        >
                          {getCurrencySymbol()}
                        </div>
                      </div>
                    </div>

                    <div class="space-y-1.5">
                      <label
                        for="overageBillingUnits"
                        class="text-[10px] font-bold text-text-dim uppercase tracking-wider px-1"
                      >
                        Per X Units
                      </label>
                      <input
                        id="overageBillingUnits"
                        type="number"
                        placeholder="1000"
                        class="input h-9 !text-xs"
                        bind:value={configBillingUnits}
                      />
                    </div>
                  </div>
                {:else}
                  <div class="space-y-4 pt-1">
                    <div class="flex items-center justify-between">
                      <div class="text-sm font-semibold text-text-primary">
                        Overage Tiers
                      </div>
                      <button
                        type="button"
                        class="btn btn-secondary btn-sm h-7 px-3 gap-1"
                        onclick={addPricingTier}
                      >
                        <Plus size={12} weight="bold" /> Add Tier
                      </button>
                    </div>

                    <div>
                      <div class="grid grid-cols-[1fr_1fr_1fr_18px] gap-3 px-1">
                        <div
                          class="text-[10px] font-bold text-text-dim uppercase tracking-wider"
                        >
                          Up To
                        </div>
                        <div
                          class="text-[10px] font-bold text-text-dim uppercase tracking-wider"
                        >
                          Unit Price
                        </div>
                        <div
                          class="text-[10px] font-bold text-text-dim uppercase tracking-wider"
                        >
                          Flat Price
                        </div>
                      </div>

                      {#each configTiers as tier, index (tier.id)}
                        <div
                          class="grid grid-cols-[1fr_1fr_1fr_18px] gap-1 items-center group"
                        >
                          <div class="relative">
                            <input
                              type="number"
                              placeholder={index === configTiers.length - 1
                                ? "Infinity"
                                : "1000"}
                              class="input h-9 !text-xs"
                              bind:value={tier.upTo}
                            />
                          </div>
                          <div class="input-icon-wrapper">
                            <input
                              type="number"
                              step="0.01"
                              placeholder="0.50"
                              class="input h-9 !text-xs !pl-7"
                              bind:value={tier.unitPrice}
                            />
                            <div
                              class="absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] text-text-dim font-medium pointer-events-none"
                            >
                              {getCurrencySymbol()}
                            </div>
                          </div>
                          <div class="input-icon-wrapper">
                            <input
                              type="number"
                              step="0.01"
                              placeholder="Optional"
                              class="input h-9 !text-xs !pl-7"
                              bind:value={tier.flatFee}
                            />
                            <div
                              class="absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] text-text-dim font-medium pointer-events-none"
                            >
                              {getCurrencySymbol()}
                            </div>
                          </div>
                          <div class="flex justify-end">
                            {#if configTiers.length > 1}
                              <button
                                type="button"
                                class="p-1.5 text-text-dim hover:text-error hover:bg-error-bg/10 rounded-md transition-all opacity-0 group-hover:opacity-100"
                                onclick={() => removePricingTier(tier.id)}
                              >
                                <Trash size={14} weight="bold" />
                              </button>
                            {/if}
                          </div>
                        </div>
                      {/each}
                    </div>

                    <p class="text-[10px] text-text-muted px-1">
                      Each tier can charge by unit, by flat price, or both.
                    </p>
                    <p class="text-[10px] text-text-muted italic px-1">
                      * {configRatingModel === "graduated"
                        ? "Each tier prices only overage units inside it. Flat price is added once when overage enters that tier."
                        : "All overage units use the reached tier. Flat price can be used on its own for fixed-price overage bands."}
                    </p>
                  </div>
                {/if}

                <div class="space-y-1.5 pt-1">
                  <label
                    for="maxOverageUnits"
                    class="text-[10px] font-bold text-text-dim uppercase tracking-wider px-1"
                  >
                    Max Overage Units
                  </label>
                  <input
                    id="maxOverageUnits"
                    type="number"
                    placeholder="Leave empty for unlimited"
                    class="input h-9 !text-xs"
                    bind:value={configMaxOverageUnits}
                  />
                </div>
              </div>
            {/if}
          </div>
        {/if}

        {#if configUsageModel === "included"}
          <div class="space-y-3">
            <div
              class="text-[11px] font-bold text-text-dim uppercase tracking-wider px-1"
            >
              Reset Window
            </div>
            <div class="grid grid-cols-5 gap-2">
              {#each [{ value: "5min", label: "5 Min" }, { value: "15min", label: "15 Min" }, { value: "30min", label: "30 Min" }, { value: "hourly", label: "Hourly" }, { value: "daily", label: "Daily" }, { value: "weekly", label: "Weekly" }, { value: "monthly", label: "Monthly" }, { value: "quarterly", label: "Quarter" }, { value: "yearly", label: "Yearly" }, { value: "none", label: "One-off" }] as interval}
                <button
                  type="button"
                  class="py-2 text-[10px] font-bold border rounded-md transition-all duration-75 {configResetInterval ===
                  interval.value
                    ? 'bg-accent text-accent-contrast border-accent-border'
                    : 'bg-bg-card text-text-muted border-border hover:border-border-strong hover:text-text-primary'}"
                  onclick={() => (configResetInterval = interval.value)}
                >
                  {interval.label}
                </button>
              {/each}
            </div>
          </div>
        {/if}

        {#if configUsageModel === "included" && configResetInterval !== "none"}
          <div class="space-y-4">
            <div class="flex items-center gap-3">
              <label
                for="configRolloverEnabled"
                class="text-sm flex gap-2 items-center font-medium text-text-primary cursor-pointer group select-none"
              >
                <input
                  id="configRolloverEnabled"
                  type="checkbox"
                  bind:checked={configRolloverEnabled}
                  class="hidden"
                />
                <div
                  class="relative w-4 h-4 rounded border flex items-center justify-center transition-colors {configRolloverEnabled
                    ? 'bg-accent border-accent'
                    : 'border-border group-hover:border-text-dim'}"
                >
                  {#if configRolloverEnabled}
                    <Check
                      size={10}
                      class="text-accent-contrast"
                      weight="fill"
                    />
                  {/if}
                </div>

                Rollover unused balance
              </label>
            </div>
            <p class="text-xs text-text-muted ml-7 -mt-2">
              Carry unused quota to the next period.
            </p>

            {#if configRolloverEnabled}
              <div
                class="p-4 bg-bg-secondary border border-border rounded-lg space-y-2 ml-7"
              >
                <label for="rolloverMaxBalance" class="label">
                  Max Rollover Balance
                </label>
                <input
                  id="rolloverMaxBalance"
                  type="number"
                  placeholder="Leave empty for no cap"
                  class="input"
                  bind:value={configRolloverMaxBalance}
                />
                <p class="text-xs text-text-muted">
                  Cap on how much unused balance can accumulate. Empty = no cap.
                </p>
              </div>
            {/if}
          </div>
        {/if}
      </div>

      <div class="p-6 border-t border-border bg-bg-card sticky bottom-0 z-10">
        <button
          type="submit"
          class="btn btn-primary w-full py-2.5 text-sm"
          disabled={isSaving}
        >
          {#if isSaving}
            <CircleNotch size={18} class="animate-spin" weight="duotone" />
            Saving...
          {:else}
            <FloppyDiskIcon /> Save Configuration
          {/if}
        </button>
      </div>
    </form>
  </div>
</SidePanel>
