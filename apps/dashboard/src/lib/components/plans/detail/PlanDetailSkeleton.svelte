<script lang="ts">
  import Skeleton from "$lib/components/ui/Skeleton.svelte";
</script>

<div class="space-y-10">
  <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-8">
    {#each Array(4) as _}
      <div class="bg-bg-card border border-border p-4 rounded-lg space-y-3">
        <Skeleton class="h-3 w-20" />
        <Skeleton class="h-5 w-32" />
      </div>
    {/each}
  </div>

  <div class="grid lg:grid-cols-2 gap-8 lg:gap-12">
    {#each Array(2) as _}
      <div class="space-y-6">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <Skeleton class="w-8 h-8 rounded" />
            <Skeleton class="h-4 w-48" />
          </div>
          <Skeleton class="h-9 w-32" />
        </div>
        <div
          class="bg-bg-card border border-border divide-y divide-border/50 rounded"
        >
          {#each Array(3) as _}
            <div class="p-6 flex items-center justify-between">
              <div class="flex items-center gap-5">
                <Skeleton class="w-10 h-10 rounded" />
                <div class="space-y-2">
                  <Skeleton class="h-4 w-32" />
                  <Skeleton class="h-3 w-48" />
                </div>
              </div>
              <Skeleton class="h-8 w-8 rounded" />
            </div>
          {/each}
        </div>
      </div>
    {/each}
  </div>
</div>
