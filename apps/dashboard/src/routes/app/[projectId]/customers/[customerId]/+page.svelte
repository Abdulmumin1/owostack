<script lang="ts">
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";

  const organizationId = $derived(page.params.projectId);

  // This page is deprecated — customer details are now shown in the sidebar.
  // Redirect to the customers list.
  onMount(() => {
    goto(`/app/${organizationId}/customers`, { replaceState: true });
  });
</script>

<div class="flex items-center justify-center py-24 text-zinc-500 text-xs">
  Redirecting...
</div>
