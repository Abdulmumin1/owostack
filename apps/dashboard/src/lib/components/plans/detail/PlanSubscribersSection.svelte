<script lang="ts">
  import { PlusIcon, UsersIcon } from "phosphor-svelte";
  import Avatar from "$lib/components/ui/Avatar.svelte";
  import Skeleton from "$lib/components/ui/Skeleton.svelte";

  let {
    subscribers = [],
    isLoading = false,
    onAttachCustomer = () => {},
    onGenerateCheckout = (_subscriptionId: string) => {},
    onActivate = (_subscriptionId: string) => {},
  }: {
    subscribers?: any[];
    isLoading?: boolean;
    onAttachCustomer?: () => void;
    onGenerateCheckout?: (subscriptionId: string) => void;
    onActivate?: (subscriptionId: string) => void;
  } = $props();
</script>

<section class="space-y-4">
  <div class="flex items-center justify-between px-1 pb-2">
    <h2 class="text-sm font-semibold text-text-secondary flex items-center gap-2">
      <UsersIcon class="text-tertiary" size={18} weight="duotone" /> Subscribers
      {#if subscribers.length > 0}
        <span class="text-text-muted font-normal">&middot; {subscribers.length}</span>
      {/if}
    </h2>

    <button class="btn btn-secondary btn-sm gap-1.5" onclick={onAttachCustomer}>
      <PlusIcon size={14} weight="bold" /> Attach
    </button>
  </div>

  <div
    class="bg-bg-card border border-border divide-y divide-border/50 rounded-lg overflow-hidden"
  >
    {#if isLoading}
      <div class="p-4 space-y-3">
        {#each Array(2) as _}
          <div class="flex items-center gap-3">
            <Skeleton class="w-8 h-8 rounded-full" />
            <Skeleton class="h-4 flex-1" />
          </div>
        {/each}
      </div>
    {:else if subscribers.length > 0}
      {#each subscribers as subscriber}
        <div
          class="p-4 flex items-center justify-between hover:bg-bg-card-hover transition-colors group"
        >
          <div class="flex items-center gap-3 min-w-0">
            <div
              class="w-10 h-10 rounded-full border border-border bg-bg-primary overflow-hidden flex-shrink-0"
            >
              <Avatar name={subscriber.customer?.email || "?"} size={40} />
            </div>
            <div class="flex flex-col min-w-0">
              <span class="text-sm font-semibold text-text-primary truncate">
                {subscriber.customer?.name ||
                  subscriber.customer?.email ||
                  "Unknown"}
              </span>
              <span class="text-xs text-text-muted font-mono truncate">
                {subscriber.customer?.email || subscriber.customerId}
              </span>
            </div>
          </div>
          <div class="flex items-center gap-2">
            {#if subscriber.status === "pending"}
              <button
                class="text-xs font-semibold text-warning hover:underline uppercase p-0"
                onclick={() => onGenerateCheckout(subscriber.id)}
              >
                Link
              </button>
              <button
                class="text-xs font-semibold text-text-secondary hover:text-text-primary uppercase p-0"
                onclick={() => onActivate(subscriber.id)}
              >
                Act
              </button>
            {:else}
              <span
                class="badge {subscriber.status === 'active'
                  ? 'badge-success'
                  : 'badge-default'} uppercase"
              >
                {subscriber.status}
              </span>
            {/if}
          </div>
        </div>
      {/each}
    {:else}
      <div class="p-8 text-center">
        <span class="text-sm text-text-muted">No subscribers.</span>
      </div>
    {/if}
  </div>
</section>
