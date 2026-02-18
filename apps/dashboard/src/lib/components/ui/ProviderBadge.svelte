<script lang="ts">
  let {
    providerId,
    size = "sm",
  }: {
    providerId: string | null | undefined;
    size?: "xs" | "sm";
  } = $props();

  const label = $derived(
    providerId
      ? providerId.charAt(0).toUpperCase() + providerId.slice(1)
      : "Unknown"
  );

  const colorClass = $derived.by(() => {
    switch (providerId) {
      case "paystack":
        return "bg-teal-500/10 text-teal-700 dark:text-teal-400 border-teal-500/20";
      case "dodopayments":
        return "bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/20";
      case "stripe":
        return "bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border-indigo-500/20";
      default:
        return "bg-bg-secondary text-text-secondary border-border";
    }
  });

  const sizeClass = $derived(
    size === "xs"
      ? "text-[7px] px-1 py-px"
      : "text-[8px] px-1.5 py-0.5"
  );
</script>

{#if providerId}
  <span class="inline-flex items-center rounded font-bold uppercase tracking-wider border {colorClass} {sizeClass}">
    {label}
  </span>
{/if}
