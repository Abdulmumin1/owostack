<script lang="ts">
  import { Owostack } from "@owostack/core";

  let secretKey = $state("");
  let apiUrl = $state("http://localhost:8787/api/v1");
  let customerId = $state("");
  let logs = $state<string[]>([]);

  // Attach State
  let planId = $state("");
  let attachResult = $state<any>(null);

  // Metering State
  let featureId = $state("api-calls");
  let trackAmount = $state(1);

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
    if (!customerId || !planId) return alert("Customer & Plan required");
    log(`Attaching plan ${planId} to ${customerId}...`);

    try {
      const res = await owo.attach({
        customer: customerId,
        product: planId, // SDK maps product -> feature/plan
        metadata: { source: "simulation_demo" },
      });
      attachResult = res;
      log("Attach Success:", res);
    } catch (e: any) {
      log("Attach Failed:", e.message);
    }
  }

  async function handleCheck() {
    if (!customerId || !featureId) return alert("Customer & Feature required");
    log(`Checking access for ${featureId}...`);

    try {
      const res = await owo.check({
        customer: customerId,
        feature: featureId,
      });
      log("Check Result:", res);
    } catch (e: any) {
      log("Check Failed:", e.message);
    }
  }

  async function handleTrack() {
    if (!customerId || !featureId) return alert("Customer & Feature required");
    log(`Tracking ${trackAmount} units for ${featureId}...`);

    try {
      const res = await owo.track({
        customer: customerId,
        feature: featureId,
        amount: trackAmount,
      });
      log("Track Result:", res);
    } catch (e: any) {
      log("Track Failed:", e.message);
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
          <label class="block text-xs font-semibold text-zinc-500"
            >Customer ID / Email</label
          >
          <input
            type="text"
            bind:value={customerId}
            placeholder="customer@example.com"
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
          3. Entitlements
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
