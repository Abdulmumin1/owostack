<script lang="ts">
  let {
    items,
  }: {
    items: {
      label: string;
      time: string;
      icon?: any;
      iconColor?: string;
    }[];
  } = $props();
</script>

{#if items.length > 0}
  <div class="divide-y divide-border/20">
    {#each items as item}
      <div class="px-4 py-3 flex items-start gap-3">
        <div class="w-6 h-6 rounded-full {item.iconColor || 'bg-white/5 text-zinc-500'} flex items-center justify-center shrink-0 mt-0.5">
          {#if item.icon}
            {@const Icon = item.icon}
            <Icon size={10} />
          {/if}
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-xs text-zinc-300 leading-snug">{item.label}</div>
          <div class="text-[10px] text-zinc-600 mt-0.5">{item.time}</div>
        </div>
      </div>
    {/each}
  </div>
{:else}
  <div class="p-8 text-center text-zinc-600 text-xs">
    No activity yet
  </div>
{/if}
