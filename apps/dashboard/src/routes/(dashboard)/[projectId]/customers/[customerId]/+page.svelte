<script lang="ts">
  import { page } from "$app/state";
  import CustomerDetail from "$lib/components/customers/CustomerDetail.svelte";

  const customerId = $derived(page.params.customerId ?? "");
  const planId = $derived(page.url.searchParams.get("planId"));
</script>

<svelte:head>
  <title>Customer Details - Owostack</title>
</svelte:head>

<div class="max-w-6xl mx-auto">
  {#if customerId}
    <CustomerDetail {customerId} {planId} variant="page" />
  {/if}
</div>
