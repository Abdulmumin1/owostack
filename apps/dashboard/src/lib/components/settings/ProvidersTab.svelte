<script lang="ts">
  import { Check, Cpu, Pencil, Plus, Trash, WarningCircle, X } from "phosphor-svelte";
  import { apiFetch } from "$lib/auth-client";
  import { SUPPORTED_PROVIDERS } from "$lib/providers";
  import ProviderBadge from "$lib/components/ui/ProviderBadge.svelte";
  import type { ProviderAccount } from "./types";

  let { 
    projectId,
    accounts: accountsProp = [],
    enabledProviderIds = [],
    onEdit,
    onAdd
  }: {
    projectId: string;
    accounts?: ProviderAccount[];
    enabledProviderIds?: string[];
    onEdit: (account: ProviderAccount) => void;
    onAdd: () => void;
  } = $props();

  let accounts = $state<ProviderAccount[]>([]);
  let providerError = $state<string | null>(null);
  let deletingId = $state<string | null>(null);
  let isDeleting = $state(false);

  $effect(() => {
    accounts = accountsProp;
  });

  async function loadAccounts() {
    const res = await apiFetch(`/api/dashboard/providers/accounts?organizationId=${projectId}`);
    if (res.data?.data) {
      accounts = res.data.data;
    }
  }

  async function deleteAccount(id: string) {
    isDeleting = true;
    try {
      await apiFetch(`/api/dashboard/providers/accounts/${id}?organizationId=${projectId}`, { method: "DELETE" });
      await loadAccounts();
      deletingId = null;
    } catch (e) { console.error(e); } finally { isDeleting = false; }
  }

  function getProviderLabel(id: string): string {
    return SUPPORTED_PROVIDERS.find((p) => p.id === id)?.name || id;
  }
</script>

<div class="flex items-center justify-between mb-6">
  <div>
   
  </div>
  <button class="btn btn-primary" onclick={onAdd}><Plus size={14} weight="fill" /> Add Provider</button>
</div>

{#if providerError}
  <div class="p-4 bg-error-bg border border-error text-error text-xs mb-6 flex items-center gap-2">
    <WarningCircle size={14} weight="fill" /> {providerError}
  </div>
{/if}

{#if accounts.length === 0}
  <div class="text-center py-12 border border-dashed border-border rounded-lg">
    <Cpu size={32} class="mx-auto text-text-dim/20 mb-4" />
    <p class="text-text-dim text-sm mb-4">No providers connected yet</p>
    <button class="btn btn-secondary" onclick={onAdd}>Connect First Provider</button>
  </div>
{:else}
  <div class="space-y-3">
    {#each accounts as account (account.id)}
      <div class="border border-border bg-bg-secondary/30 p-5 flex items-center justify-between rounded-lg group hover:border-text-dim transition-colors">
        <div class="flex items-center gap-4">
          <div class="w-10 h-10 bg-bg-card border border-border flex items-center justify-center rounded">
            <Cpu size={18} class="text-text-dim" />
          </div>
          <div>
            <div class="flex items-center gap-2 mb-1">
              <span class="text-sm font-bold text-text-primary">{account.displayName || getProviderLabel(account.providerId)}</span>
              <ProviderBadge providerId={account.providerId} size="xs" />
            </div>
            <div class="flex items-center gap-3 text-[10px] text-text-dim uppercase tracking-widest">
              <span class="flex items-center gap-1">
                <span class="w-1.5 h-1.5 {account.environment === 'live' ? 'bg-success' : 'bg-warning'} inline-block rounded-full"></span>
                {account.environment}
              </span>
            </div>
          </div>
        </div>
        <div class="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <button class="p-2 text-text-dim hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/5 rounded border border-transparent hover:border-border" onclick={() => onEdit(account)}>
            <Pencil size={14} />
          </button>
          {#if deletingId === account.id}
            <button class="p-2 text-error bg-error-bg border border-error rounded" onclick={() => deleteAccount(account.id)} disabled={isDeleting}>
              <Check size={14} weight="fill" />
            </button>
            <button class="p-2 text-text-dim hover:text-text-primary" onclick={() => deletingId = null}><X size={14} weight="fill" /></button>
          {:else}
            <button class="p-2 text-text-dim hover:text-error hover:bg-error-bg rounded border border-transparent hover:border-error" onclick={() => deletingId = account.id}>
              <Trash size={14} weight="fill" />
            </button>
          {/if}
        </div>
      </div>
    {/each}
  </div>
{/if}
