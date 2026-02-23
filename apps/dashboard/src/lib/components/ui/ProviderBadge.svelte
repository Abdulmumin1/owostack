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
        return "bg-secondary-light text-secondary border-secondary/20";
      case "dodopayments":
        return "bg-info-bg text-info border-info/20";
      case "polar":
        return "bg-rose-100 text-rose-700 border-rose-300";
      case "stripe":
        return "bg-tertiary-light text-tertiary border-tertiary/20";
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
