<script lang="ts">
  let { 
    logoUrl, 
    alt,
    size = 20 
  }: { 
    logoUrl: string; 
    alt: string;
    size?: number 
  } = $props();

  let imageFailed = $state(false);

  // Reset error state when logoUrl changes
  $effect(() => {
    logoUrl;
    imageFailed = false;
  });
</script>

<div
  class="inline-flex items-center justify-center overflow-hidden"
  style={`width: ${size}px; height: ${size}px;`}
>
  {#if logoUrl && !imageFailed}
    <img
      src={logoUrl}
      alt={alt}
      width={size}
      height={size}
      class="h-full w-full object-contain"
      loading="lazy"
      onerror={() => {
        imageFailed = true;
      }}
    />
  {:else}
    <span class="text-[0.8em] font-bold text-current">
      {alt.charAt(0).toUpperCase()}
    </span>
  {/if}
</div>