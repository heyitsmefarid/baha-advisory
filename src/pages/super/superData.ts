import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";

export interface Metrics {
  generatedAt: number;
  windowDays: number;
  users: { total: number; byRole: Record<string, number> };
  organizations: { total: number; byType: Record<string, number>; paying: number; pendingApplications: number };
  revenue: {
    real: MrrBlock;
    demo: MrrBlock;
    monthly: { month: string; realPhp: number; demoPhp: number }[];
  };
  payments: { paid: number; failed: number; pending: number };
  ai: {
    calls: number;
    byProvider: Record<string, { calls: number; tokens: number; costUsd: number; errors: number; cached: number }>;
    byTask: Record<string, number>;
    byDay: { day: string; groq: number; gemini: number; errors: number; costUsd: number }[];
    estCostUsd: number;
    note: string;
  };
}

interface MrrBlock {
  mrrPhp: number;
  arrPhp: number;
  activeSubscriptions: number;
  byPlan: Record<string, { count: number; mrrPhp: number }>;
  churn: { rate: number; churned: number; base: number };
  collected12m: number;
}

export function useMetrics(days = 30) {
  const [data, setData] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => {
    setLoading(true);
    api<Metrics>(`/admin/metrics?days=${days}`)
      .then((m) => {
        setData(m);
        setError(null);
      })
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [days]);
  useEffect(load, [load]);
  return { data, error, loading, reload: load };
}
