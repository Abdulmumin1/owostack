<script lang="ts">
  // Hero mockup: the Owostack dashboard, customer view.
  import {
    House,
    Users,
    Stack,
    Coins,
    Plug,
    GearSix,
    ArrowRight,
    CaretDown,
    Check,
    Lightning,
    CreditCard,
    Sparkle,
  } from "phosphor-svelte";
  import Logo from "$lib/components/ui/Logo.svelte";

  type Tab = "customers" | "plans" | "usage";
  let tab = $state<Tab>("customers");

  const tabs: { id: Tab; label: string; icon: typeof Users }[] = [
    { id: "customers", label: "Customers", icon: Users },
    { id: "plans", label: "Plans", icon: Stack },
    { id: "usage", label: "Usage", icon: Coins },
  ];

  const nav = [
    { label: "Overview", icon: House },
    { label: "Customers", icon: Users, active: true, count: "1,204" },
    { label: "Plans", icon: Stack },
    { label: "Features", icon: Lightning },
    { label: "Usage", icon: Coins },
    { label: "Providers", icon: Plug },
    { label: "Settings", icon: GearSix },
  ];

  const features = [
    { name: "gpu-inference", used: 620, limit: 1000, unit: "cr", pct: 62 },
    { name: "seats", used: 3, limit: 5, unit: "", pct: 60 },
    { name: "exports", used: 14, limit: 50, unit: "", pct: 28 },
  ];

  const activity = [
    { m: "track", v: "-12 cr", meta: "gpu-inference", t: "2s ago", ok: false },
    { m: "check", v: "allowed", meta: "gpu-inference · 174ms", t: "2s ago", ok: true },
    { m: "addon", v: "+50 cr", meta: "credit pack", t: "3h ago", ok: false },
    { m: "attach", v: "pro", meta: "paystack · $29.00", t: "11d ago", ok: true },
  ];

  const plans = [
    { name: "Free", price: "$0", cr: "100 cr", seats: "1", overage: "off", active: 812 },
    { name: "Pro", price: "$29", cr: "1,000 cr", seats: "5", overage: "$0.02/cr", active: 364, hl: true },
    { name: "Team", price: "$99", cr: "5,000 cr", seats: "20", overage: "$0.015/cr", active: 28 },
  ];

  const usageBars = [34, 41, 38, 52, 48, 61, 57, 70, 66, 74, 81, 78, 90, 86, 100];
</script>

<div class="overflow-hidden rounded-t-xl border border-b-0 border-border bg-bg-card text-text-primary shadow-[0_1px_0_var(--color-border-strong),0_40px_80px_-40px_rgba(28,27,25,0.35)]">
  <!-- tab bar -->
  <div class="flex items-center justify-between gap-4 border-b border-border bg-bg-secondary/70 pr-3">
    <div class="flex" role="tablist">
      {#each tabs as t (t.id)}
        {@const Icon = t.icon}
        <button
          type="button"
          role="tab"
          aria-selected={tab === t.id}
          onclick={() => (tab = t.id)}
          class="relative flex items-center gap-2 border-r border-border px-4 py-3 text-sm transition-colors {tab === t.id
            ? 'bg-bg-card text-text-primary font-medium'
            : 'text-text-muted hover:text-text-primary'}"
        >
          {#if tab === t.id}
            <span class="absolute inset-x-0 top-0 h-0.5 bg-accent"></span>
          {/if}
          <Icon size={16} weight={tab === t.id ? "fill" : "regular"} class={tab === t.id ? "text-accent-hover" : ""} />
          {t.label}
        </button>
      {/each}
    </div>
    <a href="https://docs.owostack.com" class="btn btn-secondary hidden sm:inline-flex">
      Read the docs
      <ArrowRight size={12} weight="bold" />
    </a>
  </div>

  <div class="grid md:grid-cols-[200px_1fr]">
    <!-- sidebar -->
    <aside class="hidden border-r border-border bg-bg-secondary/40 p-3 md:block">
      <div class="mb-4 flex items-center justify-between rounded-md px-2 py-1.5 text-sm">
        <span class="flex items-center gap-2 font-medium">
          <Logo size={16} class="text-accent" />
          acme-ai
        </span>
        <CaretDown size={12} class="text-text-dim" />
      </div>
      <ul class="space-y-0.5">
        {#each nav as item (item.label)}
          {@const Icon = item.icon}
          <li
            class="flex items-center justify-between rounded-md px-2 py-1.5 text-[13px] {item.active
              ? 'bg-bg-card font-medium text-text-primary shadow-[0_1px_0_var(--color-border)]'
              : 'text-text-muted'}"
          >
            <span class="flex items-center gap-2">
              <Icon size={15} weight={item.active ? "fill" : "regular"} class={item.active ? "text-accent-hover" : ""} />
              {item.label}
            </span>
            {#if item.count}
              <span class="badge badge-primary !py-0 !text-[10px]">{item.count}</span>
            {/if}
          </li>
        {/each}
      </ul>
    </aside>

    <!-- main -->
    <div class="min-h-[520px] p-5 md:p-7">
      {#if tab === "customers"}
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div class="font-mono text-2xs uppercase tracking-[0.08em] text-text-dim">Customers</div>
            <div class="mt-1 flex items-center gap-3">
              <h3 class="font-display text-2xl text-text-primary">user_123</h3>
              <span class="badge badge-success">pro · active</span>
            </div>
            <p class="mt-1 text-sm text-text-muted">olamide@acme.ai · joined 11 days ago</p>
          </div>
          <div class="flex flex-wrap gap-2">
            <button class="btn btn-secondary">Grant credits</button>
            <button class="btn btn-primary"><Sparkle size={12} weight="fill" /> Upgrade plan</button>
          </div>
        </div>

        <div class="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border lg:grid-cols-4">
          {#each [
            { l: "Plan", v: "Pro", s: "$29 / month" },
            { l: "Balance", v: "988 cr", s: "of 1,000 + 50 add-on" },
            { l: "Resets in", v: "11 days", s: "monthly cycle" },
            { l: "Provider", v: "Paystack", s: "card ending 4421" },
          ] as stat (stat.l)}
            <div class="bg-bg-card px-4 py-3">
              <div class="text-2xs uppercase tracking-[0.06em] text-text-dim">{stat.l}</div>
              <div class="mt-1 font-display text-lg text-text-primary">{stat.v}</div>
              <div class="text-xs text-text-muted">{stat.s}</div>
            </div>
          {/each}
        </div>

        <div class="mt-6 grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <div class="rounded-lg border border-border">
            <div class="flex items-center justify-between border-b border-border px-4 py-2.5">
              <span class="text-sm font-medium">Features</span>
              <span class="text-xs text-text-dim">this cycle</span>
            </div>
            <ul class="divide-y divide-border/70">
              {#each features as f (f.name)}
                <li class="px-4 py-3">
                  <div class="flex items-center justify-between text-sm">
                    <span class="font-mono text-[13px]">{f.name}</span>
                    <span class="font-mono text-xs text-text-muted">{f.used.toLocaleString()} / {f.limit.toLocaleString()} {f.unit}</span>
                  </div>
                  <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-bg-tertiary">
                    <div class="h-full rounded-full bg-accent" style={`width: ${f.pct}%`}></div>
                  </div>
                </li>
              {/each}
              <li class="flex items-center justify-between px-4 py-3 text-sm">
                <span class="font-mono text-[13px]">priority-queue</span>
                <span class="flex items-center gap-1 text-xs text-secondary-hover"><Check size={12} weight="bold" /> enabled</span>
              </li>
            </ul>
          </div>

          <div class="rounded-lg border border-border">
            <div class="flex items-center justify-between border-b border-border px-4 py-2.5">
              <span class="text-sm font-medium">Activity</span>
              <span class="flex items-center gap-1.5 text-xs text-text-dim">
                <span class="h-1.5 w-1.5 rounded-full bg-secondary"></span> live
              </span>
            </div>
            <ul class="divide-y divide-border/70">
              {#each activity as a (a.m + a.t)}
                <li class="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div class="min-w-0">
                    <div class="font-mono text-[13px]">owo.{a.m}()</div>
                    <div class="truncate text-xs text-text-muted">{a.meta}</div>
                  </div>
                  <div class="text-right">
                    <div class="font-mono text-xs {a.ok ? 'text-secondary-hover' : 'text-text-primary'}">{a.v}</div>
                    <div class="text-2xs text-text-dim">{a.t}</div>
                  </div>
                </li>
              {/each}
            </ul>
          </div>
        </div>
      {:else if tab === "plans"}
        <div class="flex items-start justify-between gap-4">
          <div>
            <div class="font-mono text-2xs uppercase tracking-[0.08em] text-text-dim">Catalog</div>
            <h3 class="mt-1 font-display text-2xl text-text-primary">Plans</h3>
            <p class="mt-1 text-sm text-text-muted">Synced from <span class="font-mono">owo.config.ts</span> · 4 min ago</p>
          </div>
          <button class="btn btn-primary">New plan</button>
        </div>
        <div class="mt-6 overflow-hidden rounded-lg border border-border">
          <table>
            <thead>
              <tr><th>Plan</th><th>Price</th><th>Credits</th><th>Seats</th><th>Overage</th><th class="text-right">Active</th></tr>
            </thead>
            <tbody>
              {#each plans as p (p.name)}
                <tr class={p.hl ? "bg-accent-light/40" : ""}>
                  <td class="font-medium">{p.name}</td>
                  <td class="font-mono text-xs">{p.price}<span class="text-text-dim">/mo</span></td>
                  <td class="font-mono text-xs">{p.cr}</td>
                  <td class="font-mono text-xs">{p.seats}</td>
                  <td class="font-mono text-xs">{p.overage}</td>
                  <td class="text-right font-mono text-xs">{p.active}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <div class="mt-4 rounded-lg border border-dashed border-border px-4 py-3 text-xs text-text-muted">
          Change a plan in your config, run <span class="font-mono text-text-primary">owosk sync</span>, done. Existing customers keep their terms.
        </div>
      {:else}
        <div class="flex items-start justify-between gap-4">
          <div>
            <div class="font-mono text-2xs uppercase tracking-[0.08em] text-text-dim">Metering</div>
            <h3 class="mt-1 font-display text-2xl text-text-primary">gpu-inference</h3>
            <p class="mt-1 text-sm text-text-muted">Credits consumed across all customers · last 15 days</p>
          </div>
          <span class="badge badge-default">daily</span>
        </div>
        <div class="mt-8 flex h-56 items-end gap-2" aria-hidden="true">
          {#each usageBars as h, i (i)}
            <div class="relative flex-1 rounded-t-sm {i === usageBars.length - 1 ? 'bg-accent' : 'bg-bg-tertiary'}" style={`height: ${h}%`}>
              <div class="dither absolute inset-x-0 bottom-0 h-[35%]" style="--dither-color: var(--color-bg-card)"></div>
            </div>
          {/each}
        </div>
        <div class="mt-4 grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-border bg-border">
          {#each [
            { l: "Today", v: "48,210 cr" },
            { l: "Overage billed", v: "$312.40" },
            { l: "Customers at limit", v: "17" },
          ] as s (s.l)}
            <div class="bg-bg-card px-4 py-3">
              <div class="text-2xs uppercase tracking-[0.06em] text-text-dim">{s.l}</div>
              <div class="mt-1 font-display text-lg">{s.v}</div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>
