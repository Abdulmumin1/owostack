<script lang="ts">
  import { Result } from "better-result";
  import { apiFetch } from "$lib/auth-client";
  import SidePanel from "$lib/components/ui/SidePanel.svelte";
  import { Loader2, Check, Coins, Plus, CheckCircle } from "lucide-svelte";
  import { defaultCurrency } from "$lib/stores/currency";
  import { formatCurrency, COMMON_CURRENCIES } from "$lib/utils/currency";
  import { SUPPORTED_PROVIDERS } from "$lib/providers";

  let { 
    isOpen = $bindable(false), 
    organizationId,
    onclose = () => {}, 
    onsuccess = (data?: any) => {} 
  }: {
    isOpen: boolean;
    organizationId: string;
    onclose?: () => void;
    onsuccess?: (data?: any) => void;
  } = $props();

  let name = $state("");
  let description = $state("");
  let credits = $state(100);
  let price = $state(500);
  let currency = $state($defaultCurrency);
  let creditSystemId = $state("");
  let selectedProviderId = $state("");
  let creditSystems = $state<any[]>([]);
  let connectedProviders = $state<any[]>([]);
  let loadingSystems = $state(false);
  let isCreating = $state(false);
  let error = $state("");

  let uniqueProviderIds = $derived([...new Set(connectedProviders.map((p: any) => p.providerId))]);

  let selectedProviderConfig = $derived(
    SUPPORTED_PROVIDERS.find((p) => p.id === selectedProviderId),
  );

  let availableCurrencies = $derived(
    selectedProviderConfig?.supportedCurrencies
      ? COMMON_CURRENCIES.filter((c) =>
          selectedProviderConfig!.supportedCurrencies!.includes(c.code),
        )
      : COMMON_CURRENCIES,
  );

  // Reset currency when provider changes if current currency isn't supported
  $effect(() => {
    if (selectedProviderConfig?.supportedCurrencies) {
      if (!selectedProviderConfig.supportedCurrencies.includes(currency)) {
        currency = selectedProviderConfig.supportedCurrencies[0] || "USD";
      }
    }
  });

  // Load credit systems + providers when panel opens
  $effect(() => {
    if (isOpen && organizationId) {
      loadData();
    }
  });

  async function loadData() {
    loadingSystems = true;
    try {
      const [credRes, provRes] = await Promise.all([
        apiFetch(`/api/dashboard/credits?organizationId=${organizationId}`),
        apiFetch(`/api/dashboard/providers/accounts?organizationId=${organizationId}`),
      ]);
      if (credRes.data?.success) creditSystems = credRes.data.data || [];
      if (Array.isArray(provRes.data?.data)) {
        connectedProviders = provRes.data.data;
        if (!selectedProviderId && connectedProviders.length > 0) {
          selectedProviderId = connectedProviders[0].providerId;
        }
      }
    } catch { /* ignore */ }
    loadingSystems = false;
  }

  function close() {
    isOpen = false;
    name = "";
    description = "";
    credits = 100;
    price = 500;
    currency = $defaultCurrency;
    creditSystemId = "";
    error = "";
    onclose?.();
  }

  function formatPreview(amount: number, curr: string) {
    try {
      return formatCurrency(amount, curr);
    } catch {
      return `${amount / 100} ${curr}`;
    }
  }

  async function handleSubmit() {
    if (!name) {
      error = "Name is required";
      return;
    }
    if (credits < 1) {
      error = "Credits must be at least 1";
      return;
    }
    if (!creditSystemId) {
      error = "Credit system is required — every add-on pack must be attached to a credit system";
      return;
    }
    if (!selectedProviderId) {
      error = "Payment provider is required";
      return;
    }

    isCreating = true;
    error = "";

    const result = await Result.tryPromise(async () => {
      const res = await apiFetch("/api/dashboard/credit-packs", {
        method: "POST",
        body: JSON.stringify({
          organizationId,
          name,
          description: description || undefined,
          credits,
          price,
          currency,
          creditSystemId,
          providerId: selectedProviderId,
        }),
      });

      if (res.error) {
        throw new Error(res.error.message || "Failed to create credit pack");
      }

      if (res.data?.success === false) {
        throw new Error(res.data?.error || "Failed to create credit pack");
      }

      return res.data?.data;
    });

    if (result.isErr()) {
      error = result.error.message;
      isCreating = false;
      return;
    }

    isCreating = false;
    onsuccess?.(result.value);
    close();
  }
</script>

<SidePanel open={isOpen} title="Create Credit Pack" onclose={close} width="max-w-md">
  <div class="text-sm">
    <div class="p-5 space-y-6">
      {#if error}
        <div class="bg-red-500/10 p-4 border border-red-500/20">
          <p class="text-xs font-medium text-red-600 dark:text-red-500">{error}</p>
        </div>
      {/if}

      <div class="space-y-5">
        <!-- Provider Selection -->
        {#if uniqueProviderIds.length > 1}
          <div>
            <div class="text-xs font-bold text-text-secondary uppercase tracking-widest mb-2">
              Payment Provider <span class="normal-case text-red-500">*</span>
            </div>
            <div class="grid grid-cols-{Math.min(uniqueProviderIds.length, 3)} gap-2">
              {#each uniqueProviderIds as pid}
                {@const provConfig = SUPPORTED_PROVIDERS.find((p) => p.id === pid)}
                {#if provConfig}
                  <button
                    type="button"
                    class="relative border rounded-lg p-3 text-left transition-all {selectedProviderId === pid
                      ? 'border-accent bg-accent/5'
                      : 'border-border bg-bg-primary hover:border-text-dim'}"
                    onclick={() => (selectedProviderId = pid)}
                  >
                    <div class="text-xs font-bold text-text-primary">{provConfig.name}</div>
                    <div class="text-[10px] text-text-dim mt-0.5 truncate">{provConfig.description}</div>
                    {#if selectedProviderId === pid}
                      <div class="absolute top-2 right-2 w-2 h-2 rounded-full bg-accent"></div>
                    {/if}
                  </button>
                {/if}
              {/each}
            </div>
          </div>
        {/if}

        <!-- Name -->
        <div>
          <label
            for="pack-name"
            class="block text-xs font-bold text-text-secondary uppercase tracking-widest mb-2"
          >
            Name
          </label>
          <div class="input-icon-wrapper">
            <input
              type="text"
              id="pack-name"
              bind:value={name}
              class="input"
              placeholder="e.g. 50 Extra Credits"
            />
          </div>
        </div>

        <!-- Description -->
        <div>
          <label
            for="pack-desc"
            class="block text-xs font-bold text-text-secondary uppercase tracking-widest mb-2"
          >
            Description
          </label>
          <div class="input-icon-wrapper">
            <input
              type="text"
              id="pack-desc"
              bind:value={description}
              class="input"
              placeholder="Optional description"
            />
          </div>
        </div>

        <!-- Credits -->
        <div>
          <label
            for="pack-credits"
            class="block text-xs font-bold text-text-secondary uppercase tracking-widest mb-2"
          >
            Credits
          </label>
          <div class="input-icon-wrapper">
            <input
              type="number"
              id="pack-credits"
              bind:value={credits}
              min="1"
              class="input"
              placeholder="100"
            />
          </div>
          <p class="mt-1.5 text-[10px] text-text-dim">Number of credits the customer receives per pack.</p>
        </div>

        <!-- Price + Currency -->
        <div class="grid grid-cols-3 gap-3">
          <div class="col-span-2">
            <label
              for="pack-price"
              class="block text-xs font-bold text-text-secondary uppercase tracking-widest mb-2"
            >
              Price <span class="normal-case text-text-dim">({currency} smallest unit)</span>
            </label>
            <div class="input-icon-wrapper">
              <input
                type="number"
                id="pack-price"
                bind:value={price}
                min="0"
                class="input"
                placeholder="500"
              />
            </div>
          </div>
          <div>
            <label
              for="pack-currency"
              class="block text-xs font-bold text-text-secondary uppercase tracking-widest mb-2"
            >
              Currency
            </label>
            <select
              id="pack-currency"
              bind:value={currency}
              class="input"
            >
              {#each availableCurrencies as c}
                <option value={c.code}>{c.code}</option>
              {/each}
            </select>
          </div>
        </div>

        <!-- Credit System (required) -->
        <div>
          <label
            for="pack-scope"
            class="block text-xs font-bold text-text-secondary uppercase tracking-widest mb-2"
          >
            Credit System <span class="normal-case text-red-500">*</span>
          </label>
          {#if loadingSystems}
            <div class="text-xs text-text-dim py-2">Loading credit systems…</div>
          {:else if creditSystems.length === 0}
            <div class="bg-amber-500/10 border border-amber-500/20 rounded p-3">
              <p class="text-[11px] text-amber-600 dark:text-amber-400">No credit systems found. Create a credit system first before adding credit packs.</p>
            </div>
          {:else}
            <select
              id="pack-scope"
              bind:value={creditSystemId}
              class="w-full bg-bg-primary border border-border rounded px-3 py-2.5 text-sm text-text-primary focus:border-accent focus:outline-none appearance-none"
            >
              <option value="" disabled>Select a credit system…</option>
              {#each creditSystems as cs}
                <option value={cs.id}>{cs.name}</option>
              {/each}
            </select>
            <p class="mt-1.5 text-[10px] text-text-dim">
              Add-on credits will be scoped to this credit system.
            </p>
          {/if}
        </div>

        <!-- Preview -->
        {#if name && credits > 0}
          <div class="bg-bg-primary border border-border rounded-lg p-4">
            <p class="text-[10px] font-bold text-text-secondary uppercase tracking-widest mb-2">Preview</p>
            <p class="text-sm text-text-primary font-medium">{name}</p>
            <p class="text-xs text-text-dim mt-1">
              {credits} credits for {formatPreview(price, currency)}
              {#if creditSystemId}
                <span class="text-amber-600 dark:text-amber-400">→ {creditSystems.find(cs => cs.id === creditSystemId)?.name}</span>
              {/if}
            </p>
          </div>
        {/if}
      </div>
    </div>

    <!-- Footer -->
    <div class="p-5 border-t border-border flex items-center justify-end gap-3 sticky bottom-0 bg-bg-secondary">
      <button
        class="px-4 py-2 text-xs font-bold text-text-dim hover:text-text-primary transition-colors uppercase tracking-widest"
        onclick={close}
      >
        Cancel
      </button>
      <button
        class="px-6 py-2 bg-accent hover:bg-accent-hover text-accent-contrast text-xs font-bold rounded-md transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-widest"
        onclick={handleSubmit}
        disabled={!name || credits < 1 || !creditSystemId || !selectedProviderId || isCreating}
      >
        {#if isCreating}
          <Loader2 size={14} class="animate-spin" />
          Creating...
        {:else}
          <Check size={14} />
          Create Pack
        {/if}
      </button>
    </div>
  </div>
</SidePanel>
