<script lang="ts">
  import type { HTMLAttributes } from "svelte/elements";
  
  interface Props extends HTMLAttributes<HTMLDivElement> {
    class?: string;
  }

  let { class: className = "", ...rest }: Props = $props();
</script>

<div
  class="animate-pulse bg-black/5 dark:bg-white/5 {className}"
  {...rest}
></div>
