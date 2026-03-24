<script lang="ts">
  import { getProviderConfig } from "$lib/providers";

  let {
    providerId,
    size = "sm",
  }: {
    providerId: string | null | undefined;
    size?: "xs" | "sm";
  } = $props();

  const provider = $derived(
    providerId ? getProviderConfig(providerId) : undefined,
  );

  const label = $derived(
    provider?.name ??
      (providerId
        ? providerId.charAt(0).toUpperCase() + providerId.slice(1)
        : "Unknown"),
  );

  const variantClass = $derived(
    provider?.id ? `provider-badge--${provider.id}` : "provider-badge--default",
  );

  const sizeClass = $derived(
    size === "xs" ? "provider-badge-xs" : "provider-badge-xs",
  );

  const logoSizeClass = $derived(
    size === "xs" ? "provider-badge__logo-xs" : "provider-badge__logo-sm",
  );

  const markSizeClass = $derived(
    size === "xs" ? "provider-badge__mark-xs" : "provider-badge__mark-xs",
  );
</script>

{#if providerId}
  <span class=" {variantClass} {sizeClass}">
    {#if provider?.logoUrl}
      <span class="provider-badge__mark {markSizeClass}" aria-hidden="true">
        <img src={provider.logoUrl} alt="" class=" {logoSizeClass}" />
      </span>
    {/if}
    <!-- {label} -->
  </span>
{/if}
