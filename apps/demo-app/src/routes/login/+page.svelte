<script lang="ts">
  import { Sparkle, ArrowRight } from "phosphor-svelte";
  let { form } = $props();
</script>

<div class="min-h-screen bg-bg-primary text-text-primary flex items-center justify-center p-6">
  <div class="w-full max-w-md bg-bg-secondary/30 backdrop-blur-xl border border-white/5 rounded-sm p-8 shadow-2xl">
    <div class="flex items-center gap-3 mb-8 justify-center">
      <div class="size-10 bg-accent rounded-sm flex items-center justify-center shadow-[0_2px_0_0_var(--color-accent-border)]">
        <Sparkle weight="fill" class="text-accent-contrast size-5" />
      </div>
      <h1 class="text-2xl font-display font-bold text-text-primary tracking-tight uppercase">AI Demo App</h1>
    </div>

    <form method="POST" class="space-y-5">
      <div class="space-y-1.5">
        <label for="name" class="text-[10px] font-bold text-text-muted uppercase tracking-widest">Your Name</label>
        <input 
          id="name" 
          name="name" 
          type="text" 
          required 
          placeholder="Jane Doe"
          class="input w-full" 
        />
      </div>

      <div class="space-y-1.5">
        <label for="email" class="text-[10px] font-bold text-text-muted uppercase tracking-widest">Email Address</label>
        <input 
          id="email" 
          name="email" 
          type="email" 
          required 
          placeholder="jane@example.com"
          class="input w-full" 
        />
      </div>

      {#if form?.error}
        <div class="text-[10px] text-error font-bold uppercase tracking-widest border border-error/20 bg-error-bg/20 p-2 rounded-sm text-center">
          {form.error}
        </div>
      {/if}

      <button type="submit" class="btn btn-primary w-full flex items-center justify-center gap-2 h-11 uppercase tracking-widest mt-6">
        Continue to App <ArrowRight size={14} weight="bold" />
      </button>
      
      <div class="pt-4 text-center">
        <a href="/pricing" class="text-[11px] font-bold uppercase tracking-widest text-text-muted hover:text-accent transition-colors">
          View Pricing Plans
        </a>
      </div>
    </form>
    <p class="text-[10px] text-text-muted text-center mt-6 uppercase tracking-widest">
      Powered by Owostack Billing
    </p>
  </div>
</div>