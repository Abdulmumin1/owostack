<script lang="ts">
  let {
    value,
    max,
    color = "bg-accent",
    height = "h-1.5",
  }: {
    value: number;
    max: number;
    color?: string;
    height?: string;
  } = $props();

  const pct = $derived(max > 0 ? Math.min((value / max) * 100, 100) : 0);
</script>

<div class="{height} bg-black/5 dark:bg-white/5 rounded-full overflow-hidden">
  <div class="{height} {color} rounded-full transition-all" style="width: {pct}%"></div>
</div>
