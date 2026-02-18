<script lang="ts">
  import { X } from "lucide-svelte";
  import { fade, fly } from "svelte/transition";
  import type { Snippet } from "svelte";

  let {
    open = false,
    title = "",
    onclose,
    children,
    width = "max-w-lg",
  }: {
    open: boolean;
    title?: string;
    onclose: () => void;
    children: Snippet;
    width?: string;
  } = $props();
</script>

{#if open}
  <!-- Backdrop -->
  <button
    class="fixed inset-0 bg-black/50 backdrop-blur-xs z-40 cursor-default"
    transition:fade={{ duration: 150 }}
    onclick={onclose}
    aria-label="Close panel"
  ></button>

  <!-- Panel -->
  <div
    class="fixed top-0 right-0 h-full {width} w-full bg-bg-secondary border-l border-border z-50 flex flex-col shadow-2xl"
    transition:fly={{ x: 400, duration: 200 }}
  >
    <div class="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
      <h2 class="text-xs font-bold text-text-primary uppercase tracking-widest">{title}</h2>
      <button
        class="p-1 text-text-dim hover:text-text-primary transition-colors"
        onclick={onclose}
      >
        <X size={16} />
      </button>
    </div>
    <div class="flex-1 overflow-y-auto">
      {@render children()}
    </div>
  </div>
{/if}
