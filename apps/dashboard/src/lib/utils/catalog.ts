import { getApiUrlForEnv } from "$lib/env";

export async function copyItemToProd(
  organizationId: string,
  itemType: "plan" | "feature" | "creditSystem" | "creditPack",
  itemId: string,
) {
  // 1. Export from test
  const testApiUrl = getApiUrlForEnv("test");
  const exportRes = await fetch(
    `${testApiUrl}/api/dashboard/catalog/export?organizationId=${organizationId}`,
    { credentials: "include" },
  );
  const exportData = await exportRes.json();
  if (!exportRes.ok || !exportData.success) {
    throw new Error(exportData.error || "Failed to export catalog");
  }

  const fullCatalog = exportData.data;
  const filteredCatalog: any = {
    features: [],
    plans: [],
    creditSystems: [],
    creditPacks: [],
  };

  if (itemType === "feature") {
    const feature = fullCatalog.features?.find((f: any) => f.id === itemId);
    if (!feature) throw new Error("Feature not found in export");
    filteredCatalog.features = [feature];
  } else if (itemType === "plan") {
    const plan = fullCatalog.plans?.find((p: any) => p.id === itemId);
    if (!plan) throw new Error("Plan not found in export");
    filteredCatalog.plans = [plan];

    // 1. Get all direct feature IDs referenced by the plan
    const featureIds = new Set<string>(
      (plan.planFeatures || []).map((pf: any) => pf.featureId),
    );

    // 2. Identify if any of these are actually Credit Systems
    const referencedCreditSystems =
      fullCatalog.creditSystems?.filter((cs: any) => featureIds.has(cs.id)) ||
      [];
    filteredCatalog.creditSystems = referencedCreditSystems;

    // 3. For each referenced Credit System, we also need to include ITS sub-features
    for (const cs of referencedCreditSystems) {
      for (const csf of cs.features || []) {
        featureIds.add(csf.featureId);
      }
    }

    // 4. Finally, grab all features (both direct plan features, credit system roots, and sub-features)
    filteredCatalog.features =
      fullCatalog.features?.filter((f: any) => featureIds.has(f.id)) || [];
  } else if (itemType === "creditSystem") {
    const cs = fullCatalog.creditSystems?.find((c: any) => c.id === itemId);
    if (!cs) throw new Error("Credit System not found in export");
    filteredCatalog.creditSystems = [cs];

    const featureIds = new Set<string>(
      (cs.features || []).map((csf: any) => csf.featureId),
    );
    featureIds.add(cs.id); // Add the credit system's own feature ID!

    filteredCatalog.features =
      fullCatalog.features?.filter((f: any) => featureIds.has(f.id)) || [];
  } else if (itemType === "creditPack") {
    const pack = fullCatalog.creditPacks?.find((c: any) => c.id === itemId);
    if (!pack) throw new Error("Credit Pack not found in export");
    filteredCatalog.creditPacks = [pack];

    if (pack.creditSystemId) {
      const cs = fullCatalog.creditSystems?.find(
        (c: any) => c.id === pack.creditSystemId,
      );
      if (cs) {
        filteredCatalog.creditSystems = [cs];
        const featureIds = new Set<string>(
          (cs.features || []).map((csf: any) => csf.featureId),
        );
        featureIds.add(cs.id); // Add the credit system's own feature ID!
        filteredCatalog.features =
          fullCatalog.features?.filter((f: any) => featureIds.has(f.id)) || [];
      }
    }
  }

  // 2. Import to live
  const liveApiUrl = getApiUrlForEnv("live");
  const importRes = await fetch(`${liveApiUrl}/api/dashboard/catalog/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      organizationId,
      catalog: filteredCatalog,
    }),
  });
  const importData = await importRes.json();
  if (!importRes.ok || !importData.success) {
    throw new Error(importData.error || "Failed to import item to production");
  }

  return importData.data;
}
