import { collection, orderBy, query } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../contexts/AuthContext";
import { useFirestoreCollection } from "./useFirestoreCollection";
import type { EmergencyContact, SavedLocation, UserNotification } from "../../shared/types";

/** Personal data lives under users/{uid}/… and is private to the owner. */
export function useSavedLocations() {
  const { currentUser, isAnonymous } = useAuth();
  const uid = currentUser && !isAnonymous ? currentUser.uid : null;
  return useFirestoreCollection<SavedLocation>(
    () => (uid ? query(collection(db, "users", uid, "saved_locations")) : null),
    (id, data) => ({ id, ...(data as Omit<SavedLocation, "id">) }),
    [uid]
  );
}

export function useEmergencyContacts() {
  const { currentUser, isAnonymous } = useAuth();
  const uid = currentUser && !isAnonymous ? currentUser.uid : null;
  return useFirestoreCollection<EmergencyContact>(
    () => (uid ? query(collection(db, "users", uid, "emergency_contacts")) : null),
    (id, data) => ({ id, ...(data as Omit<EmergencyContact, "id">) }),
    [uid]
  );
}

export function useNotifications() {
  const { currentUser } = useAuth();
  const uid = currentUser?.uid ?? null;
  return useFirestoreCollection<UserNotification>(
    () => (uid ? query(collection(db, "users", uid, "notifications"), orderBy("createdAt", "desc")) : null),
    (id, data) => ({ id, ...(data as Omit<UserNotification, "id">) }),
    [uid]
  );
}
