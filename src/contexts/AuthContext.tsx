import React, { createContext, useCallback, useContext, useEffect, useState, ReactNode } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "../firebase";
import {
  continueAsGuest,
  getClaims,
  login,
  logout,
  refreshClaims,
  register,
  resetPassword,
} from "../services/authService";
import { Role } from "../types";
import { normalizeRole, type AppRole } from "../../shared/roles";
import { api } from "../lib/api";

interface AuthContextValue {
  currentUser: User | null;
  /** Raw claim value — kept for existing code that checks "admin"/"drrm_editor". */
  role: Role | null;
  /** Normalized role (no claim ⇒ "citizen"; legacy roles mapped). */
  appRole: AppRole;
  isAnonymous: boolean;
  orgId: string | null;
  assignedArea: string | null;
  areas: string[];
  login: typeof login;
  logout: typeof logout;
  register: typeof register;
  resetPassword: typeof resetPassword;
  continueAsGuest: typeof continueAsGuest;
  /** Re-reads custom claims (after joining/creating an organization). */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [assignedArea, setAssignedArea] = useState<string | null>(null);
  const [areas, setAreas] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const applyClaims = useCallback(async (user: User | null) => {
    // Role/area come from server-set custom claims — never trust a
    // client-supplied value here.
    const claims = await getClaims(user);
    setRole((claims.role as Role) ?? null);
    setOrgId(claims.orgId ?? null);
    setAssignedArea(claims.assignedArea ?? null);
    setAreas(claims.areas ?? []);
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      try {
        // Force a fresh ID token on every auth state change. Custom claims
        // (role/assignedArea) are set server-side and can otherwise be
        // picked up from a stale cached token, which is what causes
        // "permission-denied" on Firestore writes right after an account
        // is created or its role changes.
        await refreshClaims(user);
        await applyClaims(user);
      } catch {
        // Offline: fall back to whatever the cached token says.
        await applyClaims(user).catch(() => undefined);
      }
      setLoading(false);
      if (user && !user.isAnonymous) {
        // Ensure users/{uid} exists (role mirrored from claims server-side).
        api("/auth/bootstrap", { method: "POST" }).catch(() => undefined);
      }
    });
    return unsubscribe;
  }, [applyClaims]);

  const refresh = useCallback(async () => {
    if (!auth.currentUser) return;
    await refreshClaims(auth.currentUser);
    await applyClaims(auth.currentUser);
  }, [applyClaims]);

  const value: AuthContextValue = {
    currentUser,
    role,
    appRole: normalizeRole(role),
    isAnonymous: Boolean(currentUser?.isAnonymous),
    orgId,
    assignedArea,
    areas,
    login,
    logout,
    register,
    resetPassword,
    continueAsGuest,
    refresh,
  };

  return <AuthContext.Provider value={value}>{!loading && children}</AuthContext.Provider>;
}
