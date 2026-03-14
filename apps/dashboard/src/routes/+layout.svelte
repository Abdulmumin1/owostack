<script lang="ts">
  import "../app.css";
  import { Toaster } from "svelte-sonner";

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

<Toaster
  position="bottom-right"
  toastOptions={{
    style: `
      --normal-bg: var(--color-bg-card);
      --normal-text: var(--color-text-primary);
      --normal-border: var(--color-border);
      --success-bg: var(--color-success-bg);
      --success-text: var(--color-success);
      --success-border: var(--color-success);
      --error-bg: var(--color-error-bg);
      --error-text: var(--color-error);
      --error-border: var(--color-error);
      --warning-bg: var(--color-warning-bg);
      --warning-text: var(--color-warning);
      --warning-border: var(--color-warning);
      --info-bg: var(--color-info-bg);
      --info-text: var(--color-info);
      --info-border: var(--color-info);
    `,
    class: "owostack-toast",
  }}
/>

<div class="antialiased min-h-screen">
  {@render children()}
</div>

<style>
  :global(.owostack-toast) {
    border-radius: var(--radius-sm) !important;
    box-shadow: 3px 3px 0 0 var(--color-border) !important;
    font-family: var(--font-sans) !important;
    font-size: 13px !important;
    padding: 12px 16px !important;
  }

  :global(.owostack-toast[data-sonner-toast][data-type="success"]) {
    box-shadow: 3px 3px 0 0 var(--color-border) !important;
  }

  :global(.owostack-toast[data-sonner-toast][data-type="error"]) {
    box-shadow: 3px 3px 0 0 var(--color-border) !important;
  }

  :global(.owostack-toast[data-sonner-toast][data-type="warning"]) {
    box-shadow: 3px 3px 0 0 var(--color-border) !important;
  }

  :global(.owostack-toast[data-sonner-toast][data-type="info"]) {
    box-shadow: 3px 3px 0 0 var(--color-border) !important;
  }

  :global(.owostack-toast [data-icon]) {
    margin-right: 10px !important;
  }

  :global(.owostack-toast [data-title]) {
    font-weight: 600 !important;
    font-size: 13px !important;
  }

  :global(.owostack-toast [data-description]) {
    font-size: 12px !important;
    color: var(--color-text-dim) !important;
    margin-top: 2px !important;
  }
</style>
