import React, { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { Role } from "../types";
import { normalizeRole, type AppRole } from "../../shared/roles";

/** Blocks unauthenticated users. UX-only — Firestore rules are the real gate. */
export function PrivateRoute({ children }: { children: ReactNode }) {
  const { currentUser, isAnonymous } = useAuth();
  const location = useLocation();
  if (!currentUser || isAnonymous) return <Navigate to="/login" state={{ from: location.pathname }} />;
  return <>{children}</>;
}

/**
 * Blocks users without one of the allowed roles. Still UX-only:
 * the matching Firestore rule (see firestore.rules) and backend checks are
 * what actually prevent access, even if someone bypasses this UI.
 *
 * Accepts original role names ("admin", "drrm_editor") as well as the
 * multi-tenant roles; both sides are normalized before comparing. The
 * platform Super Admin may open every dashboard for support purposes.
 */
export function RequireRole({ allow, children }: { allow: (Role | AppRole)[]; children: ReactNode }) {
  const { currentUser, role, isAnonymous } = useAuth();
  const location = useLocation();
  if (!currentUser || isAnonymous) return <Navigate to="/login" state={{ from: location.pathname }} />;
  const mine = normalizeRole(role);
  const allowed = allow.map(normalizeRole);
  if (mine !== "super_admin" && !allowed.includes(mine)) return <Navigate to="/forbidden" />;
  return <>{children}</>;
}

/**
 * The original Users directory lists every user, which Firestore rules only
 * allow for the province-wide legacy `admin` (and the Super Admin). New-style
 * LGU administrators manage their team on the Staff page instead.
 */
export function RequireLegacyAdmin({ children }: { children: ReactNode }) {
  const { currentUser, role, isAnonymous } = useAuth();
  if (!currentUser || isAnonymous) return <Navigate to="/login" />;
  if (role === "admin" || role === "super_admin") return <>{children}</>;
  if (normalizeRole(role) === "lgu_admin") return <Navigate to="/admin/staff" replace />;
  return <Navigate to="/forbidden" />;
}
