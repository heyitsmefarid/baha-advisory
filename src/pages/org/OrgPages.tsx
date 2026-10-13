import React from "react";
import DashboardLayout, { type DashboardKind } from "../../components/layout/DashboardLayout";
import BillingPanel from "../../components/billing/BillingPanel";
import StaffManager from "../../components/org/StaffManager";
import { PageHeader } from "../../components/ui";

const BASE: Record<Exclude<DashboardKind, "super">, string> = { lgu: "/admin", business: "/business", enterprise: "/enterprise" };

export function BillingPage({ kind }: { kind: Exclude<DashboardKind, "super"> }) {
  return (
    <DashboardLayout kind={kind}>
      <PageHeader title="Subscription & billing" subtitle="Manage your plan, payments and receipts. Public-safety features never depend on a subscription." />
      <p className="small muted">Service-area selection applies only to paid organizational tools. Citizens continue to receive public safety information across all of Mindoro at no charge.</p>
      <BillingPanel />
    </DashboardLayout>
  );
}

export function StaffPage({ kind }: { kind: Exclude<DashboardKind, "super"> }) {
  return (
    <DashboardLayout kind={kind}>
      <PageHeader
        title={kind === "enterprise" ? "Staff & permissions" : "Staff"}
        subtitle={kind === "lgu" ? "Invite DRRM staff and assign them to municipalities in your jurisdiction. Roles are enforced by the server and database rules." : "Invite your team and control who can administer the organization."}
      />
      <StaffManager billingPath={`${BASE[kind]}/billing`} />
    </DashboardLayout>
  );
}
