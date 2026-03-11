<script lang="ts">
  import { Owostack } from "owostack";

  let secretKey = $state("");
  let apiUrl = $state("http://localhost:8787/api/v1");
  let userId = $state("");
  let email = $state("");
  let logs = $state<string[]>([]);

  // Attach State
  let planId = $state("");
  let attachResult = $state<any>(null);

  // Metering State
  let featureId = $state("api-calls");
  let trackAmount = $state(1);

  // Add-on Credits State
  let packSlug = $state("");
  let packQuantity = $state(1);
  let addonResult = $state<any>(null);
  let addonBalanceResult = $state<any>(null);

  // Wallet State
  let walletResult = $state<any>(null);
  let walletSetupResult = $state<any>(null);
  let walletProvider = $state("");

  // Billing State
  let unbilledUsage = $state<any>(null);
  let invoiceResult = $state<any>(null);
  let invoicesList = $state<any[]>([]);

  // Initialize SDK
  // In a real app, this would happen server-side or with a public key
  let owo = $derived(new Owostack({ secretKey, apiUrl }));

  function log(msg: string, data?: any) {
    const time = new Date().toLocaleTimeString();
    const entry = `[${time}] ${msg} ${data ? JSON.stringify(data) : ""}`;
    logs = [entry, ...logs];
    console.log(msg, data);
  }

  async function handleAttach() {
    if (!userId || !planId) return alert("User ID & Plan required");
    log(`Attaching plan ${planId} to ${userId}...`);

    try {
      const res = await owo.attach({
        customer: userId,
        product: planId, // SDK maps product -> feature/plan
        callbackUrl: window.location.href,
        metadata: { source: "simulation_demo" },
      });
      attachResult = res;
      log("Attach Success:", res);
    } catch (e: any) {
      log("Attach Failed:", e.message);
    }
  }

  async function handleGetWallet() {
    if (!userId) return alert("User ID required");
    log(`Fetching wallet for ${userId}...`);

    try {
      const res = await owo.wallet(userId);
      walletResult = res;
      log("Wallet:", res);
    } catch (e: any) {
      log("Wallet Failed:", e.message);
    }
  }

  async function handleSetupCard() {
    if (!userId) return alert("User ID required");
    log(`Setting up payment method for ${userId}...`);
    walletSetupResult = null;

    try {
      const res = await owo.wallet.setup(userId, {
        callbackUrl: window.location.href,
        ...(walletProvider ? { provider: walletProvider } : {}),
      });
      walletSetupResult = res;
      log("Wallet Setup:", res);
    } catch (e: any) {
      log("Wallet Setup Failed:", e.message);
    }
  }

  async function handleRemoveCard(methodId: string) {
    if (!userId) return alert("User ID required");
    log(`Removing payment method ${methodId}...`);

    try {
      const res = await owo.wallet.remove(userId, methodId);
      log("Removed:", res);
      await handleGetWallet();
    } catch (e: any) {
      log("Remove Failed:", e.message);
    }
  }

  async function handleCheck() {
    if (!userId || !featureId) return alert("User ID & Feature required");
    log(`Checking access for ${featureId}...`);

    try {
      const res = await owo.check({
        customer: userId,
        feature: featureId,
        ...(email ? { customerData: { email } } : {}),
      });
      log("Check Result:", res);
    } catch (e: any) {
      log("Check Failed:", e.message);
    }
  }

  async function handleTrack() {
    if (!userId || !featureId) return alert("User ID & Feature required");
    log(`Tracking ${trackAmount} units for ${featureId}...`);

    try {
      const res = await owo.track({
        customer: userId,
        feature: featureId,
        value: trackAmount,
        ...(email ? { customerData: { email } } : {}),
      });
      log("Track Result:", res);
    } catch (e: any) {
      log("Track Failed:", e.message);
    }
  }

  async function handleGetUnbilledUsage() {
    if (!userId) return alert("User ID required");
    log(`Fetching unbilled usage for ${userId}...`);

    try {
      const res = await owo.billing.usage({ customer: userId });
      unbilledUsage = res;
      log("Unbilled Usage:", res);
    } catch (e: any) {
      log("Usage Failed:", e.message);
    }
  }

  async function handleBuyAddon() {
    if (!userId || !packSlug) return alert("User ID & Pack slug required");
    log(`Buying ${packQuantity}x '${packSlug}' for ${userId}...`);

    try {
      const res = await owo.addon({
        customer: userId,
        pack: packSlug,
        quantity: packQuantity,
      });
      addonResult = res;
      log(
        res.success ? "Addon Purchase Success:" : "Addon Purchase Failed:",
        res,
      );
    } catch (e: any) {
      log("Addon Purchase Error:", e.message);
    }
  }

  async function handleCheckAddonBalance() {
    if (!userId || !featureId) return alert("User ID & Feature required");
    log(
      `Checking addon balance via /check (sendEvent=false) for ${featureId}...`,
    );

    try {
      const res = await owo.check({
        customer: userId,
        feature: featureId,
        ...(email ? { customerData: { email } } : {}),
      });
      addonBalanceResult = res;
      log("Check w/ Addon Info:", {
        allowed: res.allowed,
        code: res.code,
        planCredits: (res as any).planCredits,
        addonCredits: (res as any).addonCredits,
        balance: (res as any).balance,
      });
    } catch (e: any) {
      log("Check Failed:", e.message);
    }
  }

  async function handleExhaustAndFallback() {
    if (!userId || !featureId) return alert("User ID & Feature required");
    log(
      `--- Exhaust Test: sending check(sendEvent=true) repeatedly for '${featureId}' ---`,
    );

    for (let i = 0; i < 5; i++) {
      try {
        const res = await owo.check({
          customer: userId,
          feature: featureId,
          value: 1,
          sendEvent: true,
          ...(email ? { customerData: { email } } : {}),
        } as any);
        const code = (res as any).code;
        const addon = (res as any).addonCredits;
        log(
          `  Round ${i + 1}: ${res.allowed ? "✓" : "✗"} code=${code}${addon !== undefined ? ` addon=${addon}` : ""}`,
        );
        if (!res.allowed) {
          log("  → Blocked. Test complete.");
          break;
        }
      } catch (e: any) {
        log(`  Round ${i + 1} error: ${e.message}`);
        break;
      }
    }
  }

  async function handleGenerateInvoice() {
    if (!userId) return alert("User ID required");
    log(`Generating invoice for ${userId}...`);

    try {
      const res = await owo.billing.invoice({ customer: userId });
      invoiceResult = res;
      log("Invoice Generated:", res);
    } catch (e: any) {
      log("Invoice Failed:", e.message);
    }
  }

  async function handleListInvoices() {
    if (!userId) return alert("User ID required");
    log(`Listing invoices for ${userId}...`);

    try {
      const res = await owo.billing.invoices({ customer: userId });
      invoicesList = res.invoices || [];
      log("Invoices:", res);
    } catch (e: any) {
      log("Invoices Failed:", e.message);
    }
  }

  async function handlePayInvoice(id?: string) {
    const invoiceId = id || invoiceResult?.invoice?.id;
    if (!invoiceId) return alert("Generate an invoice first");
    log(`Paying invoice ${invoiceId}...`);

    try {
      const res = await owo.billing.pay({
        invoiceId,
        callbackUrl: window.location.href,
      });
      if (res.paid) {
        log("Invoice paid (auto-charged):", res);
        if (invoiceResult?.invoice?.id === invoiceId) {
          invoiceResult = {
            ...invoiceResult,
            invoice: { ...invoiceResult.invoice, status: "paid" },
          };
        }
        invoicesList = invoicesList.map((inv: any) =>
          inv.id === invoiceId ? { ...inv, status: "paid" } : inv,
        );
      } else {
        log("Checkout URL:", res.checkoutUrl);
        window.open(res.checkoutUrl, "_blank");
      }
    } catch (e: any) {
      log("Pay Failed:", e.message);
    }
  }
</script>

<div class="min-h-screen bg-zinc-900 text-zinc-300 font-sans p-8">
  <div class="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-8">
    <!-- Config Column -->
    <div class="space-y-8">
      <div>
        <h1 class="text-2xl font-bold text-white mb-2">Owostack Simulation</h1>
        <p class="text-zinc-500 text-sm">Simulate a customer integration.</p>
      </div>

      <div
        class="space-y-4 bg-zinc-800/50 p-6 rounded-xl border border-zinc-700"
      >
        <h2 class="text-sm font-bold text-zinc-400 uppercase tracking-wider">
          1. Configuration
        </h2>

        <div class="space-y-2">
          <label class="block text-xs font-semibold text-zinc-500"
            >API Secret Key (sk_test_...)</label
          >
          <input
            type="password"
            bind:value={secretKey}
            placeholder="sk_test_..."
            class="w-full bg-zinc-900 border border-zinc-700 rounded p-2 text-white focus:border-emerald-500 outline-none transition-colors"
          />
        </div>

        <div class="space-y-2">
          <label class="block text-xs font-semibold text-zinc-500"
            >API URL</label
          >
          <input
            type="text"
            bind:value={apiUrl}
            placeholder="http://localhost:8787/api/v1"
            class="w-full bg-zinc-900 border border-zinc-700 rounded p-2 text-white focus:border-emerald-500 outline-none transition-colors"
          />
        </div>

        <div class="space-y-2">
          <label class="block text-xs font-semibold text-zinc-500">User ID</label>
          <input
            type="text"
            bind:value={userId}
            placeholder="user_123"
            class="w-full bg-zinc-900 border border-zinc-700 rounded p-2 text-white focus:border-emerald-500 outline-none transition-colors"
          />
        </div>

        <div class="space-y-2">
          <label class="block text-xs font-semibold text-zinc-500">Email (optional)</label>
          <input
            type="email"
            bind:value={email}
            placeholder="user@example.com"
            class="w-full bg-zinc-900 border border-zinc-700 rounded p-2 text-white focus:border-emerald-500 outline-none transition-colors"
          />
        </div>
      </div>

      <div
        class="space-y-4 bg-zinc-800/50 p-6 rounded-xl border border-zinc-700"
      >
        <h2 class="text-sm font-bold text-zinc-400 uppercase tracking-wider">
          2. Subscription (Attach)
        </h2>

        <div class="flex gap-2">
          <input
            type="text"
            bind:value={planId}
            placeholder="Plan ID (slug)"
            class="flex-1 bg-zinc-900 border border-zinc-700 rounded p-2 text-white focus:border-emerald-500 outline-none transition-colors"
          />
          <button
            onclick={handleAttach}
            disabled={!secretKey}
            class="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-4 py-2 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Subscribe
          </button>
        </div>

        {#if attachResult}
          <div
            class="bg-zinc-900 p-3 rounded border border-zinc-700 text-xs font-mono break-all"
          >
            {#if attachResult.authorization_url}
              <a
                href={attachResult.authorization_url}
                target="_blank"
                class="text-emerald-400 underline"
              >
                Pay Now &rarr;
              </a>
            {/if}
            <pre class="mt-2 text-zinc-500">{JSON.stringify(
                attachResult,
                null,
                2,
              )}</pre>
          </div>
        {/if}
      </div>

      <div
        class="space-y-4 bg-zinc-800/50 p-6 rounded-xl border border-zinc-700"
      >
        <h2 class="text-sm font-bold text-zinc-400 uppercase tracking-wider">
          3. Wallet / Payment Method
        </h2>

        <div class="space-y-2">
          <label class="block text-xs font-semibold text-zinc-500"
            >Provider (optional)</label
          >
          <input
            type="text"
            bind:value={walletProvider}
            placeholder="e.g. dodopayments, paystack"
            class="w-full bg-zinc-900 border border-zinc-700 rounded p-2 text-white focus:border-emerald-500 outline-none transition-colors"
          />
        </div>

        <div class="flex gap-2">
          <button
            onclick={handleGetWallet}
            disabled={!secretKey}
            class="flex-1 bg-zinc-700 hover:bg-zinc-600 text-white font-bold px-3 py-2 rounded transition-colors disabled:opacity-50 text-xs"
          >
            View Wallet
          </button>
          <button
            onclick={handleSetupCard}
            disabled={!secretKey}
            class="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-bold px-3 py-2 rounded transition-colors disabled:opacity-50 text-xs"
          >
            Add Card
          </button>
        </div>

        {#if walletSetupResult}
          <div
            class="bg-zinc-900 p-3 rounded border border-zinc-700 text-xs font-mono break-all"
          >
            {#if walletSetupResult.checkoutUrl}
              <a
                href={walletSetupResult.checkoutUrl}
                target="_blank"
                class="text-blue-400 underline"
              >
                Complete Card Setup &rarr;
              </a>
            {/if}
            <pre class="mt-2 text-zinc-500">{JSON.stringify(
                walletSetupResult,
                null,
                2,
              )}</pre>
          </div>
        {/if}

        {#if walletResult}
          <div class="bg-zinc-900 p-3 rounded border border-zinc-700 text-xs">
            {#if walletResult.methods && walletResult.methods.length > 0}
              {#each walletResult.methods as method}
                <div
                  class="flex items-center justify-between py-2 border-b border-zinc-800 last:border-0"
                >
                  <div>
                    <span class="text-zinc-300 font-bold">
                      {method.cardBrand || method.type || "Card"}
                    </span>
                    {#if method.cardLast4}
                      <span class="text-zinc-500 ml-1"
                        >**** {method.cardLast4}</span
                      >
                    {/if}
                    {#if method.cardExpMonth && method.cardExpYear}
                      <span class="text-zinc-600 ml-2 text-[10px]"
                        >{method.cardExpMonth}/{method.cardExpYear}</span
                      >
                    {/if}
                    <span class="text-zinc-600 ml-2 text-[10px] uppercase"
                      >{method.providerId}</span
                    >
                  </div>
                  <button
                    onclick={() => handleRemoveCard(method.id)}
                    class="text-red-500 hover:text-red-400 text-[10px] font-bold uppercase"
                  >
                    Remove
                  </button>
                </div>
              {/each}
            {:else}
              <div class="text-zinc-600 italic text-center py-3">
                No payment methods on file
              </div>
            {/if}
          </div>
        {/if}
      </div>

      <div
        class="space-y-4 bg-zinc-800/50 p-6 rounded-xl border border-zinc-700"
      >
        <h2 class="text-sm font-bold text-zinc-400 uppercase tracking-wider">
          4. Entitlements
        </h2>

        <div class="space-y-2">
          <label class="block text-xs font-semibold text-zinc-500"
            >Feature ID</label
          >
          <input
            type="text"
            bind:value={featureId}
            placeholder="e.g. api-calls"
            class="w-full bg-zinc-900 border border-zinc-700 rounded p-2 text-white focus:border-emerald-500 outline-none transition-colors"
          />
        </div>

        <div class="flex gap-2">
          <button
            onclick={handleCheck}
            disabled={!secretKey}
            class="flex-1 bg-zinc-700 hover:bg-zinc-600 text-white font-bold px-4 py-2 rounded transition-colors disabled:opacity-50"
          >
            Check Access
          </button>

          <div
            class="flex items-center gap-1 bg-zinc-900 rounded border border-zinc-700 px-1"
          >
            <button
              class="px-2 text-zinc-400 hover:text-white"
              onclick={() => trackAmount--}>-</button
            >
            <span class="text-xs w-4 text-center">{trackAmount}</span>
            <button
              class="px-2 text-zinc-400 hover:text-white"
              onclick={() => trackAmount++}>+</button
            >
          </div>

          <button
            onclick={handleTrack}
            disabled={!secretKey}
            class="flex-1 bg-emerald-900/50 hover:bg-emerald-900 text-emerald-400 border border-emerald-800 font-bold px-4 py-2 rounded transition-colors disabled:opacity-50"
          >
            Track Usage
          </button>
        </div>
      </div>

      <div
        class="space-y-4 bg-zinc-800/50 p-6 rounded-xl border border-zinc-700"
      >
        <h2 class="text-sm font-bold text-zinc-400 uppercase tracking-wider">
          5. Add-on Credits
        </h2>

        <div class="space-y-2">
          <label class="block text-xs font-semibold text-zinc-500"
            >Credit Pack Slug</label
          >
          <div class="flex gap-2">
            <input
              type="text"
              bind:value={packSlug}
              placeholder="e.g. 50-credits"
              class="flex-1 bg-zinc-900 border border-zinc-700 rounded p-2 text-white focus:border-emerald-500 outline-none transition-colors"
            />
            <div
              class="flex items-center gap-1 bg-zinc-900 rounded border border-zinc-700 px-1"
            >
              <button
                class="px-2 text-zinc-400 hover:text-white"
                onclick={() => {
                  if (packQuantity > 1) packQuantity--;
                }}>-</button
              >
              <span class="text-xs w-6 text-center">{packQuantity}x</span>
              <button
                class="px-2 text-zinc-400 hover:text-white"
                onclick={() => packQuantity++}>+</button
              >
            </div>
            <button
              onclick={handleBuyAddon}
              disabled={!secretKey || !packSlug}
              class="bg-purple-600 hover:bg-purple-500 text-white font-bold px-4 py-2 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Buy
            </button>
          </div>
        </div>

        {#if addonResult}
          <div
            class="bg-zinc-900 p-3 rounded border border-zinc-700 text-xs font-mono break-all"
          >
            {#if addonResult.checkoutUrl}
              <a
                href={addonResult.checkoutUrl}
                target="_blank"
                class="text-purple-400 underline"
              >
                Complete Checkout &rarr;
              </a>
            {/if}
            {#if addonResult.balance !== undefined}
              <div class="text-purple-300 font-bold mb-1">
                Balance: {addonResult.balance} credits (system: {addonResult.creditSystemId ||
                  "n/a"})
              </div>
            {/if}
            <pre class="text-zinc-500 mt-1">{JSON.stringify(
                addonResult,
                null,
                2,
              )}</pre>
          </div>
        {/if}

        <div class="flex gap-2">
          <button
            onclick={handleCheckAddonBalance}
            disabled={!secretKey || !featureId}
            class="flex-1 bg-zinc-700 hover:bg-zinc-600 text-white font-bold px-3 py-2 rounded transition-colors disabled:opacity-50 text-xs"
          >
            Check Balance
          </button>
          <button
            onclick={handleExhaustAndFallback}
            disabled={!secretKey || !featureId}
            class="flex-1 bg-red-900/50 hover:bg-red-900 text-red-400 border border-red-800 font-bold px-3 py-2 rounded transition-colors disabled:opacity-50 text-xs"
          >
            Exhaust &amp; Fallback Test
          </button>
        </div>

        {#if addonBalanceResult}
          <div class="bg-zinc-900 p-3 rounded border border-zinc-700 text-xs">
            <div class="flex justify-between items-center">
              <span class="text-zinc-400">Allowed</span>
              <span
                class:text-emerald-400={addonBalanceResult.allowed}
                class:text-red-400={!addonBalanceResult.allowed}
                class="font-bold"
              >
                {addonBalanceResult.allowed ? "Yes" : "No"} ({addonBalanceResult.code})
              </span>
            </div>
            {#if addonBalanceResult.planCredits}
              <div
                class="flex justify-between items-center mt-1 border-t border-zinc-800 pt-1"
              >
                <span class="text-zinc-500">Plan Credits</span>
                <span class="text-zinc-300"
                  >{addonBalanceResult.planCredits.used}/{addonBalanceResult
                    .planCredits.limit}</span
                >
              </div>
            {/if}
            {#if addonBalanceResult.addonCredits !== undefined}
              <div
                class="flex justify-between items-center mt-1 border-t border-zinc-800 pt-1"
              >
                <span class="text-zinc-500">Add-on Credits</span>
                <span class="text-purple-400 font-bold"
                  >{addonBalanceResult.addonCredits}</span
                >
              </div>
            {/if}
          </div>
        {/if}
      </div>

      <div
        class="space-y-4 bg-zinc-800/50 p-6 rounded-xl border border-zinc-700"
      >
        <h2 class="text-sm font-bold text-zinc-400 uppercase tracking-wider">
          6. Billing (Usage-Based)
        </h2>

        <div class="flex gap-2">
          <button
            onclick={handleGetUnbilledUsage}
            disabled={!secretKey}
            class="flex-1 bg-zinc-700 hover:bg-zinc-600 text-white font-bold px-3 py-2 rounded transition-colors disabled:opacity-50 text-xs"
          >
            View Unbilled
          </button>
          <button
            onclick={handleGenerateInvoice}
            disabled={!secretKey}
            class="flex-1 bg-amber-900/50 hover:bg-amber-900 text-amber-400 border border-amber-800 font-bold px-3 py-2 rounded transition-colors disabled:opacity-50 text-xs"
          >
            Generate Invoice
          </button>
          <button
            onclick={handleListInvoices}
            disabled={!secretKey}
            class="flex-1 bg-zinc-700 hover:bg-zinc-600 text-white font-bold px-3 py-2 rounded transition-colors disabled:opacity-50 text-xs"
          >
            List Invoices
          </button>
        </div>

        {#if unbilledUsage?.success}
          <div class="bg-zinc-900 p-3 rounded border border-zinc-700 text-xs">
            <div class="flex justify-between items-center mb-2">
              <span class="text-zinc-400">Unbilled Amount</span>
              <span class="text-amber-400 font-bold">
                {unbilledUsage.currency}
                {(unbilledUsage.totalEstimated / 100).toFixed(2)}
              </span>
            </div>
            {#each unbilledUsage.features || [] as f}
              <div class="border-t border-zinc-800 pt-2 mt-2 text-zinc-500">
                <div class="flex justify-between">
                  <span>{f.featureName}</span>
                  <span>{f.billableQuantity} units</span>
                </div>
                <div class="text-xs text-zinc-600">
                  Usage: {f.usage} | Included: {f.included ?? "∞"} | Model: {f.usageModel}
                </div>
              </div>
            {/each}
          </div>
        {/if}

        {#if invoiceResult?.success}
          <div
            class="bg-zinc-900 p-3 rounded border border-emerald-800 text-xs"
          >
            <div class="text-emerald-400 font-bold mb-2">
              Invoice {invoiceResult.invoice.number}
            </div>
            <div class="flex justify-between text-zinc-400">
              <span>Total</span>
              <span
                >{invoiceResult.invoice.currency}
                {(invoiceResult.invoice.total / 100).toFixed(2)}</span
              >
            </div>
            <div class="text-zinc-600 text-xs mt-1">
              Status: {invoiceResult.invoice.status}
            </div>
            {#if invoiceResult.invoice.status !== "paid"}
              <button
                onclick={() => handlePayInvoice()}
                disabled={!secretKey}
                class="mt-2 w-full bg-emerald-900/50 hover:bg-emerald-900 text-emerald-400 border border-emerald-800 font-bold px-3 py-2 rounded transition-colors disabled:opacity-50 text-xs"
              >
                Pay Invoice
              </button>
            {/if}
          </div>
        {/if}

        {#if invoicesList.length > 0}
          <div class="space-y-2">
            {#each invoicesList as inv}
              <div
                class="bg-zinc-900 p-3 rounded border border-zinc-700 text-xs flex items-center justify-between"
              >
                <div>
                  <span class="text-zinc-300 font-bold"
                    >{inv.number || inv.id.slice(0, 8)}</span
                  >
                  <span class="text-zinc-500 ml-2"
                    >{inv.currency} {((inv.total || 0) / 100).toFixed(2)}</span
                  >
                  <span
                    class="ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold"
                    class:bg-emerald-900={inv.status === "paid"}
                    class:text-emerald-400={inv.status === "paid"}
                    class:bg-amber-900={inv.status === "open"}
                    class:text-amber-400={inv.status === "open"}
                    class:bg-zinc-700={inv.status !== "paid" &&
                      inv.status !== "open"}
                    class:text-zinc-400={inv.status !== "paid" &&
                      inv.status !== "open"}>{inv.status}</span
                  >
                </div>
                {#if inv.status === "open"}
                  <button
                    onclick={() => handlePayInvoice(inv.id)}
                    disabled={!secretKey}
                    class="bg-emerald-900/50 hover:bg-emerald-900 text-emerald-400 border border-emerald-800 font-bold px-2 py-1 rounded transition-colors disabled:opacity-50 text-[10px]"
                  >
                    Pay
                  </button>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    <!-- Logs Column -->
    <div
      class="bg-black/50 p-6 rounded-xl border border-zinc-800 h-fit max-h-screen overflow-hidden flex flex-col"
    >
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-sm font-bold text-zinc-400 uppercase tracking-wider">
          Activity Log
        </h2>
        <button
          onclick={() => (logs = [])}
          class="text-xs text-zinc-600 hover:text-zinc-400">Clear</button
        >
      </div>

      <div
        class="flex-1 overflow-y-auto space-y-2 font-mono text-xs custom-scrollbar pr-2 min-h-[300px]"
      >
        {#if logs.length === 0}
          <div class="text-zinc-700 italic text-center py-10">
            Waiting for actions...
          </div>
        {/if}
        {#each logs as log}
          <div class="border-b border-zinc-800/50 pb-2 mb-2 last:border-0">
            {log}
          </div>
        {/each}
      </div>
    </div>
  </div>
</div>

<style>
  :global(body) {
    background-color: #18181b; /* zinc-900 */
    margin: 0;
  }
</style>
