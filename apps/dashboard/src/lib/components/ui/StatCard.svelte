<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    label,
    value,
    subtitle = undefined,
    icon: Icon = undefined,
    iconColor = "text-zinc-500 bg-white/5",
    children = undefined,
  }: {
    label: string;
    value: string | number;
    subtitle?: string;
    icon?: any;
    iconColor?: string;
    children?: Snippet;
  } = $props();
</script>

<div class="bg-bg-card border border-border p-5 shadow-md">
  <div class="flex items-center gap-2 mb-3">
    {#if Icon}
      <div class="w-7 h-7 {iconColor} flex items-center justify-center rounded">
        <Icon size={14} />
      </div>
    {/if}
    <span class="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{label}</span>
  </div>
  <div class="text-2xl font-bold text-white">{value}</div>
  {#if subtitle}
    <p class="text-[10px] text-zinc-600 mt-1.5">{subtitle}</p>
  {/if}
  {#if children}
    {@render children()}
  {/if}
</div>
