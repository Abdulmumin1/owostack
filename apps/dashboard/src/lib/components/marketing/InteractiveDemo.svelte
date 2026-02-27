<script lang="ts">
  import {
    PaperPlaneRight,
    CircleNotch,
    Warning,
    Receipt,
    Paperclip,
    X,
    FastForward
  } from "phosphor-svelte";
  import { tick, onMount } from "svelte";

  let billingMode = $state<'subscription' | 'pay-per-use'>('subscription');
  let planCredits = $state(40);
  let maxPlanCredits = 100;
  let addonCredits = $state(0);
  let unbilledAmount = $state(0);
  let isExhausted = $derived(planCredits < maxPlanCredits);

  // Timer State
  let resetTimeTotal = 300; // 5 minutes in seconds
  let resetTimeLeft = $state(300);
  let resetProgress = $derived((resetTimeLeft / resetTimeTotal) * 100);
  let timeLeftFormatted = $derived(
    `${Math.floor(resetTimeLeft / 60)}:${(resetTimeLeft % 60).toString().padStart(2, '0')}`
  );
  
  onMount(() => {
    const interval = setInterval(() => {
      const isExhausted = planCredits < maxPlanCredits;
      if (isExhausted && resetTimeLeft > 0) {
        resetTimeLeft -= 1;
      } else if (isExhausted && resetTimeLeft <= 0) {
        resetPlan();
      }
    }, 1000);
    return () => clearInterval(interval);
  });

  function resetPlan() {
    planCredits = maxPlanCredits;
    resetTimeLeft = resetTimeTotal;
  }

  function fastForward() {
    resetPlan();
  }
  
  let messages = $state<{ role: "user" | "ai"; text: string }[]>([
    { role: "ai", text: "Switch billing modes to see how Owostack handles credits vs metered usage." }
  ]);
  let inputValue = $state("");
  let isGenerating = $state(false);
  let isPaying = $state(false);
  let attachError = $state<string | null>(null);
  let logs = $state<{ id: number; method: string; value: string; time: string; meta?: string }[]>([]);
  let chatContainer: HTMLDivElement;

  const models = [
    { id: "gemini", name: "Gemini 3.1", multiplier: 1 },
    { id: "gpt", name: "GPT 5.3", multiplier: 2 },
    { id: "opus", name: "Opus 4.5", multiplier: 4 }
  ];
  let selectedModel = $state(models[0]);

  const responses = [
    "Owostack tracks usage atomically. When AI finishes, we record tokens and update the balance.",
    "Limits are enforced before each request. Insufficient credits means rejection.",
    "Add-ons are instant purchases added to your billing cycle, tracked separately.",
    "Real-time metering shows up-to-date usage within seconds.",
    "Use owo.check() for limits, owo.track() for usage, owo.addon() for credit packs."
  ];
  let responseIndex = 0;

  function scrollToBottom() {
    if (chatContainer) {
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }
  }

  function addLog(method: string, value: string, meta?: string) {
    const now = new Date();
    const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    logs = [{ id: Date.now(), method, value, time, meta }, ...logs].slice(0, 4);
  }

  function handleAttach() {
    addLog("owo.check()", "403", "attachments");
    attachError = "Attachment not included in plan";
    setTimeout(() => { attachError = null; }, 3000);
  }

  function dismissError() {
    attachError = null;
  }

  async function sendMessage() {
    if (!inputValue.trim() || isGenerating) return;

    if (billingMode === 'subscription') {
      const cost = 5 * selectedModel.multiplier;
      if ((planCredits + addonCredits) < cost) return;
    }

    const text = inputValue;
    inputValue = "";
    messages = [...messages, { role: "user", text }];
    await tick();
    scrollToBottom();

    isGenerating = true;

    const response = responses[responseIndex % responses.length];
    responseIndex++;
    const words = response.split(" ");
    
    messages = [...messages, { role: "ai", text: "" }];
    await tick();
    scrollToBottom();
    let fullText = "";

    for (const word of words) {
      if (!isGenerating) break;
      await new Promise(r => setTimeout(r, 50));
      fullText += (fullText ? " " : "") + word;
      messages[messages.length - 1] = { role: "ai", text: fullText };
      await tick();
      scrollToBottom();
    }

    isGenerating = false;

    if (billingMode === 'subscription') {
      const creditCost = 5 * selectedModel.multiplier;
      if (planCredits >= creditCost) {
        planCredits -= creditCost;
      } else {
        const remaining = creditCost - planCredits;
        planCredits = 0;
        addonCredits = Math.max(0, addonCredits - remaining);
      }
      addLog("owo.track()", `-${creditCost} CR`, selectedModel.name);
    } else {
      const cost = 0.10 * selectedModel.multiplier;
      unbilledAmount += cost;
      addLog("owo.track()", `+$${cost.toFixed(2)}`, selectedModel.name);
    }
  }

  function buyAddon() {
    addonCredits += 50;
    addLog("owo.addon()", "+50 CR", "Pack");
  }

  async function handleInvoice() {
    if (unbilledAmount <= 0 || isPaying) return;
    isPaying = true;
    addLog("owo.billing.pay()", "Paid", `$${unbilledAmount.toFixed(2)}`);
    await new Promise(r => setTimeout(r, 800));
    unbilledAmount = 0;
    isPaying = false;
  }
</script>

<div class="w-full max-w-5xl mx-auto border border-border rounded-sm overflow-hidden flex flex-col md:flex-row">
  
  <div class="flex-1 flex flex-col min-h-105 border-r border-border">
    
    <div class="px-4 py-3 border-b border-border flex items-center justify-between">
      <div class="flex gap-2">
        {#each models as model}
          <button 
            onclick={() => selectedModel = model}
            class="px-2 py-1 text-[10px] font-bold border transition-all active:translate-y-[1px]
              {selectedModel.id === model.id 
                ? 'bg-accent border-accent-border text-accent-contrast shadow-[0px_2px_0_0px_var(--color-accent-border)]' 
                : 'border-border text-text-muted hover:text-text-secondary hover:border-border-strong'}">
            {model.name} <span class="font-normal">{model.multiplier}x</span>
          </button>
        {/each}
      </div>
    </div>

    <div bind:this={chatContainer} class="flex-1 p-4 space-y-3 overflow-y-auto max-h-100">
      {#each messages as msg, i (i)}
        <div class="flex gap-2.5 {msg.role === 'user' ? 'flex-row-reverse' : ''}">
          <div class="w-6 h-6 rounded-sm flex-shrink-0 flex items-center justify-center text-[10px] font-bold border border-border
            {msg.role === 'ai' ? 'bg-accent text-accent-contrast border-accent-border' : 'text-text-muted'}">
            {msg.role === 'ai' ? 'AI' : 'U'}
          </div>
          <div class="max-w-[80%] text-sm leading-relaxed p-2.5 border border-border text-text-primary bg-bg-primary/20">
            {msg.text}
            {#if msg.role === 'ai' && isGenerating && i === messages.length - 1}
              <span class="inline-block w-1 h-3 bg-accent ml-0.5 animate-pulse"></span>
            {/if}
          </div>
        </div>
      {/each}

      {#if billingMode === 'subscription' && (planCredits + addonCredits) < (5 * selectedModel.multiplier) && !isGenerating}
        <div class="flex justify-center my-2">
          <div class="border border-error text-error px-3 py-1.5 text-xs flex items-center gap-2">
            <Warning size={14} weight="fill" />
            <span>Credits exhausted — Reset in {timeLeftFormatted}</span>
          </div>
        </div>
      {/if}
    </div>

    <div class="p-3 border-t border-border bg-bg-primary/5">
      {#if attachError}
        <div class="mb-2 flex items-center justify-between px-3 py-1.5 border border-error bg-error-bg/30 text-error text-[10px] rounded-sm">
          <div class="flex items-center gap-2">
            <Warning size={12} weight="fill" />
            <span>{attachError}</span>
          </div>
          <button onclick={dismissError} class="hover:text-text-primary">
            <X size={12} />
          </button>
        </div>
      {/if}
      
      <div class="relative flex items-center gap-2">
        <button 
          onclick={handleAttach}
          class="p-2 text-text-dim hover:text-text-secondary border border-border bg-bg-card rounded-sm transition-colors shadow-sm active:translate-y-[1px]"
          title="Add attachment">
          <Paperclip size={16} />
        </button>
        <div class="relative flex-1">
          <input 
            bind:value={inputValue}
            onkeydown={(e) => e.key === 'Enter' && sendMessage()}
            disabled={isGenerating || (billingMode === 'subscription' && (planCredits + addonCredits) < (5 * selectedModel.multiplier))}
            type="text" 
            placeholder="Type a message..."
            class="input w-full pr-10"
          />
          <button 
            onclick={sendMessage}
            disabled={!inputValue || isGenerating || (billingMode === 'subscription' && (planCredits + addonCredits) < (5 * selectedModel.multiplier))}
            class="absolute right-1 top-[50%] translate-y-[-50%] p-1 bg-accent text-accent-contrast rounded-sm border border-accent-border disabled:opacity-50 transition-all">
            {#if isGenerating}
              <CircleNotch size={14} class="animate-spin" />
            {:else}
              <PaperPlaneRight size={14} weight="fill" />
            {/if}
          </button>
        </div>
      </div>
    </div>
  </div>

  <div class="w-full md:w-[280px] flex flex-col">
    
    <div class="border-b border-border">
      <div class="flex">
        <button 
          onclick={() => billingMode = 'subscription'}
          class="flex-1 py-2.5 text-[10px] font-bold border-b-2 transition-colors
            {billingMode === 'subscription' 
              ? 'border-accent text-accent-hover' 
              : 'border-transparent text-text-muted hover:text-text-secondary'}">
          SUBSCRIPTION
        </button>
        <button 
          onclick={() => billingMode = 'pay-per-use'}
          class="flex-1 py-2.5 text-[10px] font-bold border-b-2 transition-colors
            {billingMode === 'pay-per-use' 
              ? 'border-accent text-accent-hover' 
              : 'border-transparent text-text-muted hover:text-text-secondary'}">
          PAY-PER-USE
        </button>
      </div>
    </div>

    <div class="p-4 space-y-5 flex-1">

      {#if billingMode === 'subscription'}
        <div class="space-y-4">
          <div class="flex justify-between items-baseline">
            <span class="text-[10px] font-bold text-text-muted uppercase tracking-wider">Credits</span>
            <span class="text-sm font-mono font-bold text-text-primary">{planCredits + addonCredits}</span>
          </div>

          <div class="space-y-3">
            <div class="space-y-1">
              <div class="flex justify-between text-[10px]">
                <span class="text-text-secondary">Plan</span>
                <span class="font-mono text-text-muted">{planCredits}/{maxPlanCredits}</span>
              </div>
              <div class="h-1 bg-border rounded-full overflow-hidden">
                <div class="h-full bg-accent transition-all" style="width: {(planCredits/maxPlanCredits)*100}%"></div>
              </div>
            </div>

            <div class="space-y-1">
              <div class="flex justify-between text-[10px]">
                <span class="text-text-secondary">Add-ons</span>
                <span class="font-mono text-secondary">+{addonCredits}</span>
              </div>
              <div class="h-1 bg-border rounded-full overflow-hidden">
                <div class="h-full bg-secondary transition-all" style="width: {(addonCredits/maxPlanCredits)*100}%"></div>
              </div>
            </div>
          </div>

          <button onclick={buyAddon} class="btn btn-primary w-full">
            Buy 50 Credits
          </button>

          <div class="pt-2 flex items-center justify-between border-t border-border/50">
            <div class="flex items-center gap-2">
              <div class="relative w-4 h-4">
                <svg viewBox="0 0 36 36" class="w-full h-full transform -rotate-90">
                  <path
                    class="text-border"
                    stroke-width="4"
                    stroke="currentColor"
                    fill="transparent"
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  />
                  <path
                    class="text-accent"
                    stroke-width="4"
                    stroke-dasharray="{isExhausted ? resetProgress : 100}, 100"
                    stroke-linecap="round"
                    stroke="currentColor"
                    fill="transparent"
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  />
                </svg>
              </div>
              <span class="text-[9px] font-bold text-text-dim uppercase tracking-widest">
                {#if isExhausted}
                  Reset in {timeLeftFormatted}
                {:else}
                  Waiting for usage
                {/if}
              </span>
            </div>
            {#if isExhausted}
              <button 
                onclick={fastForward}
                class="p-1 text-text-dim hover:text-accent transition-colors"
                title="Fast forward to next cycle"
              >
                <FastForward size={14} weight="fill" />
              </button>
            {/if}
          </div>
        </div>
      {:else}
        <div class="space-y-4">
          <span class="text-[10px] font-bold text-text-muted uppercase tracking-wider">Unbilled</span>
          
          <div class="space-y-3">
            <span class="text-2xl font-mono font-bold text-text-primary">${unbilledAmount.toFixed(2)}</span>
            
            <button 
              onclick={handleInvoice}
              disabled={unbilledAmount <= 0 || isPaying}
              class="btn btn-secondary w-full">
              {#if isPaying}
                <CircleNotch size={12} class="animate-spin" />
                Processing...
              {:else}
                <Receipt size={12} weight="bold" />
                Pay Now
              {/if}
            </button>
          </div>
        </div>
      {/if}

      <div class="space-y-2 pt-4 border-t border-border">
        <span class="text-[10px] font-bold text-text-muted uppercase tracking-wider">Activity</span>
        <div class="space-y-1.5 font-mono text-[10px]">
          {#each logs as log (log.id)}
            <div class="flex justify-between py-1 border-b border-border/50">
              <span class="text-text-secondary">{log.method}</span>
              <div class="flex gap-2">
                <span class="text-text-dim">{log.time}</span>
                <span class="font-bold {log.value === '403' ? 'text-error' : 'text-text-primary'}">{log.value}</span>
              </div>
            </div>
          {/each}
          {#if logs.length === 0}
            <div class="py-2 text-text-dim text-center">No activity yet</div>
          {/if}
        </div>
      </div>

    </div>
  </div>
</div>
