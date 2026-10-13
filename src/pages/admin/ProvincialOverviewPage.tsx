import React, { useEffect } from "react";
import { collection, limit, query, where } from "firebase/firestore";
import { useSearchParams } from "react-router-dom";
import AdminLayout from "../../components/admin/AdminLayout";
import GeographicFilter from "../../components/geography/GeographicFilter";
import GeographicOverview from "../../components/geography/GeographicOverview";
import { Callout, PageHeader } from "../../components/ui";
import { useAuth } from "../../contexts/AuthContext";
import { useGeographicScope, scopeToSearchParams } from "../../contexts/GeographicScopeContext";
import { db } from "../../firebase";
import { useFirestoreCollection } from "../../hooks/useFirestoreCollection";
import type { JurisdictionGrant } from "../../../shared/geography/jurisdiction";

export default function ProvincialOverviewPage() {
  const { orgId } = useAuth();
  const grants = useFirestoreCollection<JurisdictionGrant>(
    () => orgId ? query(collection(db, "organizations", orgId, "jurisdiction_grants"), where("active", "==", true), limit(100)) : null,
    (_id, data) => data as JurisdictionGrant,
    [orgId],
  );
  const grant = grants.data.find((candidate) => candidate.level === "province") ?? grants.data[0] ?? null;
  const { scope } = useGeographicScope();
  const [search, setSearch] = useSearchParams();

  useEffect(() => {
    if (!grant?.active || scope.provincePsgcCode) return;
    setSearch(scopeToSearchParams({
      provincePsgcCode: grant.provincePsgcCode,
      municipalityPsgcCode: grant.level === "municipality" ? grant.municipalityPsgcCode : null,
      barangayPsgcCode: grant.level === "barangay" ? grant.psgcCode : null,
    }, search), { replace: true });
  }, [grant, scope.provincePsgcCode, search, setSearch]);

  return (
    <AdminLayout>
      <PageHeader title="Geographic operations" subtitle="Comparison and source coverage for your authorized jurisdiction. Access controls remain enforced by PSGC grant on every underlying operation." />
      {grants.error && <Callout tone="danger">Your jurisdiction grant could not be loaded.</Callout>}
      <GeographicFilter />
      <GeographicOverview basePath="/admin/geography" />
    </AdminLayout>
  );
}
