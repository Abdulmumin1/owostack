<script lang="ts">
  import { Check, Copy, WarningCircle } from "phosphor-svelte";
  import { SUPPORTED_PROVIDERS } from "$lib/providers";
  import ProviderBadge from "$lib/components/ui/ProviderBadge.svelte";
  import type { WebhookUrl } from "./types";

  let { 
    webhookUrls 
  }: { 
    webhookUrls: WebhookUrl[] 
  } = $props();

  let copiedUrl = $state<string | null>(null);

  function copyUrl(url: string) {
    navigator.clipboard.writeText(url);
    copiedUrl = url;
    setTimeout(() => copiedUrl = null, 2000);
  }

  function getProviderLabel(id: string): string {
    return SUPPORTED_PROVIDERS.find((p) => p.id === id)?.name || id;
  }
</script>


<div class="space-y-6">
  <div class="bg-info-bg border border-info p-5 rounded-lg flex gap-4">
    <WarningCircle weight="duotone" size={18} class="text-info shrink-0 mt-0.5" />
    <div>
      <h4 class="text-xs font-bold text-info uppercase tracking-widest mb-1">Required Configuration</h4>
      <p class="text-xs text-info/80 leading-relaxed">
        You must register these webhook URLs in your payment provider dashboards to track payments and subscription updates.
      </p>
    </div>
  </div>

  <div class="space-y-4">
    {#each webhookUrls as wh (wh.providerId)}
      <div>
        <div class="flex items-center gap-2 mb-2">
          <span class="text-[10px] font-bold text-text-dim uppercase tracking-widest">
            {wh.providerId === "default" ? "Default URL" : `${getProviderLabel(wh.providerId)} URL`}
          </span>
          {#if wh.providerId !== "default"} <ProviderBadge providerId={wh.providerId} size="xs" /> {/if}
        </div>
        <div class="bg-[var(--color-bg-code)] border border-border p-3 rounded flex items-center gap-4">
          <code class="flex-1 font-mono text-xs text-[var(--color-text-code)] break-all">{wh.url}</code>
          <button class="text-text-dim hover:text-text-primary" onclick={() => copyUrl(wh.url)}>
            {#if copiedUrl === wh.url} <Check size={16} class="text-emerald-500" weight="fill" /> {:else} <Copy size={16} weight="fill" /> {/if}
          </button>
        </div>
      </div>
    {/each}
  </div>
</div>
