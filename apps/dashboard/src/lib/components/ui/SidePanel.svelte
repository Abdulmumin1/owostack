<script lang="ts">
  import { X } from "phosphor-svelte";
  import { fade, fly } from "svelte/transition";
  import type { Snippet } from "svelte";

  let {
    open = false,
    title = "",
    onclose,
    children,
    footer,
    width = "max-w-lg",
  }: {
    open: boolean;
    title?: string;
    onclose: () => void;
    children: Snippet;
    footer?: Snippet;
    width?: string;
  } = $props();

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && open) {
      e.preventDefault();
      onclose();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <!-- Backdrop -->
  <button
    class="fixed inset-0 bg-bg-primary/30 backdrop-blur-sm z-40 cursor-default"
    transition:fade={{ duration: 150 }}
    onclick={onclose}
    aria-label="Close panel"
  ></button>

  <!-- Panel -->
  <div
    role="dialog"
    aria-modal="true"
    aria-labelledby="panel-title"
    class="fixed top-0 right-0 h-full {width} w-full bg-bg-card border-l border-border z-50 flex flex-col"
    transition:fly={{ x: 400, duration: 200 }}
  >
    <div
      class="flex items-center justify-between px-5 py-4 border-b border-border shrink-0"
    >
      <h2 id="panel-title" class="text-xs font-bold text-text-primary uppercase tracking-widest">
        {title}
      </h2>
      <button
        class="p-1 text-text-dim hover:text-text-primary transition-colors"
        onclick={onclose}
        aria-label="Close panel"
      >
        <X size={16} weight="fill" />
      </button>
    </div>
    <div class="flex-1 overflow-y-auto">
      {@render children()}
    </div>
    {#if footer}
      <div class="p-4 border-t border-border shrink-0 bg-bg-card">
        {@render footer()}
      </div>
    {/if}
  </div>
{/if}
