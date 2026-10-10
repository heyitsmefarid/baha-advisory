import React from "react";
import AppShell from "../components/layout/AppShell";
import GeographicFilter from "../components/geography/GeographicFilter";
import GeographicOverview from "../components/geography/GeographicOverview";
import { PageHeader } from "../components/ui";

export default function IslandOverviewPage() {
  return (
    <AppShell>
      <PageHeader title="Mindoro safety overview" subtitle="Compare public safety information across all 26 city and municipal LGUs. Public access is free; unavailable feeds are never shown as zero." />
      <GeographicFilter />
      <GeographicOverview basePath="/overview" />
    </AppShell>
  );
}
