<script lang="ts">
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import { useSession, organization, apiFetch } from "$lib/auth-client";
  import Logo from "$lib/components/ui/Logo.svelte";
  import { Check, X, CircleNotch, Terminal, ShieldWarning } from "phosphor-svelte";

  const session = useSession();

  let code = $derived(page.url.searchParams.get("code") || "");
  let organizations = $state<any[]>([]);
  let selectedOrgId = $state<string>("");
  let loading = $state(true);
  let approving = $state(false);
  let denying = $state(false);
  let error = $state<string | null>(null);
  let success = $state(false);
  let denied = $state(false);

  $effect(() => {
    if ($session.data && !$session.isLoading) {
      loadOrganizations();
    }
  });

  async function loadOrganizations() {
    try {
      const { data } = await organization.list();
      if (data && data.length > 0) {
        organizations = data;
        selectedOrgId = data[0].id;
      }
    } catch (e) {
      console.error("Failed to load organizations", e);
    } finally {
      loading = false;
    }
  }

  async function handleApprove() {
    if (!selectedOrgId || !code) return;

    approving = true;
    error = null;

    try {
      const res = await apiFetch("/api/auth/cli/approve", {
        method: "POST",
        body: JSON.stringify({
          userCode: code,
          organizationId: selectedOrgId,
        }),
      });

      if (res.error) {
        throw new Error(res.error.message);
      }

      success = true;
    } catch (e: any) {
      error = e.message || "Failed to approve connection";
    } finally {
      approving = false;
    }
  }

  async function handleDeny() {
    if (!code) return;

    denying = true;
    error = null;

    try {
      const res = await apiFetch("/api/auth/cli/deny", {
        method: "POST",
        body: JSON.stringify({
          userCode: code,
        }),
      });

      if (res.error) {
        throw new Error(res.error.message);
      }

      denied = true;
    } catch (e: any) {
      error = e.message || "Failed to deny connection";
    } finally {
      denying = false;
    }
  }

  function formatCode(code: string): string {
    return code.length === 9 && code.includes("-") ? code : `${code.slice(0, 4)}-${code.slice(4)}`;
  }
</script>

<svelte:head>
  <title>CLI Connect - Owostack</title>
</svelte:head>

<div class="min-h-screen flex items-center justify-center bg-bg-primary p-6">
  <div class="w-full max-w-md">
    <div class="card bg-bg-card overflow-hidden">
      <div class="p-6 border-b border-border bg-bg-secondary flex items-center gap-3">
        <Logo size={24} class="text-accent" weight="duotone" />
        <div>
          <h1 class="text-lg font-bold text-text-primary uppercase tracking-tight">CLI Connect</h1>
          <p class="text-xs text-text-dim">Authorize terminal access</p>
        </div>
      </div>

      <div class="p-6">
        {#if $session.isLoading || loading}
          <div class="flex items-center justify-center py-8">
            <CircleNotch size={24} class="animate-spin text-accent" weight="duotone" />
          </div>
        {:else if !$session.data}
          <div class="text-center py-8">
            <ShieldWarning size={32} class="text-warning mx-auto mb-4" weight="duotone" />
            <p class="text-sm text-text-secondary mb-4">Sign in to authorize CLI access</p>
            <button class="btn btn-primary" onclick={() => goto("/login?redirect=/cli/connect?code=" + code)}>
              Sign In
            </button>
          </div>
        {:else if success}
          <div class="text-center py-8">
            <div class="w-16 h-16 bg-success-bg border border-success rounded-full flex items-center justify-center mx-auto mb-4">
              <Check size={32} class="text-success" weight="duotone" />
            </div>
            <h2 class="text-lg font-bold text-text-primary mb-2">Connected!</h2>
            <p class="text-sm text-text-secondary">Return to your terminal to continue.</p>
          </div>
        {:else if denied}
          <div class="text-center py-8">
            <div class="w-16 h-16 bg-error-bg border border-error rounded-full flex items-center justify-center mx-auto mb-4">
              <X size={32} class="text-error" weight="duotone" />
            </div>
            <h2 class="text-lg font-bold text-text-primary mb-2">Denied</h2>
            <p class="text-sm text-text-secondary">Connection request rejected.</p>
          </div>
        {:else}
          <div class="mb-6">
            <div class="text-[10px] font-bold text-text-dim uppercase tracking-widest mb-2">
              Verification Code
            </div>
            <div class="font-mono text-3xl font-bold text-accent tracking-wider text-center py-4 bg-bg-secondary border border-border">
              {formatCode(code)}
            </div>
            <p class="text-xs text-text-dim mt-2 text-center">
              Make sure this matches the code in your terminal
            </p>
          </div>

          {#if organizations.length > 0}
            <div class="mb-6">
              <div class="text-[10px] font-bold text-text-dim uppercase tracking-widest mb-2">
                Connect to Organization
              </div>
              <div class="space-y-2">
                {#each organizations as org (org.id)}
                  <label
                    class="flex items-center gap-3 p-3 border cursor-pointer transition-colors {selectedOrgId === org.id
                      ? 'border-accent bg-accent-light'
                      : 'border-border hover:border-text-dim bg-bg-secondary'}"
                  >
                    <input
                      type="radio"
                      name="organization"
                      value={org.id}
                      bind:group={selectedOrgId}
                      class="sr-only"
                    />
                    <div
                      class="w-4 h-4 border-2 rounded-full flex items-center justify-center {selectedOrgId === org.id
                        ? 'border-accent'
                        : 'border-border'}"
                    >
                      {#if selectedOrgId === org.id}
                        <div class="w-2 h-2 bg-accent rounded-full"></div>
                      {/if}
                    </div>
                    <span class="text-sm text-text-primary">{org.name}</span>
                  </label>
                {/each}
              </div>
            </div>
          {/if}

          {#if error}
            <div class="mb-4 p-3 bg-error-bg border border-error text-error text-xs">
              {error}
            </div>
          {/if}

          <div class="flex gap-3">
            <button
              class="btn btn-secondary flex-1"
              onclick={handleDeny}
              disabled={denying}
            >
              {#if denying}
                <CircleNotch size={16} class="animate-spin" weight="duotone" />
              {:else}
                <X size={16} weight="duotone" />
              {/if}
              Deny
            </button>
            <button
              class="btn btn-primary flex-1"
              onclick={handleApprove}
              disabled={approving || !selectedOrgId}
            >
              {#if approving}
                <CircleNotch size={16} class="animate-spin" weight="duotone" />
              {:else}
                <Check size={16} weight="duotone" />
              {/if}
              Approve
            </button>
          </div>

          <div class="mt-6 p-3 bg-warning-bg border border-warning/30 text-xs text-text-secondary">
            <div class="flex items-start gap-2">
              <ShieldWarning size={14} class="text-warning shrink-0 mt-0.5" weight="duotone" />
              <span>
                Approving grants full API access to this organization. Only approve connections you initiated.
              </span>
            </div>
          </div>
        {/if}
      </div>
    </div>

    <div class="mt-4 flex items-center justify-center gap-2 text-xs text-text-dim">
      <Terminal size={14} weight="duotone" />
      <span>owostack CLI authentication</span>
    </div>
  </div>
</div>