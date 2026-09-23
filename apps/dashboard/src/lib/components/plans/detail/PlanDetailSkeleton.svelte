<script lang="ts">
  import Skeleton from "$lib/components/ui/Skeleton.svelte";
</script>

<!--
  Mirrors the loaded plan detail page (PlanDetailHeader + stacked
  features/subscribers sections) so nothing shifts when data arrives.
-->
<div class="space-y-4">
  <!-- PlanDetailHeader -->
  <div class="flex items-start justify-between gap-4">
    <div class="space-y-2">
      <Skeleton class="h-4 w-32" />
      <Skeleton class="h-8 w-64" />
      <Skeleton class="h-3 w-40" />
    </div>
    <div class="flex items-center gap-2 shrink-0">
      <Skeleton class="h-8 w-24 rounded-sm" />
      <Skeleton class="h-8 w-24 rounded-sm" />
    </div>
  </div>

  <div class="flex flex-col gap-8">
    <!-- Attached Features -->
    <section class="space-y-3">
      <div class="flex items-center justify-between px-1">
        <Skeleton class="h-3 w-36" />
        <Skeleton class="h-7 w-28 rounded-sm" />
      </div>
      <div
        class="bg-bg-card border border-border divide-y divide-border/40 rounded-xl overflow-hidden"
      >
        {#each Array(3) as _}
          <div class="px-3 py-2.5 flex items-center justify-between">
            <div class="flex items-center gap-3">
              <Skeleton class="w-7 h-7 rounded-md" />
              <div class="space-y-1.5">
                <Skeleton class="h-3 w-40" />
                <Skeleton class="h-2.5 w-24" />
              </div>
            </div>
            <Skeleton class="h-3 w-16" />
          </div>
        {/each}
      </div>
    </section>

    <!-- Subscribers -->
    <section class="space-y-3">
      <div class="flex items-center justify-between px-1">
        <Skeleton class="h-3 w-24" />
        <div class="flex items-center gap-2">
          <Skeleton class="h-7 w-24 rounded-sm" />
          <Skeleton class="h-7 w-20 rounded-sm" />
        </div>
      </div>
      <div
        class="bg-bg-card border border-border divide-y divide-border/40 rounded-xl overflow-hidden"
      >
        {#each Array(3) as _}
          <div class="px-3 py-2 flex items-center gap-3">
            <Skeleton class="w-7 h-7 rounded-full" />
            <div class="space-y-1.5 flex-1">
              <Skeleton class="h-3 w-32" />
              <Skeleton class="h-2.5 w-24" />
            </div>
            <Skeleton class="w-4 h-4" />
          </div>
        {/each}
      </div>
    </section>
  </div>
</div>
