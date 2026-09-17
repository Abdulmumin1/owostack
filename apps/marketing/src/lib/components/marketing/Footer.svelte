<script lang="ts">
  import { GithubLogo, DiscordLogo, XLogo } from "phosphor-svelte";
  import Logo from "$lib/components/ui/Logo.svelte";

  const columns = [
    {
      title: "Product",
      links: [
        { label: "Dashboard", href: "https://app.owostack.com" },
        { label: "Documentation", href: "https://docs.owostack.com" },
        { label: "Pricing templates", href: "/pricing-templates" },
        { label: "Talk to the founder", href: "/talk-to-founder" },
      ],
    },
    {
      title: "Resources",
      links: [
        { label: "Blog", href: "/blog" },
        { label: "GitHub", href: "https://github.com/abdulmumin1/owostack" },
        { label: "Discord", href: "https://discord.gg/jQ3TyEn6WR" },
        { label: "Changelog", href: "https://github.com/abdulmumin1/owostack/blob/main/CHANGELOG.md" },
      ],
    },
    {
      title: "Providers",
      links: [
        { label: "Paystack", href: "https://docs.owostack.com" },
        { label: "Stripe", href: "https://docs.owostack.com" },
        { label: "Dodo Payments", href: "https://docs.owostack.com" },
        { label: "Bachs", href: "https://docs.owostack.com" },
      ],
    },
  ];
</script>

<footer class="border-t border-border/70 bg-bg-primary px-6 py-14">
  <div class="mx-auto max-w-6xl">
    <div class="grid gap-10 md:grid-cols-12">
      <div class="md:col-span-5">
        <a href="/" class="inline-flex items-center gap-2">
          <Logo size={20} class="text-accent" />
          <span class="font-display text-base font-semibold tracking-tight">Owostack</span>
        </a>
        <p class="mt-3 max-w-xs text-sm leading-relaxed text-text-muted text-pretty">
          Billing infrastructure for AI SaaS. Three API calls, zero webhooks,
          any payment provider.
        </p>
        <div class="mt-5 flex items-center gap-3 text-text-muted">
          <a
            href="https://github.com/abdulmumin1/owostack"
            class="transition-colors hover:text-text-primary"
            aria-label="GitHub"
          >
            <GithubLogo size={18} weight="duotone" />
          </a>
          <a
            href="https://discord.gg/jQ3TyEn6WR"
            class="transition-colors hover:text-text-primary"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Discord"
          >
            <DiscordLogo size={18} weight="duotone" />
          </a>
          <a
            href="https://twitter.com/owostack"
            class="transition-colors hover:text-text-primary"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="X / Twitter"
          >
            <XLogo size={18} weight="duotone" />
          </a>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-8 sm:grid-cols-3 md:col-span-7">
        {#each columns as col (col.title)}
          <div>
            <h4 class="font-mono text-2xs uppercase tracking-[0.08em] text-text-dim">
              {col.title}
            </h4>
            <ul class="mt-4 space-y-2.5">
              {#each col.links as link (link.label)}
                <li>
                  <a
                    href={link.href}
                    class="text-sm text-text-secondary transition-colors hover:text-text-primary"
                  >
                    {link.label}
                  </a>
                </li>
              {/each}
            </ul>
          </div>
        {/each}
      </div>
    </div>

    <div class="mt-12 flex flex-col gap-3 border-t border-border/70 pt-6 sm:flex-row sm:items-center sm:justify-between">
      <span class="text-xs text-text-muted">
        © {new Date().getFullYear()} Owostack. Apache-2.0.
      </span>
      <span class="font-mono text-2xs text-text-dim">Built on Cloudflare Workers.</span>
    </div>
  </div>
</footer>
