<script lang="ts">
  import { Check, CheckCircle, CircleNotch, Copy, Key, Trash, X } from "phosphor-svelte";
  import { fade } from "svelte/transition";
  import { apiFetch } from "$lib/auth-client";
  import { getActiveEnvironment } from "$lib/env";
  import type { ApiKey } from "./types";

  let { 
    projectId,
    apiKeys: initialKeys = [],
    formatDate
  }: {
    projectId: string;
    apiKeys?: ApiKey[];
    formatDate: (date: string | number) => string;
  } = $props();

  let apiKeys = $state(initialKeys);
  let showKeyModal = $state(false);
  let newKeyName = $state("");
  let generatedKey = $state("");
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
          name: newKeyName
        })
      });
      
      if (res.data?.success) {
        generatedKey = res.data.data.secretKey;
        await loadApiKeys();
        newKeyName = "";
      }
    } catch (e) {
      console.error("Failed to create key", e);
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
      } else {
        alert("Failed to delete key: " + (res.data?.error || "Unknown error"));
      }
    } catch (e: any) {
      console.error("Failed to delete key", e);
      alert("Error: " + e.message);
    }
  }

  function copyUrl(url: string) {
    navigator.clipboard.writeText(url);
  }
</script>

<div class="flex items-center justify-between mb-6">
  <div>
    <h2 class="text-lg font-bold text-text-primary">API Keys</h2>
    <p class="text-xs text-text-dim mt-1">Manage access tokens for the API</p>
  </div>
  <button class="btn btn-primary" onclick={() => showKeyModal = true}>Create New Key</button>
</div>

{#if generatedKey}
  <div class="mb-8 bg-success-bg border border-success text-success rounded-lg p-4" in:fade>
    <div class="flex items-start gap-3">
      <CheckCircle size={20} class="text-success mt-1" weight="fill" />
      <div class="flex-1">
        <h4 class="text-sm font-bold text-text-primary mb-1">Key Generated Successfully</h4>
        <p class="text-xs text-text-dim mb-3">Copy your key now. You won't see it again.</p>
        <div class="flex items-center gap-2 bg-bg-secondary border border-border rounded px-3 py-2">
          <code class="text-sm font-mono text-success flex-1">{generatedKey}</code>
          <button class="text-text-dim hover:text-text-primary" onclick={() => copyUrl(generatedKey)}>
            <Copy size={16} weight="fill" />
          </button>
        </div>
      </div>
      <button class="text-text-dim hover:text-text-primary" onclick={() => generatedKey = ""}><X size={16} weight="fill" /></button>
    </div>
  </div>
{/if}

{#if showKeyModal}
  <div class="mb-8 bg-bg-secondary border border-border rounded-lg p-6">
    <h3 class="text-sm font-bold text-text-primary mb-4">Create New API Key</h3>
    <div class="flex gap-4">
      <input type="text" placeholder="Key Name" bind:value={newKeyName} class="flex-1 input" />
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
            <span class="text-[10px] px-1.5 py-0.5 border {getActiveEnvironment() === 'live' ? 'border-success text-success' : 'border-warning text-warning'} uppercase tracking-wider font-bold rounded-sm">
              {getActiveEnvironment()}
            </span>
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
            <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-success-bg text-success border border-success">Active</span>
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
