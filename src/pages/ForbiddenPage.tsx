import React from "react";
import { Link } from "react-router-dom";
import AppShell from "../components/layout/AppShell";
import { EmptyState } from "../components/ui";
import { useAuth } from "../contexts/AuthContext";
import { dashboardPathFor } from "../../shared/roles";

export default function ForbiddenPage({ notFound = false }: { notFound?: boolean }) {
  const { appRole, currentUser } = useAuth();
  return (
    <AppShell>
      <EmptyState
        title={notFound ? "This page doesn't exist" : "This area needs a different role"}
        action={
          <div className="btn-row" style={{ justifyContent: "center" }}>
            <Link className="chip-btn chip-btn--solid" to="/">
              Open the flood map
            </Link>
            {currentUser && (
              <Link className="chip-btn" to={dashboardPathFor(appRole)}>
                Go to my dashboard
              </Link>
            )}
          </div>
        }
      >
        {notFound
          ? "Check the address, or use the navigation above."
          : "Your account doesn't have access to this dashboard. Public flood information, navigation, alerts and evacuation centers are always available to everyone."}
      </EmptyState>
    </AppShell>
  );
}
