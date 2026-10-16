import { doc } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../contexts/AuthContext";
import { useFirestoreDoc } from "./useFirestoreDoc";
import type { Organization } from "../../shared/types";
import type { FeatureKey } from "../../shared/plans";

/**
 * The signed-in user's organization (members can read it). Entitlements on
 * it are written only by the backend after verified payments, so the UI
 * can trust them for display — rules/backend enforce them independently.
 */
export function useMyOrg() {
  const { orgId } = useAuth();
  const res = useFirestoreDoc<Omit<Organization, "id">>(() => (orgId ? doc(db, "organizations", orgId) : null), [orgId]);
  const entitled = (f: FeatureKey) => Boolean(res.data?.entitlements?.[f]);
  return { org: res.data, loading: res.loading, error: res.error, entitled };
}
