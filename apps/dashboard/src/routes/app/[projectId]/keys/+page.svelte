<script lang="ts">
  import { Copy, Plus, AlertCircle, Key, Loader2, Trash2, Check } from 'lucide-svelte';
  import { page } from "$app/state";
  import { apiFetch } from "$lib/auth-client";
  import { fade, fly } from "svelte/transition";
  
  // Note: projectId in URL is actually the organization ID from Better Auth
  const organizationId = $derived(page.params.projectId);
  let keys = $state<any[]>([]);
  let isLoading = $state(true);
  let showCreateModal = $state(false);
  let isCreating = $state(false);
  
  // Form State
  let newKeyName = $state("");
  let generatedKey: string | null = $state(null);

  async function loadKeys() {
    isLoading = true;
    try {
      const res = await apiFetch(`/api/dashboard/keys?organizationId=${organizationId}`);
      if (res.data) {
        keys = res.data.data;
      }
    } catch (e) {
      console.error("Failed to load keys", e);
    } finally {
      isLoading = false;
    }
  }

  $effect(() => {
    if (organizationId) loadKeys();
  });
  
  async function createKey() {
    if (!newKeyName) return;
    
    isCreating = true;
    try {
      const res = await apiFetch("/api/dashboard/keys", {
        method: "POST",
        body: JSON.stringify({
          organizationId,
          name: newKeyName
        })
      });

      if (res.error) throw new Error(res.error.message || "Unknown error creating key");

      if (!res.data?.success) {
         throw new Error(res.data?.error || "Failed to create key");
      }

      generatedKey = res.data.data.secretKey;
      await loadKeys();
    } catch (e) {
      alert("Failed to create key: " + (e as Error).message);
    } finally {
      isCreating = false;
    }
  }

  function closeAndReset() {
    showCreateModal = false;
    newKeyName = "";
    generatedKey = null;
  }
  
  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
  }
</script>

<svelte:head>
  <title>API Keys - Owostack</title>
</svelte:head>

<div class="max-w-4xl">
  <div class="flex items-center justify-between mb-8">
    <div>
      <h1 class="text-xl font-bold text-white mb-2">API Keys</h1>
      <p class="text-zinc-500 text-xs uppercase tracking-widest font-semibold">Manage access to your project</p>
    </div>
    
    {#if keys.length > 0}
      <button 
        class="btn btn-primary"
        onclick={() => showCreateModal = true}
      >
        <Plus size={16} />
        Create New Key
      </button>
    {/if}
  </div>

  {#if isLoading}
    <div class="flex items-center gap-2 text-zinc-500">
      <Loader2 size={16} class="animate-spin" />
      <span>Loading keys...</span>
    </div>
  {:else if keys.length === 0}
    <div class="bg-bg-card border border-border p-12 flex flex-col items-center justify-center text-center shadow-md">
      <div class="w-12 h-12 bg-white/5 flex items-center justify-center mb-4">
        <Key size={24} class="text-zinc-500" />
      </div>
      <h3 class="text-lg font-bold text-white mb-2">No API keys found</h3>
      <p class="text-zinc-500 max-w-sm mb-6">
        Create an API key to authenticate requests from your application.
      </p>
      <button 
        class="btn btn-primary"
        onclick={() => showCreateModal = true}
      >
        Create New Key
      </button>
    </div>
  {:else}
    <!-- Keys List -->
    <div class="space-y-4">
      {#each keys as key}
        <div class="bg-bg-card border border-border p-5 flex items-center justify-between group hover:border-zinc-500 transition-colors shadow-sm">
          <div class="flex-1">
            <div class="flex items-center gap-3 mb-1">
              <h3 class="font-bold text-white text-sm">{key.name}</h3>
              <span class="text-[10px] bg-zinc-800 text-zinc-400 px-1.5 py-0.5 uppercase tracking-wider">
                Live
              </span>
            </div>
            <div class="flex items-center gap-2 text-xs text-zinc-500 font-mono">
              <span>{key.prefix}••••••••••••••••••••</span>
              <span class="w-1 h-1 rounded-full bg-zinc-700"></span>
              <span>Created {new Date(key.createdAt).toLocaleDateString()}</span>
            </div>
          </div>
          
          <div class="flex items-center gap-6">
            <div class="text-right hidden md:block">
              <div class="text-xs text-white font-bold">Last used</div>
              <div class="text-[10px] text-zinc-500 uppercase tracking-wider">
                {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleDateString() : 'Never'}
              </div>
            </div>
            
            <div class="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <button class="p-2 hover:bg-red-900/20 text-zinc-400 hover:text-red-400" title="Revoke Key">
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<!-- Create Modal -->
{#if showCreateModal}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" transition:fade={{ duration: 150 }}>
    <div class="w-full max-w-md bg-bg-card border border-border p-6 shadow-2xl relative" transition:fly={{ y: 20, duration: 200 }}>
      {#if !generatedKey}
        <h2 class="text-lg font-bold text-white mb-4">Create API Key</h2>
        
        <div class="mb-6">
          <label for="keyName" class="block text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">Key Name</label>
          <input 
            type="text" 
            id="keyName" 
            bind:value={newKeyName}
            placeholder="e.g. Production Server" 
            class="input"
            autoFocus
          />
        </div>
        
        <div class="flex items-center justify-end gap-3">
          <button 
            class="btn-ghost text-xs uppercase tracking-wider font-bold"
            onclick={() => showCreateModal = false}
          >
            Cancel
          </button>
          <button 
            class="btn btn-primary"
            onclick={createKey}
            disabled={!newKeyName || isCreating}
          >
            {#if isCreating}
              Creating...
            {:else}
              Create Key
            {/if}
          </button>
        </div>
      {:else}
        <!-- Success State - Show Key -->
        <div class="text-center mb-6">
          <div class="w-12 h-12 bg-green-500/10 flex items-center justify-center mx-auto mb-4 rounded-full">
            <Check size={24} class="text-green-500" />
          </div>
          <h2 class="text-lg font-bold text-white mb-2">API Key Created</h2>
          <p class="text-zinc-400 text-xs mb-6">
            This key will not be shown again. Copy it now and store it securely.
          </p>
          
          <div class="bg-black border border-border p-3 flex items-center gap-2 mb-2">
            <code class="flex-1 font-mono text-sm text-green-400 break-all text-left">
              {generatedKey}
            </code>
            <button 
              class="p-2 hover:text-white text-zinc-500 transition-colors"
              onclick={() => copyToClipboard(generatedKey!)}
            >
              <Copy size={16} />
            </button>
          </div>
        </div>
        
        <button class=" btn btn-primary w-full" onclick={closeAndReset}>
          I've saved it
        </button>
      {/if}
    </div>
  </div>
{/if}

