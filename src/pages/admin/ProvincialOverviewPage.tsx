import React, { useEffect } from "react";
import { doc } from "firebase/firestore";
import { useSearchParams } from "react-router-dom";
import AdminLayout from "../../components/admin/AdminLayout";
import GeographicFilter from "../../components/geography/GeographicFilter";
import GeographicOverview from "../../components/geography/GeographicOverview";
import { Callout, PageHeader } from "../../components/ui";
import { useAuth } from "../../contexts/AuthContext";
import { useGeographicScope, scopeToSearchParams } from "../../contexts/GeographicScopeContext";
import { db } from "../../firebase";
import { useFirestoreDoc } from "../../hooks/useFirestoreDoc";
import type { JurisdictionGrant } from "../../../shared/geography/jurisdiction";

export default function ProvincialOverviewPage() {
  const { orgId } = useAuth();
  const grant = useFirestoreDoc<JurisdictionGrant>(() => orgId ? doc(db, "jurisdiction_grants", orgId) : null, [orgId]);
  const { scope } = useGeographicScope();
  const [search, setSearch] = useSearchParams();

  useEffect(() => {
    if (!grant.data?.active || scope.provincePsgcCode) return;
    setSearch(scopeToSearchParams({
      provincePsgcCode: grant.data.provincePsgcCode,
      municipalityPsgcCode: grant.data.level === "municipality" ? grant.data.municipalityPsgcCode : null,
      barangayPsgcCode: grant.data.level === "barangay" ? grant.data.psgcCode : null,
    }, search), { replace: true });
  }, [grant.data, scope.provincePsgcCode, search, setSearch]);

  return (
    <AdminLayout>
      <PageHeader title="Geographic operations" subtitle="Comparison and source coverage for your authorized jurisdiction. Access controls remain enforced by PSGC grant on every underlying operation." />
      {grant.error && <Callout tone="danger">Your jurisdiction grant could not be loaded.</Callout>}
      <GeographicFilter />
      <GeographicOverview basePath="/admin/geography" />
    </AdminLayout>
  );
}
