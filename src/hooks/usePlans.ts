import { collection, query } from "firebase/firestore";
import { db } from "../firebase";
import { useFirestoreCollection } from "./useFirestoreCollection";
import { DEFAULT_PLANS, type SubscriptionPlan } from "../../shared/plans";

/** Live subscription plans (Super Admin edits apply immediately). */
export function usePlans() {
  const res = useFirestoreCollection<SubscriptionPlan>(
    () => query(collection(db, "subscription_plans")),
    (id, d) => ({ ...(d as SubscriptionPlan), id }),
    []
  );
  const plans = (res.data.length ? res.data : DEFAULT_PLANS).filter((p) => p.active).sort((a, b) => a.sortOrder - b.sortOrder);
  return { plans, loading: res.loading, fromDefaults: !res.loading && res.data.length === 0 };
}
