import React from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { isOrgAdminRole } from "../../../shared/roles";
import { PAID_FEATURE_LABELS, type PaidFeature } from "../../../shared/plans";

/** Shown in place of a paid feature the organization isn't subscribed to. */
export default function UpgradeNotice({ feature, plan, billingPath }: { feature: PaidFeature; plan: string; billingPath: string }) {
  const { appRole, orgId } = useAuth();
  return (
    <div className="upgrade-notice">
      <strong>{PAID_FEATURE_LABELS[feature]} is part of {plan}.</strong>
      <p className="small">
        Public-safety tools — flood map, alerts, report verification, road closures, evacuation centers and navigation — stay free and keep working.
      </p>
      {!orgId ? (
        <p className="small">Your account isn't linked to an organization yet.</p>
      ) : isOrgAdminRole(appRole) || appRole === "super_admin" ? (
        <Link className="chip-btn chip-btn--solid" to={billingPath}>
          View plans & subscribe
        </Link>
      ) : (
        <p className="small">Ask your organization administrator to subscribe.</p>
      )}
    </div>
  );
}
