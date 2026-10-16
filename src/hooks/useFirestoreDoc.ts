import { useEffect, useState } from "react";
import { DocumentReference, onSnapshot } from "firebase/firestore";
import { firestoreErrorMessage } from "../utils/errors";

/** Real-time single-document listener (companion to useFirestoreCollection). */
export function useFirestoreDoc<T>(
  buildRef: () => DocumentReference | null,
  deps: unknown[] = []
): { data: (T & { id: string }) | null; loading: boolean; error: string | null; fromCache: boolean } {
  const [data, setData] = useState<(T & { id: string }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);

  useEffect(() => {
    const ref = buildRef();
    if (!ref) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    return onSnapshot(
      ref,
      { includeMetadataChanges: true },
      (snap) => {
        setData(snap.exists() ? ({ id: snap.id, ...(snap.data() as T) }) : null);
        setFromCache(snap.metadata.fromCache);
        setLoading(false);
        setError(null);
      },
      (err) => {
        setError(firestoreErrorMessage(err));
        setLoading(false);
      }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error, fromCache };
}
