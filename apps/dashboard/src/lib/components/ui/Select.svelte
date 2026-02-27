<script lang="ts">
  import { CaretDown, Check } from "phosphor-svelte";
  import { onMount, type Snippet } from "svelte";
  import { slide } from "svelte/transition";

  let {
    options,
    value = $bindable(),
    placeholder = "Select an option",
    class: className = "",
  }: {
    options: Array<{ id: string | number; label: string }>;
    value: string | number;
    placeholder?: string;
    class?: string;
  } = $props();

  let isOpen = $state(false);
  let containerEl: HTMLElement;

  function handleSelect(id: string | number) {
    value = id;
    isOpen = false;
  }

  function handleClickOutside(event: MouseEvent) {
    if (containerEl && !containerEl.contains(event.target as Node)) {
      isOpen = false;
    }
  }

  onMount(() => {
    document.addEventListener("click", handleClickOutside);
    return () => {
      document.removeEventListener("click", handleClickOutside);
    };
  });

  const selectedOption = $derived(options.find((o) => o.id === value));
</script>

<div class="relative inline-block {className}" bind:this={containerEl}>
  <button
    type="button"
    class="flex items-center justify-between gap-3 w-full min-w-[140px] px-3 py-1.5 bg-bg-card border border-border rounded-lg text-xs font-medium text-text-primary hover:bg-bg-secondary transition-colors focus:outline-none focus:ring-2 focus:ring-accent/50"
    onclick={() => (isOpen = !isOpen)}
  >
    <span class="truncate"
      >{selectedOption ? selectedOption.label : placeholder}</span
    >
    <CaretDown
      size={14}
      class="text-text-dim flex-shrink-0 transition-transform duration-200 {isOpen
        ? 'rotate-180'
        : ''}"
    />
  </button>

  {#if isOpen}
    <div
      class="absolute z-50 top-full mt-1.5 right-0 min-w-full w-max max-w-[240px] max-h-60 overflow-y-auto bg-bg-card border border-border rounded-lg shadow-lg p-1.5 custom-scrollbar"
      transition:slide={{ duration: 150 }}
      role="listbox"
      tabindex="-1"
    >
      <div class="flex flex-col gap-0.5">
        {#each options as option (option.id)}
          <button
            type="button"
            role="option"
            aria-selected={value === option.id}
            class="group flex items-center gap-2 w-full px-2.5 py-1.5 text-xs text-left rounded-md transition-colors {value ===
            option.id
              ? 'bg-bg-secondary text-text-primary font-semibold'
              : 'text-text-dim hover:text-text-primary hover:bg-bg-secondary'}"
            onclick={() => handleSelect(option.id)}
          >
            {#if value === option.id}
              <Check
                size={14}
                class="text-text-primary flex-shrink-0"
                weight="bold"
              />
            {:else}
              <div
                class="w-[14px] flex-shrink-0 invisible group-hover:visible opacity-0 group-hover:opacity-30 transition-all"
              >
                <Check size={14} class="text-text-primary" weight="bold" />
              </div>
            {/if}
            <span class="truncate">{option.label}</span>
          </button>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .custom-scrollbar::-webkit-scrollbar {
    width: 4px;
    height: 4px;
  }
  .custom-scrollbar::-webkit-scrollbar-track {
    background: transparent;
  }
  .custom-scrollbar::-webkit-scrollbar-thumb {
    background: var(--color-border);
    border-radius: 4px;
  }
  .custom-scrollbar::-webkit-scrollbar-thumb:hover {
    background: var(--color-border-strong);
  }
</style>
