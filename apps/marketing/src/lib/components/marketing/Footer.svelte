<script lang="ts">
  import Logo from "$lib/components/ui/Logo.svelte";
</script>

<footer class="px-6 py-8 border-t border-border/30">
  <div class="max-w-4xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-4">
    <div class="flex items-center gap-2">
      <Logo size={16} class="text-accent/60" />
      <span class="text-xs text-text-secondary">© {new Date().getFullYear()} Owostack</span>
    </div>
    <div class="flex items-center gap-6 text-xs text-text-secondary">
      <a href="/pricing-templates" class="hover:text-text-primary transition-colors">Templates</a>
      <a href={import.meta.env.DOCS_URL} class="hover:text-text-primary transition-colors">Docs</a>
      <a href={import.meta.env.GITHUB_URL} class="hover:text-text-primary transition-colors">GitHub</a>
      <a href="https://discord.gg/jQ3TyEn6WR" class="hover:text-text-primary transition-colors" target="_blank" rel="noopener noreferrer">Discord</a>
      <a href="/blog" class="hover:text-text-primary transition-colors" target="_blank" rel="noopener noreferrer">Blog</a>
    </div>
  </div>
</footer>
