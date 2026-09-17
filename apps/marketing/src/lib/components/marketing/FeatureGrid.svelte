<script lang="ts">
  import {
    CreditCard,
    Coins,
    ArrowsClockwise,
    Package,
    Lock,
    Users,
    Lightning,
    Plug,
  } from "phosphor-svelte";

  const features = [
    {
      icon: CreditCard,
      title: "Subscriptions",
      body: "Monthly, yearly, trials, upgrades. One call.",
    },
    {
      icon: Coins,
      title: "Usage metering",
      body: "Tokens, requests, minutes. Atomic counts.",
    },
    {
      icon: ArrowsClockwise,
      title: "Flexible resets",
      body: "Every 5 minutes, hourly, daily, monthly, custom.",
    },
    {
      icon: Package,
      title: "Credits & add-ons",
      body: "One balance across features. Sell top-up packs.",
    },
    {
      icon: Lock,
      title: "Feature gating",
      body: "Per-plan on/off. check() answers in ~175 ms.",
    },
    {
      icon: Users,
      title: "Team seats",
      body: "Seats, projects, workspaces. Count, cap, charge.",
    },
    {
      icon: Lightning,
      title: "Overage",
      body: "Keep going past the limit and bill it, or hard-stop.",
    },
    {
      icon: Plug,
      title: "Bring your provider",
      body: "Paystack, Stripe, Dodo, Bachs. Swap without code changes.",
    },
  ];
</script>

<section class="relative bg-bg-primary py-24 md:py-32">
  <div class="mx-auto max-w-6xl px-6">
    <div>
      <div class="max-w-2xl">
        <p class="eyebrow mb-6">What you get</p>
        <h2 class="font-display text-display-lg text-balance text-text-primary">
          The whole billing layer.<br />
          <span class="text-text-muted">Not just the checkout.</span>
        </h2>
      </div>
    </div>

    <ul class="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {#each features as feature (feature.title)}
        {@const Icon = feature.icon}
        <li class="grid-cell group flex flex-col gap-4 transition-colors hover:bg-bg-card-hover">
          <span
            class="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-bg-secondary text-text-secondary transition-colors group-hover:border-accent/40 group-hover:text-accent"
          >
            <Icon size={18} weight="duotone" />
          </span>
          <div>
            <h3 class="font-display text-title text-text-primary">{feature.title}</h3>
            <p class="mt-1.5 text-sm leading-relaxed text-text-muted text-pretty">
              {feature.body}
            </p>
          </div>
        </li>
      {/each}
    </ul>
  </div>
</section>
