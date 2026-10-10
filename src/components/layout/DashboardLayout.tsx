import React, { ReactNode, useEffect, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { ROLE_LABELS, isOrgAdminRole, type AppRole } from "../../../shared/roles";
import StatusBanners from "./StatusBanners";
import { ThemeSwitch } from "./AccountMenu";

export type DashboardKind = "lgu" | "business" | "enterprise" | "super";

interface NavItem {
  to: string;
  label: string;
  end?: boolean;
  /** Only shown to org admins / legacy admin / super admin. */
  adminOnly?: boolean;
  /** Only shown to the original province-wide `admin` role (legacy pages). */
  legacyAdminOnly?: boolean;
}

const NAV: Record<DashboardKind, { title: string; items: NavItem[] }> = {
  lgu: {
    title: "LGU command",
    items: [
      { to: "/admin", label: "Dashboard", end: true },
      { to: "/admin/manage-map", label: "Manage map" },
      { to: "/admin/verification", label: "Report verification" },
      { to: "/admin/incidents", label: "Incidents" },
      { to: "/admin/roads", label: "Road closures" },
      { to: "/admin/evacuation", label: "Evacuation centers" },
      { to: "/admin/water-levels", label: "Water levels" },
      { to: "/admin/advisories", label: "Advisories & alerts" },
      { to: "/admin/sos", label: "SOS requests" },
      { to: "/admin/analytics", label: "Analytics" },
      { to: "/admin/geography", label: "Geographic operations" },
      { to: "/admin/staff", label: "Staff", adminOnly: true },
      { to: "/admin/billing", label: "Subscription", adminOnly: true },
      { to: "/admin/users", label: "Users (legacy directory)", legacyAdminOnly: true },
      { to: "/admin/audit-logs", label: "Audit logs", adminOnly: true },
    ],
  },
  business: {
    title: "Business fleet",
    items: [
      { to: "/business", label: "Overview", end: true },
      { to: "/business/planner", label: "Route planner" },
      { to: "/business/routes", label: "Saved routes" },
      { to: "/business/disruptions", label: "Disruptions" },
      { to: "/business/analytics", label: "Analytics & exports" },
      { to: "/business/staff", label: "Staff", adminOnly: true },
      { to: "/business/billing", label: "Subscription", adminOnly: true },
    ],
  },
  enterprise: {
    title: "Enterprise",
    items: [
      { to: "/enterprise", label: "Overview", end: true },
      { to: "/enterprise/branches", label: "Branches & jurisdictions" },
      { to: "/enterprise/api", label: "API access" },
      { to: "/enterprise/reports", label: "Custom reports" },
      { to: "/business/planner", label: "Route planner" },
      { to: "/enterprise/staff", label: "Staff & permissions", adminOnly: true },
      { to: "/enterprise/billing", label: "Subscription", adminOnly: true },
    ],
  },
  super: {
    title: "Platform admin",
    items: [
      { to: "/super", label: "Overview", end: true },
      { to: "/overview", label: "Island safety overview" },
      { to: "/super/revenue", label: "Revenue" },
      { to: "/super/organizations", label: "Organizations" },
      { to: "/super/users", label: "Users" },
      { to: "/super/subscriptions", label: "Subscriptions & payments" },
      { to: "/super/plans", label: "Plans & pricing" },
      { to: "/super/ai", label: "AI usage & cost" },
      { to: "/super/settings", label: "Features & settings" },
      { to: "/super/audit-logs", label: "Audit logs" },
    ],
  },
};

function visible(item: NavItem, role: AppRole, rawRole: string | null): boolean {
  if (role === "super_admin") return true;
  if (item.legacyAdminOnly) return rawRole === "admin";
  if (item.adminOnly) return isOrgAdminRole(role) || rawRole === "admin";
  return true;
}

export default function DashboardLayout({ kind, children }: { kind: DashboardKind; children: ReactNode }) {
  const { appRole, role, currentUser, logout, assignedArea } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const nav = NAV[kind];

  useEffect(() => setDrawerOpen(false), [location.pathname]);

  return (
    <div className={`admin-shell dash dash--${kind}`}>
      <aside className={`admin-sidebar ${drawerOpen ? "admin-sidebar--open" : ""}`} aria-label={`${nav.title} navigation`}>
        <div className="admin-sidebar__brand">
          <Link to="/" className="admin-sidebar__logo-chip" aria-label="Back to public map">
            <img className="topbar__logo" src="/logo/bahadvisory_icon.png" alt="" />
            <img className="topbar__text-logo" src="/logo/bahadvisory_textlogo.png" alt="Bahadvisory" />
          </Link>
          <div className="dash__section-title">{nav.title}</div>
        </div>
        <nav>
          {nav.items
            .filter((i) => visible(i, appRole, role))
            .map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `admin-nav-link ${isActive ? "admin-nav-link--active" : ""}`}
              >
                {item.label}
              </NavLink>
            ))}
        </nav>
        {appRole === "super_admin" && (
          <div className="dash__switcher">
            <span>Switch view</span>
            {(Object.keys(NAV) as DashboardKind[])
              .filter((k) => k !== kind)
              .map((k) => (
                <Link key={k} to={NAV[k].items[0].to}>
                  {NAV[k].title}
                </Link>
              ))}
          </div>
        )}
        <div className="admin-sidebar__footer">
          <div className="admin-sidebar__user">
            <div>{currentUser?.email}</div>
            <div className="admin-sidebar__role">
              {role === "admin" ? "Admin" : role === "drrm_editor" ? "DRRM Editor" : ROLE_LABELS[appRole]}
              {assignedArea ? ` · ${assignedArea}` : ""}
            </div>
          </div>
          <div className="dash__footer-actions">
            <ThemeSwitch />
            <Link to="/" className="dash__public-link">
              Public map
            </Link>
          </div>
          <button
            className="admin-sidebar__logout"
            onClick={async () => {
              await logout();
              navigate("/login");
            }}
          >
            Sign out
          </button>
        </div>
      </aside>
      {drawerOpen && <div className="dash__scrim" onClick={() => setDrawerOpen(false)} />}
      <div className="dash__content">
        <div className="dash__mobilebar">
          <button type="button" className="icon-btn" onClick={() => setDrawerOpen(true)} aria-label="Open navigation">
            ≡
          </button>
          <strong>{nav.title}</strong>
          <Link to="/" className="dash__public-link">
            Map
          </Link>
        </div>
        <StatusBanners />
        <main className="admin-main">{children}</main>
      </div>
    </div>
  );
}
