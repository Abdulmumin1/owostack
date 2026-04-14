<script lang="ts">
  import {
    CircleNotch,
    CreditCard,
    Lightning,
    ShieldCheck,
    Warning,
  } from "phosphor-svelte";
  import type {
    CustomerBillingConfig,
    CustomerResult,
    WalletResult,
    WalletSetupResult,
    BillingUsageResult,
  } from "owostack";

  import { untrack } from "svelte";

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
    usage,
    customerId,
    currency = "NGN",
  }: {
    billing: CustomerBillingConfig | null;
    wallet: WalletResult | null;
    usage: BillingUsageResult | null;
    customerId: string;
    currency?: string;
  } = $props();

  let currentBilling = $state<CustomerBillingConfig>(emptyBilling());
  let currentWallet = $state<WalletResult>(emptyWallet());
  let featureOverageMode = $state<"inherit" | "block" | "charge">("inherit");
  let spendCapInput = $state("");
  let onLimitReached = $state<"block" | "notify">("block");
  let featureSaving = $state(false);
  let limitSaving = $state(false);
  let walletLoading = $state(false);
  let notice = $state<Notice>(null);

  // Derived state for the switch
  let extraUsageEnabled = $derived(featureOverageMode === "charge");

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

    spendCapInput =
      config.overageLimit?.maxOverageAmount !== null &&
      config.overageLimit?.maxOverageAmount !== undefined
        ? String(config.overageLimit.maxOverageAmount / 100)
        : "";
    onLimitReached = config.overageLimit?.onLimitReached ?? "block";
  }

  function setNotice(tone: NonNullable<Notice>["tone"], message: string) {
    notice = { tone, message };
    if (tone === "success") {
      setTimeout(() => {
        if (notice?.message === message) notice = null;
      }, 5000);
    }
  }

  function formatMoney(minorAmount: number | null | undefined) {
    if (minorAmount === null || minorAmount === undefined) {
      return "0.00";
    }

    return new Intl.NumberFormat("en-NG", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(minorAmount / 100);
  }

  async function parseJson<T>(response: Response): Promise<T> {
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Request failed");
    }
    return payload as T;
  }

  async function toggleExtraUsage() {
    const newMode = extraUsageEnabled ? "block" : "charge";
    featureSaving = true;
    notice = null;

    try {
      const updatedCustomer = await parseJson<CustomerResult>(
        await fetch("/api/customer-config/feature", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            overage: newMode,
            maxOverageUnits: null, // Clear max units when toggling
          }),
        }),
      );

      currentBilling = updatedCustomer.billing;
      syncForms(currentBilling);
      setNotice(
        "success",
        `Extra usage ${newMode === "charge" ? "enabled" : "disabled"}.`,
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

  async function saveOverageLimit() {
    const trimmedSpendCap = spendCapInput.trim();
    let maxOverageAmount: number | null = null;

    if (trimmedSpendCap !== "") {
      const parsedSpendCap = Number.parseFloat(trimmedSpendCap);
      if (!Number.isFinite(parsedSpendCap) || parsedSpendCap < 0) {
        setNotice("error", "Spend cap must be a valid amount.");
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
      setNotice("success", "Extra usage spend cap saved.");
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
    const b = billing ?? emptyBilling();
    const w = wallet ?? emptyWallet();
    untrack(() => {
      currentBilling = b;
      currentWallet = w;
      syncForms(currentBilling);
    });
  });
</script>

<div class="space-y-8 max-w-5xl mx-auto">
  {#if notice}
    <div
      class={`rounded-md border px-5 py-4 text-sm font-medium transition-all ${
        notice.tone === "success"
          ? "border-secondary/30 bg-secondary/5 text-secondary"
          : notice.tone === "error"
            ? "border-error/30 bg-error/5 text-error"
            : "border-info/30 bg-info/5 text-info"
      }`}
    >
      {notice.message}
    </div>
  {/if}

  <!-- Payment Method Section -->
  <section class="card border border-white/5 overflow-hidden">
    <div class="p-6 border-b border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div class="flex items-center gap-3">
        <div class="p-2 bg-accent/10 rounded-lg">
          <CreditCard size={20} class="text-accent" />
        </div>
        <div>
          <h2 class="text-base font-semibold text-text-primary">Payment Method</h2>
          <p class="text-xs text-text-muted mt-0.5">Manage the payment method for extra usage charges.</p>
        </div>
      </div>
      <div>
        <button
          class="btn {currentWallet.hasCard ? 'btn-secondary' : 'btn-primary'} h-10 px-5 text-xs font-semibold uppercase tracking-wider w-full sm:w-auto"
          disabled={walletLoading}
          onclick={startWalletSetup}
        >
          {#if walletLoading}
            <CircleNotch size={16} class="animate-spin mr-2" />
            Preparing...
          {:else if currentWallet.hasCard}
            Update Method
          {:else}
            Add Method
          {/if}
        </button>
      </div>
    </div>
    
    <div class="p-6 bg-white/[0.01]">
      <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6">
        <div class="space-y-1">
          <span class="text-[10px] font-bold uppercase tracking-widest text-text-muted">Status</span>
          <p class="text-sm font-medium text-text-primary flex items-center gap-2">
            {#if currentWallet.hasCard && currentWallet.card}
              <span class="w-2 h-2 rounded-full bg-secondary"></span>
              {currentWallet.card.brand} •••• {currentWallet.card.last4}
            {:else}
              <span class="w-2 h-2 rounded-full bg-text-muted"></span>
              No card on file
            {/if}
          </p>
        </div>
        <div class="space-y-1">
          <span class="text-[10px] font-bold uppercase tracking-widest text-text-muted">Customer ID</span>
          <p class="text-sm font-mono text-text-secondary truncate">{customerId}</p>
        </div>
        <div class="space-y-1">
          <span class="text-[10px] font-bold uppercase tracking-widest text-text-muted">Charge Testing</span>
          <p class="text-sm font-medium {currentWallet.hasCard ? 'text-secondary' : 'text-warning'}">
            {currentWallet.hasCard ? "Ready" : "Needs payment method"}
          </p>
        </div>
        <div class="space-y-1">
          <span class="text-[10px] font-bold uppercase tracking-widest text-text-muted">Extra Usage Balance</span>
          <p class="text-sm font-medium text-text-primary">
             <span class="font-mono">{currency}</span> {formatMoney(usage?.totalEstimated ?? 0)}
          </p>
        </div>
      </div>
    </div>
  </section>

  <!-- Simplified Extra Usage Controls -->
  <section class="card border border-white/5 overflow-hidden">
    <div class="p-6 border-b border-white/5">
      <div class="flex items-center justify-between gap-4">
        <div class="flex items-center gap-3">
          <div class="p-2 bg-accent/10 rounded-lg">
            <Lightning size={20} class="text-accent" />
          </div>
          <div>
            <h3 class="text-base font-semibold text-text-primary">Extra Usage</h3>
            <p class="text-xs text-text-muted mt-0.5">Enable and configure extra usage when your plan limits are exceeded.</p>
          </div>
        </div>
        
        <label class="relative inline-flex items-center cursor-pointer group">
          <input 
            type="checkbox" 
            class="sr-only peer"
            checked={extraUsageEnabled}
            disabled={featureSaving}
            onchange={toggleExtraUsage}
          />
          <div class="w-11 h-6 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-accent group-hover:bg-white/20 peer-checked:group-hover:bg-accent/80"></div>
          {#if featureSaving}
             <CircleNotch size={14} class="animate-spin ml-3 text-text-muted" />
          {/if}
        </label>
      </div>
    </div>

    {#if extraUsageEnabled && !currentWallet.hasCard}
      <div class="px-6 py-4 border-b border-white/5 bg-warning/5 text-warning flex items-center gap-3">
        <Warning size={18} />
        <span class="text-sm">
          You must add a payment method above for extra usage to actually work. Otherwise usage will be blocked.
        </span>
      </div>
    {/if}

    <div class="p-6 bg-white/[0.01] flex flex-col md:flex-row md:items-end gap-6 border-b border-white/5 transition-all {extraUsageEnabled ? 'opacity-100' : 'opacity-50 pointer-events-none grayscale'}">
      <label class="flex-1 space-y-2 block">
        <span class="text-[11px] font-semibold uppercase tracking-wider text-text-primary flex items-center gap-2">
          <ShieldCheck size={14} class="text-text-muted" />
          Spend Guardrail ({currency})
        </span>
        <div class="flex">
           <span class="inline-flex items-center px-4 rounded-l-sm border border-r-0 border-white/5 bg-black/20 text-text-muted font-mono text-sm">
             {currency}
           </span>
           <input
             bind:value={spendCapInput}
             class="input w-full rounded-l-none bg-black/20"
             inputmode="decimal"
             placeholder="Leave blank to remove limit"
             disabled={!extraUsageEnabled}
           />
        </div>
      </label>

      <div class="flex gap-3">
        <button
          class="btn btn-primary h-10 px-5 text-xs font-semibold uppercase tracking-wider"
          disabled={limitSaving || !extraUsageEnabled}
          onclick={saveOverageLimit}
        >
          {#if limitSaving}
            <CircleNotch size={16} class="animate-spin mr-2" />
            Saving...
          {:else}
            Save Limit
          {/if}
        </button>
        {#if spendCapInput || currentBilling.overageLimit?.maxOverageAmount !== null}
          <button
            class="btn btn-secondary h-10 px-5 text-xs font-semibold uppercase tracking-wider"
            disabled={limitSaving || !extraUsageEnabled}
            onclick={clearOverageLimit}
          >
            Clear
          </button>
        {/if}
      </div>
    </div>
  </section>

  <section class="card border border-white/5 overflow-hidden">
    <div class="p-6 border-b border-white/5 flex items-center gap-3">
      <div class="p-2 bg-accent/10 rounded-lg">
        <Warning size={20} class="text-accent" />
      </div>
      <h3 class="text-base font-semibold text-text-primary">How To Test</h3>
    </div>
    <div class="p-6 bg-white/[0.01]">
      <ol class="space-y-3 text-sm text-text-muted leading-relaxed list-decimal pl-5 marker:text-text-secondary">
        <li class="pl-2">Save a payment method to allow extra usage charges.</li>
        <li class="pl-2">Toggle the <span class="text-text-primary font-semibold">Extra Usage</span> switch to enable it.</li>
        <li class="pl-2">Set a small spend guardrail (e.g. 50 NGN) to force the limit to be reached quickly.</li>
        <li class="pl-2">Go back to the chat tab and keep sending prompts until the included credits are exhausted and extra usage charges begin.</li>
      </ol>
    </div>
  </section>
</div>
