<script lang="ts">
  import {
    CircleNotch,
    MagnifyingGlass,
    Plus,
    Users,
  } from "phosphor-svelte";
  import Avatar from "$lib/components/ui/Avatar.svelte";
  import SidePanel from "$lib/components/ui/SidePanel.svelte";
  import Skeleton from "$lib/components/ui/Skeleton.svelte";

  let {
    open = false,
    plan = null,
    subscribers = [],
    results = [],
    isSearching = false,
    attachingCustomerId = null,
    onClose = () => {},
    onSearch = (_query: string) => {},
    onAttachCustomer = (_customerId: string) => {},
    onCreateCustomer = () => {},
  }: {
    open?: boolean;
    plan?: any;
    subscribers?: any[];
    results?: any[];
    isSearching?: boolean;
    attachingCustomerId?: string | null;
    onClose?: () => void;
    onSearch?: (query: string) => void;
    onAttachCustomer?: (customerId: string) => void;
    onCreateCustomer?: () => void;
  } = $props();

  let searchQuery = $state("");

  $effect(() => {
    if (!open) {
      searchQuery = "";
    }
  });

  function handleClose() {
    searchQuery = "";
    onClose();
  }

  function handleInput() {
    onSearch(searchQuery);
  }
</script>

<SidePanel
  open={open}
  title="Attach Customer to Plan"
  onclose={handleClose}
  width="max-w-[450px]"
>
  <div class="text-sm flex flex-col h-full">
    <div class="p-6 space-y-4">
      <p class="text-sm text-text-secondary leading-relaxed">
        Search for an existing customer to subscribe to <strong
          class="text-text-primary font-semibold"
        >
          {plan?.name || "this plan"}
        </strong>.
        {#if plan?.type !== "free"}
          Their subscription will start as <strong class="text-warning font-semibold">
            pending
          </strong> until they complete payment.
        {:else}
          Their subscription will be <strong class="text-success font-semibold">
            active
          </strong> immediately.
        {/if}
      </p>

      <div class="input-icon-wrapper pt-2">
        <MagnifyingGlass size={18} class="input-icon-left text-text-muted" />
        <input
          type="text"
          placeholder="Search by email, name or ID..."
          bind:value={searchQuery}
          oninput={handleInput}
          class="input input-has-icon-left"
          autofocus
        />
      </div>
    </div>

    <div
      class="flex-1 overflow-y-auto divide-y divide-border/50 border-t border-border-light bg-bg-card"
    >
      {#if isSearching}
        <div class="p-5 space-y-3">
          {#each Array(3) as _}
            <div class="flex items-center gap-3">
              <Skeleton class="w-10 h-10 rounded-full" />
              <div class="space-y-1.5 flex-1">
                <Skeleton class="h-4 w-32" />
                <Skeleton class="h-3 w-48" />
              </div>
            </div>
          {/each}
        </div>
      {:else if results.length > 0}
        {#each results as customer}
          {@const alreadyAttached = subscribers.some(
            (subscriber: any) => subscriber.customerId === customer.id,
          )}
          <button
            class="w-full flex items-center gap-3 px-6 py-4 hover:bg-bg-card-hover transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed group"
            disabled={alreadyAttached || attachingCustomerId === customer.id}
            onclick={() => onAttachCustomer(customer.id)}
          >
            <div
              class="w-10 h-10 rounded-full overflow-hidden shrink-0 border border-border"
            >
              <Avatar name={customer.email} size={40} />
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-sm font-semibold text-text-primary truncate">
                {customer.name || customer.email}
              </div>
              <div class="text-xs text-text-muted font-mono truncate">
                {customer.email}
              </div>
            </div>
            {#if alreadyAttached}
              <span class="badge badge-default uppercase">Subscribed</span>
            {:else if attachingCustomerId === customer.id}
              <CircleNotch size={18} class="animate-spin text-accent" />
            {/if}
          </button>
        {/each}
      {:else if searchQuery.trim()}
        <div class="p-12 flex flex-col items-center justify-center text-center">
          <Users size={32} class="text-text-muted mb-4" weight="duotone" />
          <p class="text-sm font-semibold text-text-secondary mb-1">
            No customers found
          </p>
          <p class="text-xs text-text-muted mb-6">
            We couldn't find anyone matching that search.
          </p>
          <button class="btn btn-primary" onclick={onCreateCustomer}>
            <Plus size={16} weight="fill" />
            Create Customer
          </button>
        </div>
      {:else}
        <div class="p-16 flex flex-col items-center justify-center text-center">
          <MagnifyingGlass
            size={32}
            class="text-text-muted mb-4"
            weight="duotone"
          />
          <p class="text-sm text-text-muted">Type to search for customers</p>
        </div>
      {/if}
    </div>

    <div class="p-5 border-t border-border bg-bg-card">
      <button
        class="btn btn-secondary w-full py-2.5 gap-2"
        onclick={onCreateCustomer}
      >
        <Plus size={16} weight="bold" />
        Create New Customer Instead
      </button>
    </div>
  </div>
</SidePanel>
