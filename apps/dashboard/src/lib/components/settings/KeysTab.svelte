<script lang="ts">
  import { CheckCircle, CircleNotch, Copy, Key, Trash, X } from "phosphor-svelte";
  import { fade } from "svelte/transition";
  import { apiFetch } from "$lib/auth-client";
  import { getActiveEnvironment, type AppEnvironment } from "$lib/env";
  import { toast } from "svelte-sonner";
  import type { ApiKey } from "./types";

  const ENVIRONMENT_LABELS: Record<AppEnvironment, string> = {
    test: "Sandbox",
    live: "Live"
  };

  let { 
    projectId,
    apiKeys: apiKeysProp = [],
    formatDate
  }: {
    projectId: string;
    apiKeys?: ApiKey[];
    formatDate: (date: string | number) => string;
  } = $props();

  // Writable derived: follows the prop, but can be overwritten after a reload.
  let apiKeys = $derived<ApiKey[]>(apiKeysProp);
  let showKeyModal = $state(false);
  let newKeyName = $state("");
  let newKeyEnvironment = $state<AppEnvironment>(getActiveEnvironment());
  let generatedKey = $state("");
  let generatedKeyEnvironment = $state<AppEnvironment | null>(null);
  let isCreatingKey = $state(false);

  async function loadApiKeys() {
    const res = await apiFetch(`/api/dashboard/keys?organizationId=${projectId}`);
    if (res.data?.success) {
      apiKeys = res.data.data;
    }
  }

  async function createKey() {
    if (!newKeyName) return;
    isCreatingKey = true;
    try {
      const res = await apiFetch("/api/dashboard/keys", {
        method: "POST",
        body: JSON.stringify({
          organizationId: projectId,
          name: newKeyName,
          environment: newKeyEnvironment
        })
      });

      if (res.data?.success) {
        generatedKey = res.data.data.secretKey;
        generatedKeyEnvironment = newKeyEnvironment;
        await loadApiKeys();
        newKeyName = "";
        showKeyModal = false;
        toast.success("API key created", {
          description: "Copy your key now - you won't see it again"
        });
      } else {
        toast.error("Failed to create key", {
          description: res.data?.error || "Unknown error"
        });
      }
    } catch (e: any) {
      console.error("Failed to create key", e);
      toast.error("Error creating key", {
        description: e.message
      });
    } finally {
      isCreatingKey = false;
    }
  }

  async function deleteKey(id: string) {
    if (!confirm("Are you sure you want to revoke this API key?")) return;

    try {
      const res = await apiFetch(`/api/dashboard/keys/${id}?organizationId=${projectId}`, {
        method: "DELETE"
      });
      if (res.data?.success) {
        await loadApiKeys();
        toast.success("API key revoked successfully");
      } else {
        toast.error("Failed to revoke key", {
          description: res.data?.error || "Unknown error"
        });
      }
    } catch (e: any) {
      console.error("Failed to delete key", e);
      toast.error("Error revoking key", {
        description: e.message
      });
    }
  }

  function copyUrl(url: string) {
    navigator.clipboard.writeText(url);
    toast.success("Copied to clipboard", {
      description: "API key has been copied"
    });
  }
</script>

<div class="flex items-center justify-between mb-6">
  <div>
   
  </div>
  <button class="btn btn-primary" onclick={() => showKeyModal = true}>Create New Key</button>
</div>

{#if generatedKey}
  <div class="mb-8 bg-success-bg border border-success text-success rounded-lg p-4" in:fade>
    <div class="flex items-start gap-3">
      <CheckCircle size={20} class="text-success mt-1" weight="fill" />
      <div class="flex-1">
        <h4 class="text-sm font-bold text-text-primary mb-1">Key Generated Successfully</h4>
        <p class="text-xs text-text-dim mb-3">
          Copy your key now. You won't see it again.
          {#if generatedKeyEnvironment}
            This key only works against the
            <strong>{ENVIRONMENT_LABELS[generatedKeyEnvironment]}</strong> API
            ({generatedKeyEnvironment === "live" ? "api.owostack.com" : "sandbox.owostack.com"}).
          {/if}
        </p>
        <div class="flex items-center gap-2 bg-bg-secondary border border-border rounded px-3 py-2">
          <code class="text-sm font-mono text-success flex-1">{generatedKey}</code>
          <button class="text-text-dim hover:text-text-primary" onclick={() => copyUrl(generatedKey)}>
            <Copy size={16} weight="fill" />
          </button>
        </div>
      </div>
      <button class="text-text-dim hover:text-text-primary" onclick={() => { generatedKey = ""; generatedKeyEnvironment = null; }}><X size={16} weight="fill" /></button>
    </div>
  </div>
{/if}

{#if showKeyModal}
  <div class="mb-8 bg-bg-secondary border border-border rounded-lg p-6">
    <h3 class="text-sm font-bold text-text-primary mb-1">Create New API Key</h3>
    <p class="text-xs text-text-dim mb-4">
      Keys are scoped to one environment. A Sandbox key is rejected by the Live API and vice versa.
    </p>
    <div class="flex gap-4">
      <input type="text" placeholder="Key Name" bind:value={newKeyName} class="flex-1 input" />
      <select bind:value={newKeyEnvironment} class="input w-40" aria-label="Key environment">
        <option value="test">Sandbox</option>
        <option value="live">Live</option>
      </select>
      <button class="btn btn-secondary" onclick={() => { showKeyModal = false; newKeyName = ""; }}>Cancel</button>
      <button class="btn btn-primary" disabled={!newKeyName || isCreatingKey} onclick={createKey}>
        {#if isCreatingKey} <CircleNotch size={16} class="animate-spin" /> {:else} Create {/if}
      </button>
    </div>
  </div>
{/if}

<div class="space-y-4">
  {#each apiKeys as key (key.id)}
    <div class="flex items-center justify-between p-4 bg-bg-secondary border border-border rounded-lg group hover:border-text-dim transition-colors">
      <div class="flex items-center gap-4">
        <div class="bg-accent/10 p-2 rounded text-accent"><Key size={18} /></div>
        <div>
          <div class="flex items-center gap-2 mb-1">
            <h3 class="text-sm font-bold text-text-primary">{key.name}</h3>
            {#if key.environment === "live"}
              <span class="badge badge-warning">Live</span>
            {:else if key.environment === "test"}
              <span class="badge badge-info">Sandbox</span>
            {:else}
              <span class="badge badge-default" title="Issued before environment scoping; works on both Sandbox and Live. Rotate to a scoped key.">Legacy</span>
            {/if}
          </div>
          <div class="text-xs font-mono text-text-dim">
            {key.prefix}•••••••• • Created {formatDate(key.createdAt)}
          </div>
        </div>
      </div>
      
      <div class="flex items-center gap-6">
        <div class="text-right hidden md:block">
          <div class="text-[10px] text-text-primary font-bold uppercase tracking-wider">Last used</div>
          <div class="text-[10px] text-text-dim uppercase tracking-widest mt-0.5">
            {key.lastUsedAt ? formatDate(key.lastUsedAt) : 'Never'}
          </div>
        </div>

        <div class="flex items-center gap-3">
            <button 
              class="p-2 text-text-dim hover:text-error hover:bg-error-bg transition-all rounded"
              onclick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                deleteKey(key.id);
              }}
              title="Revoke Key"
            >
              <Trash size={16} weight="fill" />
            </button>
        </div>
      </div>
    </div>
  {/each}
  {#if apiKeys.length === 0}
    <div class="text-center py-12 border border-dashed border-border rounded-lg">
      <Key size={24} class="text-text-dim/20 mx-auto mb-3" />
      <p class="text-text-dim text-sm">No API keys generated yet</p>
    </div>
  {/if}
</div>
