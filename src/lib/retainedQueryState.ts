export type RetainedDisplayState = "loading" | "confirmed" | "stale_previous_scope" | "empty";

export interface RetainedQueryState<T> {
  rows: T[];
  loading: boolean;
  error: string | null;
  requestedScopeKey: string;
  confirmedScopeKey: string | null;
  displayState: RetainedDisplayState;
  fromCache: boolean;
}

export type RetainedQueryEvent<T> =
  | { type: "query_started"; scopeKey: string }
  | { type: "query_succeeded"; scopeKey: string; rows: T[]; fromCache: boolean }
  | { type: "query_failed"; scopeKey: string; error: string };

export function transitionRetainedQueryState<T>(
  state: RetainedQueryState<T> | undefined,
  event: RetainedQueryEvent<T>,
): RetainedQueryState<T> {
  const current: RetainedQueryState<T> = state ?? {
    rows: [],
    loading: false,
    error: null,
    requestedScopeKey: event.scopeKey,
    confirmedScopeKey: null,
    displayState: "empty",
    fromCache: false,
  };
  if (event.type === "query_started") {
    return {
      ...current,
      loading: true,
      error: null,
      requestedScopeKey: event.scopeKey,
      displayState: current.confirmedScopeKey ? "stale_previous_scope" : "loading",
    };
  }
  if (event.type === "query_failed") {
    return {
      ...current,
      loading: false,
      error: event.error,
      requestedScopeKey: event.scopeKey,
      displayState: current.confirmedScopeKey ? "stale_previous_scope" : "empty",
    };
  }
  return {
    rows: event.rows,
    loading: false,
    error: null,
    requestedScopeKey: event.scopeKey,
    confirmedScopeKey: event.scopeKey,
    displayState: event.rows.length ? "confirmed" : "empty",
    fromCache: event.fromCache,
  };
}
