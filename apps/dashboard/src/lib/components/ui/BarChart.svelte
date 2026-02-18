<script lang="ts">
  let {
    data,
    labelStart = "",
    labelEnd = "",
  }: {
    data: { label: string; value: number }[];
    labelStart?: string;
    labelEnd?: string;
  } = $props();

  const maxValue = $derived(Math.max(...data.map((d) => d.value), 1));
</script>

<div>
  <div class="flex items-end gap-0.75 h-24">
    {#each data as item}
      {@const height = item.value > 0 ? Math.max(4, (item.value / maxValue) * 96) : 2}
      <div class="group relative flex-1 flex flex-col justify-end">
        <div
          class="w-full {item.value > 0 ? 'bg-accent/60 hover:bg-accent' : 'bg-black/5 dark:bg-white/5'} transition-colors rounded-sm"
          style="height: {height}px"
        ></div>
        <div class="absolute -top-8 left-1/2 -translate-x-1/2 bg-bg-card border border-border px-2 py-1 rounded text-[9px] text-text-primary font-bold whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 shadow-xl">
          {item.value} · {item.label}
        </div>
      </div>
    {/each}
  </div>
  {#if labelStart || labelEnd}
    <div class="flex justify-between mt-2">
      <span class="text-[9px] text-text-dim">{labelStart}</span>
      <span class="text-[9px] text-text-dim">{labelEnd}</span>
    </div>
  {/if}
</div>
