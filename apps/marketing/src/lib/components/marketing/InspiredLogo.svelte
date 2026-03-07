<script lang="ts">
  let { name, size = 20 }: { name: string; size?: number } = $props();

  const normalizedName = $derived(name.toLowerCase());

  const brandLogo = $derived.by(() => {
    if (normalizedName.includes("basecamp")) {
      return {
        alt: "Basecamp logo",
        src: "https://cdn.brandfetch.io/domain/basecamp.com?c=1iduQCu8CNcitTrpDvi",
        fallback: "B",
      };
    }

    if (normalizedName.includes("notion")) {
      return {
        alt: "Notion logo",
        src: "https://cdn.brandfetch.io/domain/notion.so?c=1iduQCu8CNcitTrpDvi",
        fallback: "N",
      };
    }

    if (normalizedName.includes("openai")) {
      return {
        alt: "OpenAI logo",
        src: "https://cdn.brandfetch.io/domain/openai.com?c=1iduQCu8CNcitTrpDvi",
        fallback: "O",
      };
    }

    if (normalizedName.includes("stripe")) {
      return {
        alt: "Stripe logo",
        src: "https://cdn.brandfetch.io/domain/stripe.com?c=1iduQCu8CNcitTrpDvi",
        fallback: "S",
      };
    }

    if (normalizedName.includes("aws")) {
      return {
        alt: "AWS logo",
        src: "https://cdn.brandfetch.io/domain/aws.amazon.com?c=1iduQCu8CNcitTrpDvi",
        fallback: "A",
      };
    }

    if (normalizedName.includes("slack")) {
      return {
        alt: "Slack logo",
        src: "https://cdn.brandfetch.io/domain/slack.com?c=1iduQCu8CNcitTrpDvi",
        fallback: "S",
      };
    }

    if (normalizedName.includes("figma")) {
      return {
        alt: "Figma logo",
        src: "https://cdn.brandfetch.io/domain/figma.com?c=1iduQCu8CNcitTrpDvi",
        fallback: "F",
      };
    }

    return {
      alt: `${name} mark`,
      src: null,
      fallback: name.trim().charAt(0).toUpperCase() || "?",
    };
  });

  let imageFailed = $state(false);

  $effect(() => {
    normalizedName;
    imageFailed = false;
  });
</script>

<div
  class="inline-flex items-center justify-center overflow-hidden"
  style={`width: ${size}px; height: ${size}px;`}
>
  {#if brandLogo.src && !imageFailed}
    <img
      src={brandLogo.src}
      alt={brandLogo.alt}
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
      {brandLogo.fallback}
    </span>
  {/if}
</div>
