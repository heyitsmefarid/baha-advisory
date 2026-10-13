// Netlify Scheduled Function (free tier) — runs the daily billing jobs:
// expiry, scheduled downgrades, renewal reminders and revenue rollup.
import { runDailyJobs } from "../../server/payments/jobs";

export default async () => {
  const summary = await runDailyJobs();
  console.log("[daily]", JSON.stringify(summary));
  return new Response(JSON.stringify(summary), { headers: { "content-type": "application/json" } });
};

export const config = { schedule: "@daily" };
