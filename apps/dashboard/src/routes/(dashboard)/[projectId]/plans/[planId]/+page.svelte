<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { apiFetch } from "$lib/auth-client";
  import CreateCustomerModal from "$lib/components/customers/CreateCustomerModal.svelte";
  import CreateFeatureModal from "$lib/components/features/CreateFeatureModal.svelte";
  import PlanAttachCustomerPanel from "$lib/components/plans/detail/PlanAttachCustomerPanel.svelte";
  import PlanAttachFeaturePanel from "$lib/components/plans/detail/PlanAttachFeaturePanel.svelte";
  import PlanDetailHeader from "$lib/components/plans/detail/PlanDetailHeader.svelte";
  import PlanDetailSkeleton from "$lib/components/plans/detail/PlanDetailSkeleton.svelte";
  import PlanEditPanel from "$lib/components/plans/detail/PlanEditPanel.svelte";
  import PlanFeatureConfigPanel from "$lib/components/plans/detail/PlanFeatureConfigPanel.svelte";
  import PlanFeaturesSection from "$lib/components/plans/detail/PlanFeaturesSection.svelte";
  import PlanSubscribersSection from "$lib/components/plans/detail/PlanSubscribersSection.svelte";

  const projectId = $derived(page.params.projectId);
  const planId = $derived(page.params.planId);

  let plan = $state<any>(null);
  let features = $state<any[]>([]);
  let creditSystems = $state<any[]>([]);
  let subscribers = $state<any[]>([]);
  let isLoading = $state(true);
  let isSaving = $state(false);
  let isLoadingSubscribers = $state(false);
  let subscribersCount = $state(0);
  let subscribersPage = $state(1);
  const subscribersPageSize = 10;
  let subscribersStatusFilter = $state("active");

  let showAttachFeaturePanel = $state(false);
  let showFeatureConfigPanel = $state(false);
  let showEditPlanPanel = $state(false);
  let showCreateFeatureModal = $state(false);
  let showCreateCustomerModal = $state(false);
  let showAttachCustomerPanel = $state(false);

  let attachCustomerResults = $state<any[]>([]);
  let isSearchingCustomers = $state(false);
  let attachingCustomerId = $state<string | null>(null);
  let editingPlanFeature = $state<any>(null);

  let expandedCreditSystems = $state<string[]>([]);
  let attachSearchTimer: ReturnType<typeof setTimeout> | null = null;

  async function loadData() {
    isLoading = true;
    try {
      const [planRes, featuresRes, creditsRes] = await Promise.all([
        apiFetch(`/api/dashboard/plans/${planId}`),
        apiFetch(`/api/dashboard/features?organizationId=${projectId}`),
        apiFetch(`/api/dashboard/credits?organizationId=${projectId}`),
      ]);

      if (planRes.data) plan = planRes.data.data;
      if (featuresRes.data) features = featuresRes.data.data;
      if (creditsRes.data) creditSystems = creditsRes.data.data || [];

      await loadSubscribers();
    } catch (error) {
      console.error("Failed to load data", error);
    } finally {
      isLoading = false;
    }
  }

  async function loadSubscribers() {
    isLoadingSubscribers = true;
    try {
      const offset = (subscribersPage - 1) * subscribersPageSize;
      let url = `/api/dashboard/subscriptions?organizationId=${projectId}&planId=${planId}&limit=${subscribersPageSize}&offset=${offset}`;
      if (subscribersStatusFilter !== "all") {
        url += `&status=${subscribersStatusFilter}`;
      }
      const res = await apiFetch(url);
      if (res.data?.success) {
        subscribers = res.data.data || [];
        subscribersCount = res.data.total || 0;
      }
    } catch (error) {
      console.error("Failed to load subscribers", error);
    } finally {
      isLoadingSubscribers = false;
    }
  }

  function handleSubscribersPageChange(page: number) {
    subscribersPage = page;
    void loadSubscribers();
  }

  function handleSubscribersFilterChange(status: string) {
    subscribersStatusFilter = status;
    subscribersPage = 1;
    void loadSubscribers();
  }

  async function savePlanEdits(payload: Record<string, unknown>) {
    isSaving = true;
    try {
      const res = await apiFetch(`/api/dashboard/plans/${planId}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });

      if (res.error) {
        throw new Error(res.error.message || "Failed to update plan");
      }

      showEditPlanPanel = false;
      await loadData();
    } catch (error: any) {
      console.error("Failed to update plan", error);
      alert(error.message || "An error occurred while saving changes");
    } finally {
      isSaving = false;
    }
  }

  async function searchCustomersForAttach(query: string) {
    const normalizedQuery = query.trim();

    if (!normalizedQuery || normalizedQuery.length < 2 || !projectId) {
      attachCustomerResults = [];
      isSearchingCustomers = false;
      return;
    }

    isSearchingCustomers = true;
    try {
      const params = new URLSearchParams();
      params.set("organizationId", projectId);
      params.set("limit", "10");
      params.set("search", normalizedQuery);
      const res = await apiFetch(`/api/dashboard/customers?${params}`);
      if (res.data?.success) {
        attachCustomerResults = res.data.data || [];
      }
    } catch (error) {
      console.error("Failed to search customers", error);
    } finally {
      isSearchingCustomers = false;
    }
  }

  function queueAttachCustomerSearch(query: string) {
    if (attachSearchTimer) clearTimeout(attachSearchTimer);

    if (!query.trim() || query.trim().length < 2) {
      attachCustomerResults = [];
      isSearchingCustomers = false;
      return;
    }

    attachSearchTimer = setTimeout(() => {
      void searchCustomersForAttach(query);
    }, 300);
  }

  function closeAttachCustomerPanel() {
    if (attachSearchTimer) clearTimeout(attachSearchTimer);
    attachCustomerResults = [];
    isSearchingCustomers = false;
    showAttachCustomerPanel = false;
  }

  async function attachCustomerToPlan(customerId: string) {
    attachingCustomerId = customerId;
    try {
      const status = plan?.type === "free" ? "active" : "pending";
      const res = await apiFetch(`/api/dashboard/subscriptions`, {
        method: "POST",
        body: JSON.stringify({
          customerId,
          planId,
          status,
        }),
      });

      if (res.data?.success) {
        closeAttachCustomerPanel();
        await loadSubscribers();
      } else if (res.error) {
        if ((res.error as any).status === 409) {
          closeAttachCustomerPanel();
          await loadSubscribers();
        } else {
          alert(res.error.message || "Failed to attach customer to plan");
        }
      }
    } catch (error) {
      console.error("Failed to attach customer", error);
    } finally {
      attachingCustomerId = null;
    }
  }

  async function generateCheckoutLink(subscriptionId: string) {
    try {
      const res = await apiFetch(
        `/api/dashboard/subscriptions/${subscriptionId}/checkout`,
        {
          method: "POST",
          body: JSON.stringify({}),
        },
      );

      if (res.data?.success) {
        if (res.data.activated) {
          await loadSubscribers();
        } else if (res.data.checkoutUrl) {
          await navigator.clipboard.writeText(res.data.checkoutUrl);
          alert(
            `Checkout link copied to clipboard!\n\nSend this to the customer:\n${res.data.checkoutUrl}`,
          );
        }
      } else {
        alert(res.data?.error || "Failed to generate checkout link");
      }
    } catch (error: any) {
      console.error(error);
      alert(error.message || "Failed to generate checkout link");
    }
  }

  async function activateSubscription(subscriptionId: string) {
    try {
      const res = await apiFetch(
        `/api/dashboard/subscriptions/${subscriptionId}/activate`,
        { method: "POST", body: JSON.stringify({}) },
      );
      if (res.data?.success) {
        await loadSubscribers();
      } else {
        alert(res.data?.error || "Failed to activate subscription");
      }
    } catch (error: any) {
      console.error(error);
      alert(error.message || "Failed to activate");
    }
  }

  async function detachFeature(planFeatureId: string) {
    if (!confirm("Are you sure you want to remove this feature from the plan?"))
      return;

    try {
      await apiFetch(`/api/dashboard/plans/features/${planFeatureId}`, {
        method: "DELETE",
      });
      await loadData();
    } catch (error) {
      console.error("Failed to detach feature", error);
    }
  }

  async function attachFeatureToPlan(featureId: string) {
    isSaving = true;
    try {
      await apiFetch(`/api/dashboard/plans/${planId}/features`, {
        method: "POST",
        body: JSON.stringify({ featureId }),
      });
      showAttachFeaturePanel = false;
      await loadData();
    } catch (error) {
      console.error("Failed to attach feature", error);
    } finally {
      isSaving = false;
    }
  }

  function openFeatureConfig(planFeature: any) {
    editingPlanFeature = planFeature;
    showFeatureConfigPanel = true;
  }

  function closeFeatureConfig() {
    showFeatureConfigPanel = false;
    editingPlanFeature = null;
  }

  async function updateFeatureConfig(config: Record<string, unknown>) {
    if (!editingPlanFeature) return;

    isSaving = true;
    try {
      await apiFetch(`/api/dashboard/plans/features/${editingPlanFeature.id}`, {
        method: "PATCH",
        body: JSON.stringify(config),
      });
      closeFeatureConfig();
      await loadData();
    } catch (error) {
      console.error("Failed to update config", error);
    } finally {
      isSaving = false;
    }
  }

  function onFeatureCreated(feature: any) {
    if (feature) {
      features = [...features, feature];
    }
  }

  function toggleCreditSystem(id: string) {
    if (expandedCreditSystems.includes(id)) {
      expandedCreditSystems = expandedCreditSystems.filter(
        (currentId) => currentId !== id,
      );
    } else {
      expandedCreditSystems = [...expandedCreditSystems, id];
    }
  }

  function openSubscriberCustomer(customerId: string) {
    const params = new URLSearchParams();
    params.set("planId", planId ?? "");
    void goto(`/${projectId}/customers/${customerId}?${params.toString()}`);
  }

  $effect(() => {
    if (planId) {
      void loadData();
    }
  });
</script>

<svelte:head>
  <title>{plan ? plan.name : "Plan Details"} - Owostack</title>
</svelte:head>

<div class="max-w-4xl mx-auto space-y-4">
  {#if plan}
    <PlanDetailHeader
      projectId={projectId ?? ""}
      {plan}
      onEdit={() => (showEditPlanPanel = true)}
    />
  {/if}

  {#if isLoading}
    <PlanDetailSkeleton />
  {:else if plan}
    <div class="flex flex-col gap-8">
      <PlanFeaturesSection
        {plan}
        {creditSystems}
        {expandedCreditSystems}
        onToggleCreditSystem={toggleCreditSystem}
        onAddFeature={() => (showAttachFeaturePanel = true)}
        onOpenConfig={openFeatureConfig}
        onDetachFeature={detachFeature}
      />

      <PlanSubscribersSection
        {subscribers}
        isLoading={isLoadingSubscribers}
        totalCount={subscribersCount}
        currentPage={subscribersPage}
        pageSize={subscribersPageSize}
        statusFilter={subscribersStatusFilter}
        onStatusFilterChange={handleSubscribersFilterChange}
        onAttachCustomer={() => (showAttachCustomerPanel = true)}
        onGenerateCheckout={generateCheckoutLink}
        onActivate={activateSubscription}
        onOpenCustomer={openSubscriberCustomer}
        onPageChange={handleSubscribersPageChange}
      />
    </div>
  {/if}
</div>

<PlanAttachFeaturePanel
  open={showAttachFeaturePanel}
  {features}
  planFeatureIds={plan?.planFeatures?.map((planFeature: any) => planFeature.featureId) ??
    []}
  {isSaving}
  onClose={() => (showAttachFeaturePanel = false)}
  onAttachFeature={attachFeatureToPlan}
  onCreateFeature={() => (showCreateFeatureModal = true)}
/>

<PlanFeatureConfigPanel
  open={showFeatureConfigPanel}
  {plan}
  feature={editingPlanFeature}
  {isSaving}
  onClose={closeFeatureConfig}
  onSave={updateFeatureConfig}
/>

<PlanEditPanel
  open={showEditPlanPanel}
  {plan}
  {isSaving}
  onClose={() => (showEditPlanPanel = false)}
  onSave={savePlanEdits}
/>

{#if projectId}
  <CreateFeatureModal
    bind:isOpen={showCreateFeatureModal}
    organizationId={projectId}
    onclose={() => (showCreateFeatureModal = false)}
    onsuccess={onFeatureCreated}
  />
{/if}

<PlanAttachCustomerPanel
  open={showAttachCustomerPanel}
  {plan}
  {subscribers}
  results={attachCustomerResults}
  isSearching={isSearchingCustomers}
  {attachingCustomerId}
  onClose={closeAttachCustomerPanel}
  onSearch={queueAttachCustomerSearch}
  onAttachCustomer={attachCustomerToPlan}
  onCreateCustomer={() => {
    closeAttachCustomerPanel();
    showCreateCustomerModal = true;
  }}
/>

{#if projectId}
  <CreateCustomerModal
    bind:isOpen={showCreateCustomerModal}
    organizationId={projectId}
    onsuccess={(customer) => {
      void attachCustomerToPlan(customer.id);
    }}
  />
{/if}
