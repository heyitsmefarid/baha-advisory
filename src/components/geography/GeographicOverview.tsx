import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import { BarList } from "../charts/Charts";
import { Badge, Callout, SkeletonRows, formatDateTime } from "../ui";
import { useGeographicOverview } from "../../hooks/useScopedPublicData";
import { buildOverviewRows, type CoverageStatus } from "../../../shared/geography/overview";

const STATUS: Record<CoverageStatus, { label: string; tone: "neutral" | "caution" | "sim" | "safe" | "danger" }> = {
  source_unavailable: { label: "Source unavailable", tone: "danger" },
  stale: { label: "Stale", tone: "caution" },
  simulated: { label: "Includes simulated", tone: "sim" },
  verified: { label: "Verified feed", tone: "safe" },
  no_verified_feed: { label: "No verified feed", tone: "neutral" },
};

const display = (value: number | null) => value == null ? "—" : value.toLocaleString("en-PH");

export default function GeographicOverview({ basePath }: { basePath: string }) {
  const { data, loading, error } = useGeographicOverview();
  const rows = useMemo(
    () => buildOverviewRows({ municipalities: data?.municipalities ?? [], generatedAt: data?.generatedAt }),
    [data],
  );
  const provinceSummaries = useMemo(() => {
    const grouped = new Map<string, { name: string; municipalities: number; verified: number; simulated: number; noFeed: number }>();
    for (const row of rows) {
      const current = grouped.get(row.provincePsgcCode ?? "unknown") ?? {
        name: row.provinceName, municipalities: 0, verified: 0, simulated: 0, noFeed: 0,
      };
      current.municipalities += 1;
      current.verified += row.verifiedActiveFloodZones;
      current.simulated += row.simulatedActiveFloodZones;
      if (row.coverageStatus === "no_verified_feed" || row.coverageStatus === "source_unavailable") current.noFeed += 1;
      grouped.set(row.provincePsgcCode ?? "unknown", current);
    }
    return [...grouped.entries()];
  }, [rows]);

  if (loading && !data) return <SkeletonRows />;
  if (!data) return <Callout tone="danger">{error ?? "The geographic overview is unavailable."} Existing safety records have not been replaced with zeroes.</Callout>;

  return (
    <div className="geo-overview">
      {error && <Callout tone="caution">The latest refresh failed. Showing the last confirmed overview.</Callout>}
      <div className="geo-overview__provinces" aria-label="Province summaries">
        {provinceSummaries.map(([code, province]) => (
          <article className="geo-overview__province panel" key={code}>
            <div>
              <p className="eyebrow">Province</p>
              <h2>{province.name}</h2>
            </div>
            <dl>
              <div><dt>LGUs</dt><dd>{province.municipalities}</dd></div>
              <div><dt>Verified flood zones</dt><dd>{province.verified}</dd></div>
              <div><dt>Simulated flood zones</dt><dd>{province.simulated}</dd></div>
              <div><dt>Without verified feed</dt><dd>{province.noFeed}</dd></div>
            </dl>
            {code !== "unknown" && <Link to={`${basePath}?province=${code}`}>View province</Link>}
          </article>
        ))}
      </div>

      <section className="panel geo-overview__chart" aria-labelledby="municipality-comparison-title">
        <div className="panel__head">
          <div>
            <p className="eyebrow">Verified records only</p>
            <h2 className="panel__title" id="municipality-comparison-title">Active flood zones by LGU</h2>
          </div>
          <Badge tone="neutral">Simulated records excluded from bars</Badge>
        </div>
        <BarList
          title="Verified active flood zones by municipality or city"
          data={rows.map((row) => ({ label: row.name, value: row.verifiedActiveFloodZones, note: STATUS[row.coverageStatus].label }))}
        />
      </section>

      <section className="panel" aria-labelledby="municipality-table-title">
        <div className="panel__head">
          <div>
            <p className="eyebrow">Complete comparison</p>
            <h2 className="panel__title" id="municipality-table-title">Municipalities and city</h2>
          </div>
          <p className="tiny">Generated {formatDateTime(data.generatedAt)} · newest source {data.sourceMaxUpdatedAt ? formatDateTime(data.sourceMaxUpdatedAt) : "unavailable"}</p>
        </div>
        <div className="geo-overview__table-wrap">
          <table className="geo-overview__table">
            <caption className="sr-only">Mindoro municipality public-safety comparison</caption>
            <thead><tr><th>LGU</th><th>Coverage</th><th>Flood zones</th><th>Road conditions</th><th>Verified reports</th><th>Evacuation centers</th><th>Alerts</th><th>Freshest record</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.psgcCode}>
                  <th scope="row"><Link to={`${basePath}?province=${row.provincePsgcCode}&municipality=${row.psgcCode}`}>{row.name}</Link><span>{row.provinceName}</span></th>
                  <td><Badge tone={STATUS[row.coverageStatus].tone}>{STATUS[row.coverageStatus].label}</Badge></td>
                  <td>{row.activeFloodZonesDisplay}</td>
                  <td>{display(row.roadConditions)}</td>
                  <td>{display(row.verifiedReports)}</td>
                  <td>{display(row.evacuationCenters)}</td>
                  <td>{display(row.activeAlerts)}</td>
                  <td>{row.freshestAt ? formatDateTime(row.freshestAt) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="tiny geo-overview__note">An em dash means the platform has no verified source for that metric; it does not mean zero incidents. Simulated demonstration records are counted separately.</p>
      </section>
    </div>
  );
}
