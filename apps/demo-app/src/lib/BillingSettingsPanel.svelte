<script lang="ts">
  import {
    CircleNotch,
    CreditCard,
    Lightning,
    ShieldCheck,
    SlidersHorizontal,
    Warning,
  } from "phosphor-svelte";
  import type {
    CustomerBillingConfig,
    CustomerResult,
    WalletResult,
    WalletSetupResult,
  } from "owostack";

  type Notice = {
    tone: "success" | "error" | "info";
    message: string;
  } | null;

  const emptyBilling = (): CustomerBillingConfig => ({
    overageLimit: null,
    featureConfigs: [],
  });

  const emptyWallet = (): WalletResult => ({
    hasCard: false,
    card: null,
    methods: [],
  });

  let {
    billing,
    wallet,
    customerId,
    currency = "NGN",
  }: {
    billing: CustomerBillingConfig | null;
    wallet: WalletResult | null;
    customerId: string;
    currency?: string;
  } = $props();

  let currentBilling = $state<CustomerBillingConfig>(emptyBilling());
  let currentWallet = $state<WalletResult>(emptyWallet());
  let featureOverageMode = $state<"inherit" | "block" | "charge">("inherit");
  let maxOverageUnitsInput = $state("");
  let spendCapInput = $state("");
  let onLimitReached = $state<"block" | "notify">("block");
  let featureSaving = $state(false);
  let limitSaving = $state(false);
  let walletLoading = $state(false);
  let notice = $state<Notice>(null);

  function getAiCreditsConfig(config: CustomerBillingConfig) {
    return (
      config.featureConfigs.find(
        (item) => item.feature.slug === "ai-credits" || item.feature.id === "ai-credits",
      ) ?? null
    );
  }

  function syncForms(config: CustomerBillingConfig) {
    const aiCreditsConfig = getAiCreditsConfig(config);

    featureOverageMode = aiCreditsConfig?.overage ?? "inherit";
    maxOverageUnitsInput =
      aiCreditsConfig?.maxOverageUnits !== null &&
      aiCreditsConfig?.maxOverageUnits !== undefined
        ? String(aiCreditsConfig.maxOverageUnits)
        : "";

    spendCapInput =
      config.overageLimit?.maxOverageAmount !== null &&
      config.overageLimit?.maxOverageAmount !== undefined
        ? String(config.overageLimit.maxOverageAmount / 100)
        : "";
    onLimitReached = config.overageLimit?.onLimitReached ?? "block";
  }

  function setNotice(tone: NonNullable<Notice>["tone"], message: string) {
    notice = { tone, message };
  }

  function formatMoney(minorAmount: number | null | undefined) {
    if (minorAmount === null || minorAmount === undefined) {
      return "Not set";
    }

    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(minorAmount / 100);
  }

  function describeFeatureMode(mode: "inherit" | "block" | "charge") {
    if (mode === "inherit") return "Plan default";
    return mode === "charge" ? "Charge overage" : "Block overage";
  }

  async function parseJson<T>(response: Response): Promise<T> {
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Request failed");
    }
    return payload as T;
  }

  async function saveFeatureConfig() {
    const trimmedUnits = maxOverageUnitsInput.trim();
    const maxOverageUnits =
      trimmedUnits === "" ? null : Number.parseInt(trimmedUnits, 10);

    if (
      maxOverageUnits !== null &&
      (!Number.isInteger(maxOverageUnits) || maxOverageUnits <= 0)
    ) {
      setNotice("error", "Max overage units must be a positive whole number.");
      return;
    }

    featureSaving = true;
    notice = null;

    try {
      const updatedCustomer = await parseJson<CustomerResult>(
        await fetch("/api/customer-config/feature", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            overage: featureOverageMode === "inherit" ? null : featureOverageMode,
            maxOverageUnits,
          }),
        }),
      );

      currentBilling = updatedCustomer.billing;
      syncForms(currentBilling);
      setNotice(
        "success",
        "AI credits overage settings saved for this customer.",
      );
    } catch (error: any) {
      setNotice(
        "error",
        error.message || "Failed to save feature billing settings.",
      );
    } finally {
      featureSaving = false;
    }
  }

  async function clearFeatureConfig() {
    featureOverageMode = "inherit";
    maxOverageUnitsInput = "";
    await saveFeatureConfig();
  }

  async function saveOverageLimit() {
    const trimmedSpendCap = spendCapInput.trim();
    let maxOverageAmount: number | null = null;

    if (trimmedSpendCap !== "") {
      const parsedSpendCap = Number.parseFloat(trimmedSpendCap);
      if (!Number.isFinite(parsedSpendCap) || parsedSpendCap <= 0) {
        setNotice("error", "Spend cap must be a positive amount.");
        return;
      }
      maxOverageAmount = Math.round(parsedSpendCap * 100);
    }

    limitSaving = true;
    notice = null;

    try {
      const updatedCustomer = await parseJson<CustomerResult>(
        await fetch("/api/customer-config/overage-limit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            maxOverageAmount,
            onLimitReached,
          }),
        }),
      );

      currentBilling = updatedCustomer.billing;
      syncForms(currentBilling);
      setNotice("success", "Customer overage spend guardrail saved.");
    } catch (error: any) {
      setNotice(
        "error",
        error.message || "Failed to save customer overage limit.",
      );
    } finally {
      limitSaving = false;
    }
  }

  async function clearOverageLimit() {
    spendCapInput = "";
    onLimitReached = "block";
    await saveOverageLimit();
  }

  async function startWalletSetup() {
    walletLoading = true;
    notice = null;

    try {
      const setup = await parseJson<WalletSetupResult>(
        await fetch("/api/wallet/setup", {
          method: "POST",
        }),
      );

      window.location.href = setup.url;
    } catch (error: any) {
      setNotice(
        "error",
        error.message || "Failed to create payment-method setup session.",
      );
      walletLoading = false;
    }
  }

  $effect(() => {
    currentBilling = billing ?? emptyBilling();
    currentWallet = wallet ?? emptyWallet();
    syncForms(currentBilling);
  });
</script>

<div class="space-y-6">
  <div class="grid grid-cols-1 xl:grid-cols-3 gap-4">
    <section class="card border-white/5 space-y-3">
      <div class="flex items-center gap-2">
        <CreditCard size={16} class="text-accent" />
        <h2 class="text-[10px] font-bold uppercase tracking-widest text-text-muted">
          Wallet Readiness
        </h2>
      </div>

      <div class="space-y-2">
        <p class="text-sm font-bold text-text-primary">
          {#if currentWallet.hasCard && currentWallet.card}
            {currentWallet.card.brand} ending in {currentWallet.card.last4}
          {:else}
            No payment method on file
          {/if}
        </p>
        <p class="text-[11px] text-text-muted leading-relaxed">
          Chargeable overage only works when this customer has a saved payment
          method.
        </p>
      </div>

      <div class="flex items-center justify-between text-[10px] uppercase tracking-widest text-text-muted">
        <span>Customer</span>
        <span class="font-mono text-text-secondary">{customerId}</span>
      </div>

      <div class="flex items-center justify-between text-[10px] uppercase tracking-widest text-text-muted">
        <span>Saved Methods</span>
        <span class="text-text-secondary">{currentWallet.methods.length}</span>
      </div>

      <button
        class="btn {currentWallet.hasCard ? 'btn-secondary' : 'btn-primary'} w-full justify-center h-10 uppercase tracking-widest"
        disabled={walletLoading}
        onclick={startWalletSetup}
      >
        {#if walletLoading}
          <CircleNotch size={14} class="animate-spin" />
          Preparing...
        {:else if currentWallet.hasCard}
          Update Payment Method
        {:else}
          Add Payment Method
        {/if}
      </button>
    </section>

    <section class="card border-white/5 space-y-3">
      <div class="flex items-center gap-2">
        <Lightning size={16} class="text-accent" />
        <h2 class="text-[10px] font-bold uppercase tracking-widest text-text-muted">
          AI Credits Override
        </h2>
      </div>

      <p class="text-sm font-bold text-text-primary">
        {describeFeatureMode(featureOverageMode)}
      </p>

      <div class="space-y-2 text-[11px] text-text-muted">
        <div class="flex items-center justify-between gap-4">
          <span>Current overage mode</span>
          <span class="text-text-secondary">
            {describeFeatureMode(featureOverageMode)}
          </span>
        </div>
        <div class="flex items-center justify-between gap-4">
          <span>Current hard cap</span>
          <span class="text-text-secondary">
            {maxOverageUnitsInput || "Not set"}
          </span>
        </div>
      </div>
    </section>

    <section class="card border-white/5 space-y-3">
      <div class="flex items-center gap-2">
        <ShieldCheck size={16} class="text-accent" />
        <h2 class="text-[10px] font-bold uppercase tracking-widest text-text-muted">
          Spend Guardrail
        </h2>
      </div>

      <p class="text-sm font-bold text-text-primary">
        {formatMoney(currentBilling.overageLimit?.maxOverageAmount)}
      </p>

      <div class="space-y-2 text-[11px] text-text-muted">
        <div class="flex items-center justify-between gap-4">
          <span>Breach behavior</span>
          <span class="text-text-secondary uppercase">
            {currentBilling.overageLimit?.onLimitReached ?? "block"}
          </span>
        </div>
        <div class="flex items-center justify-between gap-4">
          <span>Charge testing</span>
          <span class={currentWallet.hasCard ? "text-secondary" : "text-warning"}>
            {currentWallet.hasCard ? "Ready" : "Needs payment method"}
          </span>
        </div>
      </div>
    </section>
  </div>

  {#if notice}
    <div
      class={`rounded-sm border px-4 py-3 text-[11px] font-bold uppercase tracking-widest ${
        notice.tone === "success"
          ? "border-secondary/20 bg-secondary-light/20 text-secondary"
          : notice.tone === "error"
            ? "border-error/20 bg-error-bg/20 text-error"
            : "border-info/20 bg-info-bg/20 text-info"
      }`}
    >
      {notice.message}
    </div>
  {/if}

  <div class="grid grid-cols-1 xl:grid-cols-2 gap-6">
    <section class="card border-white/5 space-y-5">
      <div class="flex items-center gap-2">
        <SlidersHorizontal size={16} class="text-accent" />
        <div>
          <h3 class="text-sm font-bold text-text-primary">AI Credits Feature Config</h3>
          <p class="text-[11px] text-text-muted">
            Override overage behavior for the demo app&apos;s metered feature.
          </p>
        </div>
      </div>

      <label class="space-y-1.5 block">
        <span class="text-[10px] font-bold uppercase tracking-widest text-text-muted">
          Overage Mode
        </span>
        <select bind:value={featureOverageMode} class="input">
          <option value="inherit">Plan default</option>
          <option value="block">Block</option>
          <option value="charge">Charge</option>
        </select>
      </label>

      <label class="space-y-1.5 block">
        <span class="text-[10px] font-bold uppercase tracking-widest text-text-muted">
          Hard Overage Unit Cap
        </span>
        <input
          bind:value={maxOverageUnitsInput}
          class="input"
          inputmode="numeric"
          placeholder="Leave blank to inherit"
        />
      </label>

      {#if featureOverageMode === "charge" && !currentWallet.hasCard}
        <div class="rounded-sm border border-warning/20 bg-warning-bg/20 px-3 py-2 text-[11px] text-warning flex items-start gap-2">
          <Warning size={14} class="mt-0.5 shrink-0" />
          <span>
            Save a payment method before testing chargeable overage. Otherwise
            the check path will still block usage.
          </span>
        </div>
      {/if}

      <div class="flex gap-2">
        <button
          class="btn btn-primary h-10 uppercase tracking-widest"
          disabled={featureSaving}
          onclick={saveFeatureConfig}
        >
          {#if featureSaving}
            <CircleNotch size={14} class="animate-spin" />
            Saving...
          {:else}
            Save Feature Config
          {/if}
        </button>
        <button
          class="btn btn-secondary h-10 uppercase tracking-widest"
          disabled={featureSaving}
          onclick={clearFeatureConfig}
        >
          Clear Override
        </button>
      </div>
    </section>

    <section class="card border-white/5 space-y-5">
      <div class="flex items-center gap-2">
        <ShieldCheck size={16} class="text-accent" />
        <div>
          <h3 class="text-sm font-bold text-text-primary">Customer Overage Limit</h3>
          <p class="text-[11px] text-text-muted">
            Cap total overage spend for this customer across billable usage.
          </p>
        </div>
      </div>

      <label class="space-y-1.5 block">
        <span class="text-[10px] font-bold uppercase tracking-widest text-text-muted">
          Max Overage Spend ({currency})
        </span>
        <input
          bind:value={spendCapInput}
          class="input"
          inputmode="decimal"
          placeholder="Leave blank to remove the spend cap"
        />
      </label>

      <label class="space-y-1.5 block">
        <span class="text-[10px] font-bold uppercase tracking-widest text-text-muted">
          On Limit Reached
        </span>
        <select bind:value={onLimitReached} class="input">
          <option value="block">Block</option>
          <option value="notify">Notify</option>
        </select>
      </label>

      <div class="flex gap-2">
        <button
          class="btn btn-primary h-10 uppercase tracking-widest"
          disabled={limitSaving}
          onclick={saveOverageLimit}
        >
          {#if limitSaving}
            <CircleNotch size={14} class="animate-spin" />
            Saving...
          {:else}
            Save Guardrail
          {/if}
        </button>
        <button
          class="btn btn-secondary h-10 uppercase tracking-widest"
          disabled={limitSaving}
          onclick={clearOverageLimit}
        >
          Clear Guardrail
        </button>
      </div>
    </section>
  </div>

  <section class="card border-white/5 space-y-3">
    <div class="flex items-center gap-2">
      <Warning size={16} class="text-accent" />
      <h3 class="text-sm font-bold text-text-primary">How To Test</h3>
    </div>

    <ol class="space-y-2 text-[11px] text-text-muted leading-relaxed list-decimal pl-4">
      <li>Save a payment method if you want to test chargeable overage.</li>
      <li>Set AI Credits overage mode to <span class="text-text-primary font-bold">Charge</span> or <span class="text-text-primary font-bold">Block</span>.</li>
      <li>Set a low hard overage unit cap or a small spend guardrail to force the failure path quickly.</li>
      <li>Go back to the chat tab and keep sending prompts until the included credits are exhausted.</li>
    </ol>
  </section>
</div>
