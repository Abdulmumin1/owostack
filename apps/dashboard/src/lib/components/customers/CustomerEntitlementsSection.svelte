<script lang="ts">
  import {
    Plus as PlusIcon,
    Trash as TrashIcon,
    ShieldCheck,
    Clock,
    Infinity as InfinityIcon,
    Info,
    Check,
    Hash,
  } from "phosphor-svelte";
  import { apiFetch } from "$lib/auth-client";
  import { page } from "$app/state";
  import GrantOverrideModal from "../entitlements/GrantOverrideModal.svelte";

  let { customerId }: { customerId: string } = $props();

  const organizationId = $derived(page.params.projectId);
  let overrides = $state<any[]>([]);
  let isLoading = $state(false);
  let isOverrideModalOpen = $state(false);

  async function loadOverrides() {
    if (!organizationId) return;
    isLoading = true;
    try {
      const res = await apiFetch(
        `/api/dashboard/entitlement-overrides?customerId=${customerId}&organizationId=${organizationId}`,
      );
      if (res.data?.success) {
        overrides = res.data.data;
      }
    } catch (e) {
      console.error("Failed to load overrides:", e);
    } finally {
      isLoading = false;
    }
  }

  async function removeOverride(id: string) {
    if (!confirm("Are you sure you want to remove this entitlement override?"))
      return;

    try {
      const res = await apiFetch(`/api/dashboard/entitlement-overrides/${id}?organizationId=${organizationId}`, {
        method: "DELETE",
      });
      if (res.data?.success) {
        overrides = overrides.filter((o) => o.id !== id);
      }
    } catch (e) {
      console.error("Failed to remove override:", e);
    }
  }

  $effect(() => {
    if (customerId) {
      loadOverrides();
    }
  });

  function formatValue(val: number | null) {
    return val === null ? "Unlimited" : val.toLocaleString();
  }

  function formatDate(ts: number | null) {
    if (!ts) return "Never";
    return new Date(ts).toLocaleDateString();
  }
</script>

<div class="space-y-4">
  <div class="flex items-center justify-between">
    <div class="flex items-center gap-2">
      <h3
        class="text-[10px] font-bold text-text-primary uppercase tracking-[0.15em]"
      >
        Entitlement Overrides
      </h3>
    </div>
    <button
      class="text-[10px] font-bold text-accent hover:text-accent-hover flex items-center gap-1 transition-colors uppercase tracking-widest"
      onclick={() => (isOverrideModalOpen = true)}
    >
      <PlusIcon size={12} weight="bold" />
      Grant Override
    </button>
  </div>

  {#if isLoading}
    <div class="flex items-center gap-2 text-[11px] text-text-dim py-4">
      <Clock size={12} class="animate-spin" />
      Loading overrides...
    </div>
  {:else if overrides.length === 0}
    <div
      class="bg-bg-secondary/50 border border-border border-dashed rounded-lg p-6 flex flex-col items-center justify-center text-center space-y-2"
    >

      <div>
        <p class="text-[11px] font-medium text-text-dim">
          No manual overrides granted
        </p>
        <p class="text-[10px] text-text-dim/60 mt-1 max-w-[200px]">
          Overrides allow you to grant specific features regardless of the
          customer's plan.
        </p>
      </div>
    </div>
  {:else}
    <div class="grid gap-2">
      {#each overrides as override}
        <div
          class="bg-bg-card border border-border rounded-lg p-3 group hover:border-accent/30 transition-all"
        >
          <div class="flex items-start justify-between">
            <div class="space-y-1">
              <div class="flex items-center gap-2">
                <span class="text-xs font-bold text-text-primary"
                  >{override.feature?.name}</span
                >
                <!-- <span
                  class="text-[9px] px-1.5 py-0.5 bg-accent/10 text-accent font-bold rounded uppercase tracking-wider"
                  >Manual</span
                > -->
              </div>
              <div class="flex items-center gap-3 text-[10px] text-text-dim">
                {#if override.feature?.type === "metered"}
                  <div class="flex items-center gap-1">
                    <InfinityIcon size={12} weight="bold" />
                    <span
                      >Limit: <span class="text-text-primary font-medium"
                        >{formatValue(override.limitValue)}</span
                      ></span
                    >
                  </div>
                {:else if override.feature?.type === "static"}
                  <div class="flex items-center gap-1">
                    <Hash size={12} weight="bold" />
                    <span
                      >Value: <span class="text-text-primary font-medium"
                        >{override.limitValue}</span
                      ></span
                    >
                  </div>
                {:else if override.feature?.type === "boolean"}
                  <div class="flex items-center gap-1">
                    <Check size={12} weight="bold" class="text-accent" />
                    <span class="text-text-primary font-medium">Granted</span>
                  </div>
                {/if}
                <div class="flex items-center gap-1">
                  <Clock size={12} />
                  <span
                    >Expires: <span class="text-text-primary font-medium"
                      >{formatDate(override.expiresAt)}</span
                    ></span
                  >
                </div>
              </div>
              {#if override.grantedReason}
                <div class="flex items-center gap-1.5 mt-2 text-[9px] text-text-dim/80 bg-bg-secondary/50 px-2 py-1 rounded border border-border/50 italic">
                  <Info size={10} />
                  <span>"{override.grantedReason}"</span>
                </div>
              {/if}
            </div>
            <button
              class="p-1.5 text-text-dim hover:text-error hover:bg-error/10 rounded transition-all opacity-0 group-hover:opacity-100"
              onclick={() => removeOverride(override.id)}
              title="Remove Override"
            >
              <TrashIcon size={14} />
            </button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<GrantOverrideModal
  bind:isOpen={isOverrideModalOpen}
  {customerId}
  onsuccess={loadOverrides}
/>
