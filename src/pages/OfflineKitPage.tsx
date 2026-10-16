import React from "react";
import { Link } from "react-router-dom";
import AppShell from "../components/layout/AppShell";
import { Badge, Callout, EmptyState, Freshness, PageHeader, SimulatedBadge } from "../components/ui";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import { useStoredSnapshot } from "../hooks/useOfflineSnapshot";
import { useDrafts } from "../hooks/useDraftSync";
import { useInstallPrompt } from "../lib/pwa";
import { ALERT_SEVERITY, EVAC_STATUS } from "../lib/labels";

/**
 * Offline safety kit — what this device has saved, each item with its
 * age. Everything here is explicitly last-known information, never live.
 */
export default function OfflineKitPage() {
  const online = useOnlineStatus();
  const { snap, loaded } = useStoredSnapshot();
  const drafts = useDrafts();
  const { canInstall, install, installed } = useInstallPrompt();

  return (
    <AppShell>
      <PageHeader
        title="Offline safety kit"
        subtitle="Information this device saved the last time it was online. Use it when the network is down — and check its age before acting on it."
      />
      <div className="readout-strip">
        <div className="readout">
          <span className="readout__value">{online ? "Online" : "Offline"}</span>
          <span className="readout__label">Connection</span>
        </div>
        <div className="readout">
          <span className="readout__value">{snap ? <Freshness at={snap.savedAt} prefix="" /> : "—"}</span>
          <span className="readout__label">Kit last saved</span>
        </div>
        <div className="readout">
          <span className="readout__value">{drafts.length}</span>
          <span className="readout__label">Reports waiting to send</span>
        </div>
      </div>

      {!installed && (
        <div className="panel">
          <h3 className="panel__title">Install Bahadvisory</h3>
          <p className="small">
            Installing keeps the app, the maps you've viewed and this kit available without a connection, and lets alerts reach you when the browser is
            closed.
          </p>
          {canInstall ? (
            <button onClick={install}>Install app</button>
          ) : (
            <p className="tiny">Use your browser's "Add to Home screen" / "Install app" menu item.</p>
          )}
        </div>
      )}

      <div className="grid-2">
        <div className="stack">
          <div className="panel">
            <h3 className="panel__title">Emergency numbers</h3>
            <ul className="list-plain hotlines">
              {(snap?.hotlines ?? [{ label: "National emergency hotline", number: "911" }]).map((h) => (
                <li key={h.number}>
                  <a className="sos-call" href={`tel:${h.number}`}>
                    {h.label}: {h.number}
                  </a>
                </li>
              ))}
            </ul>
            {snap && snap.contacts.length > 0 && (
              <>
                <h4 className="small">My emergency contacts</h4>
                <ul className="list-plain">
                  {snap.contacts.map((c) => (
                    <li key={c.id} className="draft-row">
                      <span className="small">
                        <strong>{c.name}</strong> {c.relationship ? `· ${c.relationship}` : ""}
                      </span>
                      {c.phone && <a className="chip-btn" href={`tel:${c.phone}`}>{c.phone}</a>}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <div className="panel">
            <h3 className="panel__title">Last-known alerts</h3>
            {!loaded ? null : !snap || snap.alerts.length === 0 ? (
              <p className="small muted">No alerts were active when this kit was saved.</p>
            ) : (
              <ul className="list-plain alert-list">
                {snap.alerts.map((a) => (
                  <li key={a.id} className={`alert-card alert-card--${a.severity}`}>
                    <span className="row">
                      <Badge tone={ALERT_SEVERITY[a.severity].tone}>{ALERT_SEVERITY[a.severity].label}</Badge>
                      <Badge tone="caution">Saved copy</Badge>
                      <SimulatedBadge show={!!a.simulated} />
                    </span>
                    <strong>{a.title}</strong>
                    <p className="small">{a.body}</p>
                    <span className="tiny">
                      Issued <Freshness at={a.createdAtMs} prefix="" /> · {a.area}
                      {a.expiresAtMs && a.expiresAtMs < Date.now() ? " · may have expired" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="stack">
          <div className="panel">
            <h3 className="panel__title">Evacuation centers (saved)</h3>
            {!snap ? (
              <EmptyState title="Nothing saved yet">Open Bahadvisory while online once — centers and alerts are saved automatically.</EmptyState>
            ) : (
              <ul className="list-plain">
                {snap.centers.map((c) => (
                  <li key={c.id} className="draft-row">
                    <div>
                      <strong className="small">{c.name}</strong> <SimulatedBadge show={!!c.simulated} />
                      <div className="tiny">
                        {c.address} · {EVAC_STATUS[c.status].label} as of <Freshness at={c.updatedAtMs} prefix="" />
                      </div>
                      <div className="tiny mono">
                        {c.location.lat.toFixed(5)}, {c.location.lng.toFixed(5)}
                      </div>
                    </div>
                    {c.contact?.phone && <a className="chip-btn" href={`tel:${c.contact.phone}`}>Call</a>}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="panel">
            <h3 className="panel__title">Official advisories (saved)</h3>
            {snap?.advisories.length ? (
              snap.advisories.map((a) => (
                <details key={a.id} className="advisory-saved">
                  <summary>
                    <strong className="small">{a.title}</strong> <SimulatedBadge show={!!a.simulated} />
                  </summary>
                  <p className="small">{a.body}</p>
                  {a.bodyFil && <p className="small">{a.bodyFil}</p>}
                  <span className="tiny">Published <Freshness at={a.publishedAtMs} prefix="" /></span>
                </details>
              ))
            ) : (
              <p className="small muted">No advisories saved.</p>
            )}
          </div>
          <Callout tone="neutral">
            Maps you have already viewed stay available offline. Reports you write offline are saved and sent automatically — see{" "}
            <Link to="/report">Report</Link>.
          </Callout>
        </div>
      </div>
    </AppShell>
  );
}
