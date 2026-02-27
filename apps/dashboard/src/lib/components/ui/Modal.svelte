<script lang="ts">
  import { X } from "phosphor-svelte";
  import { fade, scale } from "svelte/transition";
  import type { Snippet } from "svelte";

  let {
    open = false,
    title = "",
    onclose,
    children,
    width = "max-w-xl",
  }: {
    open: boolean;
    title?: string;
    onclose?: () => void;
    children: Snippet;
    width?: string;
  } = $props();

  function close() {
    if (onclose) onclose();
    else open = false;
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_consider_explicit_label -->
  <button
    class="fixed inset-0 bg-bg-primary/80 backdrop-blur-sm z-40 cursor-default"
    transition:fade={{ duration: 150 }}
    onclick={close}
  ></button>

  <div
    class="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 {width} w-[90%] max-h-[90vh] bg-bg-card border border-border shadow-lg rounded-xl flex flex-col z-50 overflow-hidden"
    transition:scale={{ duration: 150, start: 0.95 }}
  >
    <div
      class="flex items-center justify-between px-5 py-4 border-b border-border shrink-0 bg-bg-secondary/50"
    >
      <h2 class="text-xs font-bold text-text-primary uppercase tracking-widest">
        {title}
      </h2>
      <button
        class="p-1 text-text-dim hover:text-text-primary bg-bg-card border border-border rounded transition-colors"
        onclick={close}
      >
        <X size={14} weight="bold" />
      </button>
    </div>
    <div class="flex-1 overflow-y-auto w-full flex flex-col">
      {@render children()}
    </div>
  </div>
{/if}
