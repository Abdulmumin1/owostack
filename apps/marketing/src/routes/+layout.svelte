<script lang="ts">
  import "../app.css";
  
  let { children } = $props();
</script>

<div class="fixed inset-0 z-50 pointer-events-none bg-noise"></div>

{@render children()}
