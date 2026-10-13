import {
  createUserWithEmailAndPassword,
  getIdTokenResult,
  sendPasswordResetEmail,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  User,
} from "firebase/auth";
import { auth } from "../firebase";
import { Role } from "../types";
import type { RoleClaims } from "../../shared/roles";

export function login(email: string, password: string) {
  return signInWithEmailAndPassword(auth, email, password);
}

export function logout() {
  return signOut(auth);
}

/**
 * Citizen self-registration. New accounts carry NO role claim, which every
 * layer (rules, backend, UI) treats as "citizen". Privileged roles can only
 * be granted server-side by an org admin or the Super Admin.
 */
export async function register(name: string, email: string, password: string) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  if (name) await updateProfile(cred.user, { displayName: name });
  return cred;
}

export function resetPassword(email: string) {
  return sendPasswordResetEmail(auth, email);
}

/** Guest session (Firebase Anonymous Auth) for SOS / chat quotas without signup. */
export function continueAsGuest() {
  return signInAnonymously(auth);
}

/**
 * Reads the `role` and `assignedArea` custom claims off the user's ID token.
 *
 * Custom claims can ONLY be set server-side (Admin SDK / Cloud Function),
 * never by the client — that's what makes this trustworthy for Firestore
 * rules and route guards. Do NOT replace this with a client-writable
 * Firestore field like `users/{uid}.role`.
 */
export async function getUserRole(user: User | null): Promise<Role | null> {
  if (!user) return null;
  const token = await getIdTokenResult(user);
  return (token.claims.role as Role) ?? null;
}

export async function getUserArea(user: User | null): Promise<string | null> {
  if (!user) return null;
  const token = await getIdTokenResult(user);
  return (token.claims.assignedArea as string) ?? null;
}

/** All tenancy claims in one read. */
export async function getClaims(user: User | null): Promise<RoleClaims> {
  if (!user) return {};
  const token = await getIdTokenResult(user);
  return {
    role: (token.claims.role as string) ?? null,
    orgId: (token.claims.orgId as string) ?? null,
    assignedArea: (token.claims.assignedArea as string) ?? null,
    areas: Array.isArray(token.claims.areas) ? (token.claims.areas as string[]) : [],
  };
}

/**
 * Force-refreshes the ID token so newly-set custom claims (e.g. right after
 * an admin creates/activates an account) are picked up without a re-login.
 */
export async function refreshClaims(user: User | null) {
  if (!user) return;
  await user.getIdToken(true);
}
