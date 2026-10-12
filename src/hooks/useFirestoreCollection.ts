import { useEffect, useState } from "react";
import { Query, onSnapshot } from "firebase/firestore";
import { firestoreErrorMessage } from "../utils/errors";

interface Result<T> {
  data: T[];
  loading: boolean;
  error: string | null;
  /** True while showing data from the offline cache (not confirmed live). */
  fromCache: boolean;
}

/**
 * Generic Firestore listener hook — reused by every feature-specific hook
 * (useFloodZones, useAdvisories, ...) instead of each re-implementing
 * onSnapshot + loading/error state.
 *
 * Performance note: always pass a bounded query (limit / where) from the
 * caller — this hook does not impose limits itself.
 */
export function useFirestoreCollection<T>(
  buildQuery: () => Query | null,
  mapDoc: (id: string, data: unknown) => T,
  deps: unknown[] = []
): Result<T> {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);

  useEffect(() => {
    const q = buildQuery();
    // A null query means "nothing to subscribe to yet" (e.g. signed out).
    if (!q) {
      setData([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    const unsub = onSnapshot(
      q,
      { includeMetadataChanges: true },
      (snap) => {
        setData(snap.docs.map((d) => mapDoc(d.id, d.data())));
        setFromCache(snap.metadata.fromCache);
        setLoading(false);
        setError(null);
      },
      (err) => {
        setError(firestoreErrorMessage(err));
        setLoading(false);
      }
    );
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error, fromCache };
}
