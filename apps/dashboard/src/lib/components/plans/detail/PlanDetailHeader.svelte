<script lang="ts">
  import { CaretLeft, Copy, Lightning, PencilSimple } from "phosphor-svelte";
  import { formatCurrency } from "$lib/utils/currency";

  let {
    projectId,
    plan,
    onEdit = () => {},
  }: {
    projectId: string;
    plan: any;
    onEdit?: () => void;
  } = $props();

  function copySlug() {
    if (plan?.slug) {
      navigator.clipboard.writeText(plan.slug);
    }
  }
</script>

{#if plan}
  <div class="flex items-start justify-between gap-6 pb-4">
    <div class="flex items-center gap-4">
      <a
        href="/{projectId}/plans"
        class="p-2 bg-bg-card border border-border hover:bg-bg-secondary text-text-dim hover:text-text-primary transition-all rounded-lg shrink-0"
        title="Back to Plans"
      >
        <CaretLeft size={20} weight="bold" />
      </a>
      <div class="flex flex-col">
        <div class="flex items-center gap-3">
          <h1 class="text-2xl font-display font-semibold text-text-primary">
            {plan.name}
          </h1>
          <div class="flex items-center gap-2 shrink-0">
            <span class="badge badge-warning uppercase">{plan.type}</span>
            {#if plan.billingType === "one_time"}
              <span class="badge badge-default uppercase">One-off</span>
            {/if}
          </div>
        </div>
        <p class="text-sm text-text-secondary mt-1 max-w-xl">
          {plan.description || "No description provided."}
        </p>
      </div>
    </div>

    <div class="flex items-center gap-6">
      <div class="hidden sm:flex items-center gap-6">
        <div class="flex flex-col text-right">
          <span class="text-xs font-medium text-text-muted">Pricing</span>
          <span class="text-base font-semibold text-text-primary">
            {formatCurrency(plan.price, plan.currency)}
          </span>
        </div>
        <div class="w-px h-10 bg-border"></div>
        <div class="flex flex-col text-right">
          <span class="text-xs font-medium text-text-muted">Billing</span>
          <span class="text-base font-semibold text-text-primary capitalize">
            {plan.interval}
          </span>
        </div>
      </div>

      <button class="btn btn-secondary gap-1.5" onclick={onEdit}>
        <PencilSimple size={16} weight="fill" /> Edit
      </button>
    </div>
  </div>

  <div class="flex flex-wrap items-center gap-x-8 gap-y-3 py-4 text-sm mb-4">
    <div class="flex items-center gap-2">
      <span class="text-text-muted font-medium">Slug:</span>
      <code
        class="text-text-primary font-mono bg-bg-secondary px-2 py-0.5 rounded text-xs border border-border"
      >
        {plan.slug}
      </code>
      <button class="text-text-muted hover:text-text-primary p-1" onclick={copySlug}>
        <Copy size={14} />
      </button>
    </div>

    {#if plan.providerPlanId || plan.paystackPlanId}
      {@const planCode = plan.providerPlanId || plan.paystackPlanId}
      <div class="flex items-center gap-2">
        <span class="text-text-muted font-medium">Provider:</span>
        <span class="text-text-primary font-mono text-sm">{planCode}</span>
      </div>
    {/if}

    <div class="flex items-center gap-2">
      <span class="text-text-muted font-medium">Trial:</span>
      <span class="text-text-primary font-medium">
        {plan.trialDays > 0
          ? `${plan.trialDays} ${(plan.metadata as any)?.trialUnit === "minutes" ? "minutes" : "days"}`
          : "None"}
      </span>
    </div>

    {#if plan.autoEnable}
      <div class="flex items-center gap-1.5 text-accent font-medium">
        <Lightning size={14} weight="fill" /> Auto-enabled
      </div>
    {/if}
  </div>
{/if}
