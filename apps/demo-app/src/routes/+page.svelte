<script lang="ts">
  import { 
    Pulse, 
    CreditCard, 
    Layout, 
    Lightning, 
    Bell,
    Plus,
    ChatCircleDots,
    Receipt,
    Warning,
    TerminalWindow,
    PaperPlaneRight,
    CircleNotch,
    ArrowsClockwise,
    SignOut,
    Sparkle,
    CaretLeft,
    CaretRight
  } from "phosphor-svelte";
  import { cn } from "$lib/utils";
  import { tick } from "svelte";
  import type { PublicPlan, CheckResult } from "owostack";

  let { data } = $props();

  let invoicesList = $derived(data.invoices);
  let plans = $derived(data.plans as PublicPlan[]);
  let isPremium = $derived(data.isPremium);

  // We keep this as state so we can mutate it after a chat response without reloading
  let checkResult = $state<CheckResult | null | undefined>();
  $effect(() => { checkResult = data.checkResult; });

  let currentTab = $state("dashboard");
  let isUpgradeModalOpen = $state(false);
  let logs = $state<{id: number, time: string, msg: string, data?: any, type: 'info' | 'error' | 'success'}[]>([]);
  let isLogsCollapsed = $state(true);
  
  const models = [
    { id: "gemini", name: "Gemini 3.1 Flash-Lite", multiplier: 1, premium: false },
    { id: "flash", name: "Gemini 3 Flash", multiplier: 3, premium: true },
    { id: "pro", name: "Gemini 3.1 Pro", multiplier: 10, premium: true }
  ];
  let selectedModel = $state(models[0]);
  let messages = $state<{ role: "user" | "ai"; text: string }[]>([
    { role: "ai", text: "Welcome to your AI assistant! Your active credit balance is shown above." }
  ]);
  let inputValue = $state("");
  let isGenerating = $state(false);
  let attachError = $state<string | null>(null);
  let chatContainer = $state<HTMLDivElement>();

  function addLog(msg: string, type: 'info' | 'error' | 'success' = 'info', extraData?: any) {
    const entry = {
      id: Date.now() + Math.random(),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      msg,
      data: extraData,
      type
    };
    logs = [entry, ...logs].slice(0, 50);
  }

  async function handleSend() {
    if (!inputValue.trim() || isGenerating) return;
    
    const text = inputValue;
    inputValue = "";
    messages = [...messages, { role: "user", text }];
    await tick(); 
    if (chatContainer) chatContainer.scrollTop = chatContainer.scrollHeight;
    
    isGenerating = true;
    attachError = null;
    addLog(`POST /api/chat - Model: ${selectedModel.id}`, "info");

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: selectedModel.id, messages })
      });
      const result = await res.json();

      if (!res.ok) {
        attachError = result.error;
        addLog(`Access Denied: ${result.error}`, "error", result);
      } else {
        addLog(`Generation Successful. Cost: ${result.cost} credits.`, "success");
        if (result.checkResult) {
          checkResult = result.checkResult;
        }
        
        messages = [...messages, { role: "ai", text: "" }];
        const resText = result.message;
        let currentText = "";
        for (const word of resText.split(" ")) {
          await new Promise(r => setTimeout(r, 40));
          currentText += (currentText ? " " : "") + word;
          messages[messages.length - 1].text = currentText;
          await tick(); 
          if (chatContainer) chatContainer.scrollTop = chatContainer.scrollHeight;
        }
      }
    } catch (err: any) {
      addLog("Network Error", "error");
      attachError = err.message || "Failed to connect to API";
    } finally {
      isGenerating = false;
    }
  }

  async function handleCheckout(planSlug: string) {
    addLog(`Creating checkout for plan: ${planSlug}`, "info");
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planSlug })
      });
      const attachRes = await res.json();
      
      if (!res.ok) {
        throw new Error(attachRes.error || 'Checkout failed');
      }
      
      if (attachRes.checkoutUrl) {
        addLog(`Redirecting to checkout... (ref: ${attachRes.reference})`, "success");
        window.location.href = attachRes.checkoutUrl;
      } else if (attachRes.attached) {
        addLog("Plan attached directly (free plan).", "success", attachRes);
        isUpgradeModalOpen = false;
        window.location.reload();
      } else {
        addLog("Unexpected response from checkout.", "error", attachRes);
      }
    } catch (err: any) {
      addLog(`Checkout failed: ${err.message}`, "error");
    }
  }

  async function handleCancelPlan() {
    if (!confirm('Are you sure you want to cancel your active plan?')) return;
    addLog(`Cancelling active plan...`, "info");
    try {
      const res = await fetch('/api/cancel-plan', { method: 'POST' });
      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error);
      addLog("Plan cancelled successfully.", "success", resData);
      window.location.reload();
    } catch (err: any) {
      addLog(`Cancellation failed: ${err.message}`, "error");
    }
  }

  async function handleLogout() {
    document.cookie = 'userId=; Max-Age=0; path=/; domain=' + location.hostname;
    window.location.reload();
  }
</script>

<div class="flex h-screen bg-bg-primary text-text-primary font-sans selection:bg-accent/30">
  <aside class="w-64 border-r border-white/5 flex flex-col bg-bg-secondary/30 backdrop-blur-xl">
    <div class="p-6 flex items-center gap-2.5">
      <div class="size-7 bg-accent rounded-sm flex items-center justify-center border border-accent-border shadow-[0_2px_0_0_var(--color-accent-border)]">
        <Lightning weight="fill" class="text-accent-contrast size-4" />
      </div>
      <span class="font-display font-bold text-sm tracking-tight text-text-primary uppercase tracking-widest">AI <span class="text-accent">Chat</span></span>
    </div>
    
    <nav class="flex-1 px-4 py-6 space-y-1.5">
      <button onclick={() => currentTab = "dashboard"} class={cn("w-full flex items-center gap-3 px-3 py-2 rounded-sm text-[11px] font-bold uppercase tracking-wider transition-all", currentTab === "dashboard" ? "bg-bg-tertiary text-accent" : "text-text-muted hover:text-text-secondary hover:bg-bg-tertiary/50")}>
        <Layout size={18} weight={currentTab === 'dashboard' ? 'fill' : 'regular'} /> Chat
      </button>
      <button onclick={() => currentTab = "billing"} class={cn("w-full flex items-center gap-3 px-3 py-2 rounded-sm text-[11px] font-bold uppercase tracking-wider transition-all", currentTab === "billing" ? "bg-bg-tertiary text-accent" : "text-text-muted hover:text-text-secondary hover:bg-bg-tertiary/50")}>
        <CreditCard size={18} weight={currentTab === 'billing' ? 'fill' : 'regular'} /> Billing
      </button>
      <a href="/pricing" class="w-full flex items-center gap-3 px-3 py-2 rounded-sm text-[11px] font-bold uppercase tracking-wider text-text-muted hover:text-text-secondary hover:bg-bg-tertiary/50 transition-all">
        <Sparkle size={18} /> Pricing
      </a>
    </nav>
    
    <div class="p-4 border-t border-white/5 space-y-2">
       <button onclick={handleLogout} class="w-full flex items-center justify-center gap-2 px-3 py-2 text-[10px] text-error font-bold uppercase tracking-wider border border-error/20 rounded-sm hover:bg-error-bg/10 transition-all">
          <SignOut size={14} /> Logout
       </button>
       <div class="bg-bg-card rounded-sm p-4 border border-white/5">
          <p class="text-[9px] uppercase tracking-widest text-text-muted font-bold mb-3">Logged In As</p>
          <div class="flex items-center gap-3">
             <div class="size-8 rounded-sm bg-accent/10 border border-accent/20 flex items-center justify-center text-accent text-xs font-bold uppercase">{data.user?.name?.[0] || 'U'}</div>
             <div class="min-w-0">
                <p class="text-xs font-bold text-text-primary truncate">{data.user?.name}</p>
                <p class="text-[10px] text-text-muted truncate">{data.user?.email}</p>
             </div>
          </div>
       </div>
    </div>
  </aside>

  <main class="flex-1 flex flex-col overflow-hidden">
    <header class="h-14 border-b border-white/5 flex items-center justify-between px-8 bg-bg-primary/50 backdrop-blur-md z-10">
       <div class="flex items-center gap-4 flex-1">
       </div>
       <div class="flex items-center gap-4">
          <button class="text-text-muted hover:text-text-primary"><Bell size={18}/></button>
       </div>
    </header>

    <div class="flex-1 overflow-y-auto custom-scrollbar p-10 bg-[radial-gradient(circle_at_50%_0%,var(--color-bg-secondary),transparent_50%)]">
      {#if currentTab === 'dashboard'}
        <div class="max-w-5xl mx-auto space-y-10 animate-in fade-in slide-in-from-bottom-2 duration-500">
          <div class="flex items-end justify-between">
            <div>
              <h1 class="text-2xl font-display font-bold text-text-primary tracking-tight">App Dashboard</h1>
            </div>
            <div class="flex gap-2">
              <button onclick={() => window.location.reload()} class="btn btn-secondary"><ArrowsClockwise size={14} class="mr-1"/> Refresh Stats</button>
              {#if checkResult?.details?.planName && checkResult.details.planName !== 'Starter'}
                <button onclick={handleCancelPlan} class="btn border border-error/20 text-error hover:bg-error-bg/10">Cancel Plan</button>
              {/if}
              <button onclick={() => isUpgradeModalOpen = true} class="btn btn-primary">Upgrade Plan</button>
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div class="card card-compact border-white/5 relative overflow-hidden group">
               <Pulse size={80} weight="bold" class="absolute -top-4 -right-4 opacity-5 text-accent" />
               <p class="text-[10px] font-bold text-text-muted uppercase tracking-widest">Available Credits</p>
                <h3 class="text-2xl font-mono font-bold text-text-primary mt-1">
                  {checkResult?.balance !== null && checkResult?.balance !== undefined ? checkResult.balance.toLocaleString() : '∞'} <span class="text-xs text-text-muted font-normal lowercase">{checkResult?.resetInterval ? `/ ${checkResult.resetInterval}` : 'left'}</span>
                </h3>
                {#if checkResult?.resetsAt}
                  <p class="text-[9px] text-text-muted font-bold uppercase tracking-widest mt-2">Resets {new Date(checkResult.resetsAt).toLocaleDateString()}</p>
                {/if}
             </div>
            <div class="card card-compact border-white/5 relative overflow-hidden group">
               <Receipt size={80} weight="bold" class="absolute -top-4 -right-4 opacity-5 text-secondary" />
               <p class="text-[10px] font-bold text-text-muted uppercase tracking-widest">Active Plan</p>
                <h3 class="text-xl font-bold text-text-primary mt-1 capitalize">{checkResult?.details?.planName || 'Free Tier'}</h3>
                <p class="text-[9px] text-text-muted font-bold uppercase tracking-widest mt-2">{isPremium ? 'Premium Models Unlocked' : 'Basic Models Only'}</p>
             </div>
             <div class="card card-compact border-white/5 relative overflow-hidden group">
                <Layout size={80} weight="bold" class="absolute -top-4 -right-4 opacity-5 text-tertiary" />
               <p class="text-[10px] font-bold text-text-muted uppercase tracking-widest">Credits Used</p>
                <h3 class="text-xl font-bold text-text-primary mt-1 capitalize">
                  {checkResult?.usage !== null && checkResult?.usage !== undefined ? checkResult.usage.toLocaleString() : '0'} <span class="text-xs text-text-muted font-normal lowercase">this period</span>
                </h3>
                <div class="w-full bg-white/5 h-1.5 rounded-full mt-3 overflow-hidden">
                  <div class="bg-accent h-full rounded-full transition-all duration-500" style={`width: ${checkResult?.limit ? Math.min(100, ((checkResult.usage || 0) / checkResult.limit) * 100) : 0}%`}></div>
                </div>
             </div>
           </div>

           <div class="flex gap-6">
             <div class={cn("flex flex-col border border-white/5 rounded-sm overflow-hidden bg-bg-card shadow-2xl transition-all duration-300", isLogsCollapsed ? "flex-1" : "flex-[2]")}>
              <div class="px-5 py-3 border-b border-white/5 flex items-center justify-between bg-bg-secondary/50">
                <div class="flex items-center gap-6">
                   <div class="flex items-center gap-2">
                      <ChatCircleDots weight="fill" class="text-accent size-4" />
                      <span class="text-[10px] font-bold text-text-primary uppercase tracking-widest">LLM Emulator</span>
                   </div>
                </div>
                <div class="flex items-center gap-2">
                   <span class="size-1.5 rounded-full bg-secondary shadow-[0_0_8px_var(--color-secondary)]"></span>
                   <span class="text-[9px] text-text-muted font-bold uppercase">Online</span>
                </div>
              </div>

              <div bind:this={chatContainer} class="h-[320px] overflow-y-auto p-6 space-y-4 bg-[radial-gradient(circle_at_50%_0%,var(--color-bg-secondary),transparent_50%)] custom-scrollbar">
                 {#each messages as msg}
                    <div class={cn("flex gap-3", msg.role === 'user' ? "flex-row-reverse" : "")}>
                       <div class={cn("size-6 rounded-sm flex items-center justify-center text-[9px] font-bold border", msg.role === 'ai' ? "bg-accent text-accent-contrast border-accent-border" : "bg-bg-tertiary text-text-muted border-white/10")}>{msg.role === 'ai' ? 'AI' : 'U'}</div>
                       <div class={cn("max-w-[85%] text-[12px] leading-relaxed p-2.5 rounded-sm border border-white/5", msg.role === 'ai' ? "bg-bg-card text-text-primary" : "bg-bg-secondary/30 text-text-secondary")}>{msg.text}</div>
                    </div>
                 {/each}
                 {#if attachError}
                    <div class="flex justify-center"><div class="border border-error/20 bg-error-bg/10 text-error px-3 py-1 text-[9px] font-bold uppercase tracking-widest rounded-sm flex items-center gap-2"><Warning size={12} weight="fill"/> {attachError}</div></div>
                 {/if}
              </div>

              <div class="p-4 border-t border-white/5 bg-bg-secondary/20 space-y-4">
                  <div class="flex gap-2 flex-wrap">
                     {#each models as m}
                        <button 
                          onclick={() => selectedModel = m} 
                          disabled={m.premium && !isPremium}
                          class={cn(
                            "px-2 py-1 text-[9px] font-bold border rounded-sm transition-all relative", 
                            selectedModel.id === m.id ? "bg-bg-tertiary text-accent border-accent/50 shadow-[0_2px_0_0_rgba(240,184,96,0.2)]" : "border-white/5 text-text-muted hover:border-white/20",
                            m.premium && !isPremium && "opacity-50 cursor-not-allowed"
                          )}
                        >
                          {m.name} 
                          <span class="opacity-50 ml-0.5">{m.multiplier}x</span>
                          {#if m.premium}
                            <span class="absolute -top-1 -right-1 size-1.5 bg-accent rounded-full" title="Premium Model"></span>
                          {/if}
                        </button>
                     {/each}
                  </div>
                 <div class="relative">
                    <input bind:value={inputValue} onkeydown={e => e.key === 'Enter' && handleSend()} placeholder="Ask something..." class="input h-10 pr-10 border-white/5 bg-bg-primary/50" disabled={isGenerating}/>
                    <button onclick={handleSend} class="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 bg-accent text-accent-contrast rounded-sm border border-accent-border disabled:opacity-50">
                       {#if isGenerating} <CircleNotch size={14} class="animate-spin"/> {:else} <PaperPlaneRight weight="fill" size={14}/> {/if}
                    </button>
                 </div>
              </div>
            </div>

              <div class={cn("border border-white/5 rounded-sm flex flex-col h-[500px] transition-all duration-300", isLogsCollapsed ? "w-12" : "w-80")}>
                <div class="px-3 py-3 border-b border-white/5 flex items-center justify-between bg-bg-card/30">
                   <button onclick={() => isLogsCollapsed = !isLogsCollapsed} class="flex items-center gap-2 text-text-muted hover:text-text-primary transition-colors" title={isLogsCollapsed ? "Expand Server Actions" : "Collapse Server Actions"}>
                      {#if isLogsCollapsed}
                        <CaretLeft size={16} weight="bold" class="text-accent" />
                        {#if logs.length > 0}
                          <span class="absolute -top-1 -right-1 size-2 bg-accent rounded-full"></span>
                        {/if}
                      {:else}
                        <CaretRight size={16} weight="bold" />
                        <h3 class="text-[10px] font-bold text-text-primary uppercase tracking-widest">Server Actions</h3>
                      {/if}
                   </button>
                   {#if !isLogsCollapsed}
                     <button onclick={() => logs = []} class="text-[9px] text-text-muted hover:text-text-primary font-bold uppercase">Clear</button>
                   {/if}
                </div>
                {#if !isLogsCollapsed}
                  <div class="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-2 bg-bg-secondary/20">
                    {#if logs.length === 0}
                       <div class="h-full flex flex-col items-center justify-center text-text-muted/30 text-center"><TerminalWindow size={40} class="mb-4" /><p class="text-[10px] font-bold uppercase tracking-widest">Awaiting events...</p></div>
                    {/if}
                    {#each logs as log (log.id)}
                       <div class="p-3 rounded-sm border border-white/5 bg-bg-card/50 space-y-1.5 animate-in slide-in-from-right-1 duration-200">
                          <div class="flex items-center justify-between">
                             <span class={cn("text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-sm border", log.type === 'success' ? "bg-secondary-light/30 text-secondary border-secondary/30" : log.type === 'error' ? "bg-error-bg/30 text-error border-error/30" : "bg-bg-tertiary text-text-muted border-white/5")}>{log.type}</span>
                             <span class="text-[9px] text-text-dim font-mono">{log.time}</span>
                          </div>
                          <p class="text-[11px] text-text-secondary font-mono leading-tight break-all">{log.msg}</p>
                       </div>
                    {/each}
                  </div>
                {:else}
                  <div class="flex-1 bg-bg-secondary/20 flex items-start justify-center pt-4">
                    {#if logs.length > 0}
                      <span class="size-2 bg-accent rounded-full animate-pulse"></span>
                    {/if}
                  </div>
                {/if}
             </div>
          </div>
        </div>
      {:else if currentTab === 'billing'}
         <div class="max-w-4xl mx-auto p-10">
           <h1 class="text-2xl font-display font-bold">Billing & Wallet</h1>
           <p class="text-text-muted mt-2">Manage your cards and view invoice archive.</p>
           
           <div class="mt-8 space-y-4">
             <h2 class="text-sm font-bold uppercase tracking-widest">Past Invoices</h2>
             {#if invoicesList?.length}
                {#each invoicesList as inv}
                   <div class="p-4 border border-white/5 bg-bg-card flex justify-between">
                      <div>
                        <p class="text-xs">{inv.number}</p>
                        <p class="text-[10px] text-text-muted">{inv.status}</p>
                      </div>
                      <p class="text-sm font-bold">{inv.total / 100} {inv.currency}</p>
                   </div>
                {/each}
             {:else}
                <div class="p-8 border border-white/5 text-center text-text-muted text-xs">No invoices found.</div>
             {/if}
           </div>
         </div>
      {/if}
    </div>
  </main>
</div>

{#if isUpgradeModalOpen}
  <div role="dialog" class="fixed inset-0 bg-bg-primary/90 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-300">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="absolute inset-0 z-0" onclick={() => isUpgradeModalOpen = false}></div>
    <div class="bg-bg-card border border-white/5 rounded-sm w-full max-w-4xl overflow-hidden shadow-[20px_20px_0_0_rgba(0,0,0,0.5)] z-10 relative">
      <div class="p-8 border-b border-white/5 flex justify-between bg-bg-secondary/50">
         <div><h2 class="text-xl font-display font-bold uppercase">Select Plan</h2><p class="text-[11px] font-bold text-text-muted uppercase mt-1">Scale your AI usage</p></div>
         <button onclick={() => isUpgradeModalOpen = false} class="btn btn-secondary p-2"><Plus class="rotate-45" size={18} weight="bold"/></button>
      </div>
      <div class="p-10 grid grid-cols-1 md:grid-cols-2 gap-8">
        {#each plans.length > 0 ? plans : [{slug: 'starter', name:'Starter', price: 0, currency: 'NGN', popular:false}, {slug: 'pro', name:'Pro', price: 15000, currency: 'NGN', popular:true}] as p}
          <div class={cn("p-8 rounded-sm border transition-all flex flex-col relative shadow-[4px_4px_0_0_var(--color-border)]", (p as any).popular ? "bg-accent/5 border-accent scale-105 z-10 shadow-[4px_4px_0_0_var(--color-accent-border)]" : "bg-bg-primary border-white/5")}>
            <h3 class="text-sm font-bold text-center uppercase tracking-widest">{p.name}</h3>
            <p class="text-3xl font-mono font-bold text-center mt-6">{(p.currency || 'NGN')}{(Number(p.price) || 0)/100}</p>
            <button onclick={() => handleCheckout(p.slug)} class={cn("btn h-11 uppercase mt-8", (p as any).popular ? "btn-primary" : "btn-secondary")}>Select</button>
          </div>
        {/each}
      </div>
    </div>
  </div>
{/if}

<style>
  :global(.custom-scrollbar::-webkit-scrollbar) { width: 4px; }
  :global(.custom-scrollbar::-webkit-scrollbar-track) { background: transparent; }
  :global(.custom-scrollbar::-webkit-scrollbar-thumb) { background-color: var(--color-border-strong); border-radius: 9999px; }
</style>
