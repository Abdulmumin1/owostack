<script lang="ts">
  import "../app.css";

  let { children } = $props();
</script>

<svelte:head>
  <title>Owostack</title>
  <!-- Add font for headings -->
  <link
    href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
    rel="stylesheet"
  />
</svelte:head>

<div class="antialiased min-h-screen">
  {@render children()}
</div>
