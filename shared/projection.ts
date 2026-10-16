/**
 * HYPOTHETICAL revenue projection for the business-model simulator.
 * Pure function of the assumptions the user enters — it is never mixed
 * with actual billing records (those live in revenue_records / payments).
 */
export interface ProjectionAssumptions {
  months: number;
  // Acquisition (new paying customers per month) and caps
  lguPerMonth: number;
  lguMax: number;
  businessPerMonth: number;
  enterprisePerQuarter: number;
  // Pricing (PHP / month)
  lguPrice: number;
  businessPrice: number;
  enterprisePrice: number;
  // One-time revenue (PHP per new customer)
  lguInstallFee: number;
  trainingFee: number;
  trainingAttachRate: number; // share of new LGUs buying training (0–1)
  integrationFee: number; // per new enterprise
  // Retention
  monthlyChurnPct: number; // logo churn, % per month
  // Costs (PHP / month unless noted)
  hostingBase: number;
  hostingPerCustomer: number;
  aiCostPerCustomer: number;
  staffCost: number;
  cacPerCustomer: number; // one-time acquisition cost per new customer
  paymentFeePct: number; // provider fees on collected revenue
}

export const DEFAULT_ASSUMPTIONS: ProjectionAssumptions = {
  months: 36,
  lguPerMonth: 1,
  lguMax: 120,
  businessPerMonth: 3,
  enterprisePerQuarter: 0.34,
  lguPrice: 5000,
  businessPrice: 2000,
  enterprisePrice: 15000,
  lguInstallFee: 25000,
  trainingFee: 15000,
  trainingAttachRate: 0.6,
  integrationFee: 50000,
  monthlyChurnPct: 2,
  hostingBase: 0,
  hostingPerCustomer: 60,
  aiCostPerCustomer: 120,
  staffCost: 60000,
  cacPerCustomer: 3000,
  paymentFeePct: 3.5,
};

export interface ProjectionMonth {
  month: number;
  lgus: number;
  businesses: number;
  enterprises: number;
  mrr: number;
  oneTime: number;
  revenue: number;
  costs: number;
  net: number;
  cumulative: number;
}

export interface ProjectionResult {
  rows: ProjectionMonth[];
  breakEvenMonth: number | null;
  /** First month cumulative cash turns non-negative after being negative. */
  paybackMonth: number | null;
  arrAtEnd: number;
  totalRevenue: number;
  totalCosts: number;
}

export function project(a: ProjectionAssumptions): ProjectionResult {
  const churn = Math.max(0, Math.min(100, a.monthlyChurnPct)) / 100;
  let lgus = 0;
  let businesses = 0;
  let enterprises = 0;
  let entAccrual = 0;
  let lguAccrual = 0;
  let bizAccrual = 0;
  let cumulative = 0;
  let breakEvenMonth: number | null = null;
  let paybackMonth: number | null = null;
  let wasNegative = false;
  const rows: ProjectionMonth[] = [];
  let totalRevenue = 0;
  let totalCosts = 0;

  for (let m = 1; m <= Math.max(1, Math.min(120, Math.round(a.months))); m++) {
    // Fractional acquisition accrues so "0.34 per quarter" still lands customers.
    lguAccrual += a.lguPerMonth;
    bizAccrual += a.businessPerMonth;
    entAccrual += a.enterprisePerQuarter / 3;
    const newLgu = Math.min(Math.floor(lguAccrual), Math.max(0, a.lguMax - Math.round(lgus)));
    lguAccrual -= Math.floor(lguAccrual);
    const newBiz = Math.floor(bizAccrual);
    bizAccrual -= newBiz;
    const newEnt = Math.floor(entAccrual);
    entAccrual -= newEnt;

    lgus = lgus * (1 - churn) + newLgu;
    businesses = businesses * (1 - churn) + newBiz;
    enterprises = enterprises * (1 - churn) + newEnt;

    const mrr = lgus * a.lguPrice + businesses * a.businessPrice + enterprises * a.enterprisePrice;
    const oneTime = newLgu * (a.lguInstallFee + a.trainingFee * a.trainingAttachRate) + newEnt * a.integrationFee;
    const revenue = mrr + oneTime;
    const customers = lgus + businesses + enterprises;
    const costs =
      a.hostingBase +
      customers * (a.hostingPerCustomer + a.aiCostPerCustomer) +
      a.staffCost +
      (newLgu + newBiz + newEnt) * a.cacPerCustomer +
      revenue * (a.paymentFeePct / 100);
    const net = revenue - costs;
    cumulative += net;
    totalRevenue += revenue;
    totalCosts += costs;
    if (breakEvenMonth == null && net >= 0 && m > 1) breakEvenMonth = m;
    if (cumulative < 0) wasNegative = true;
    if (paybackMonth == null && wasNegative && cumulative >= 0) paybackMonth = m;
    rows.push({
      month: m,
      lgus: Math.round(lgus * 10) / 10,
      businesses: Math.round(businesses * 10) / 10,
      enterprises: Math.round(enterprises * 10) / 10,
      mrr: Math.round(mrr),
      oneTime: Math.round(oneTime),
      revenue: Math.round(revenue),
      costs: Math.round(costs),
      net: Math.round(net),
      cumulative: Math.round(cumulative),
    });
  }
  const last = rows[rows.length - 1];
  return { rows, breakEvenMonth, paybackMonth, arrAtEnd: last.mrr * 12, totalRevenue: Math.round(totalRevenue), totalCosts: Math.round(totalCosts) };
}
