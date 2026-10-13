import React, { useEffect, useState } from "react";
import { useOnlineStatus } from "../../hooks/useOnlineStatus";
import { usePlatform } from "../../contexts/PlatformContext";
import { FIREBASE_CONFIGURED, USE_EMULATORS } from "../../firebase";
import { readLocal, writeLocal } from "../../lib/storage";
import { formatAge } from "../../../shared/time";
import { applyUpdate, useUpdateReady } from "../../lib/pwa";
import { Link } from "react-router-dom";

const LAST_ONLINE_KEY = "bahadvisory_last_online_v1";

/**
 * Global status strip: offline state (with last-sync time so cached
 * warnings are never mistaken for live data), demo-mode notice, and
 * configuration problems.
 */
export default function StatusBanners() {
  const online = useOnlineStatus();
  const platform = usePlatform();
  const [lastOnline, setLastOnline] = useState<number | null>(() => readLocal<number | null>(LAST_ONLINE_KEY, null));
  const [demoDismissed, setDemoDismissed] = useState(false);
  const updateReady = useUpdateReady();

  useEffect(() => {
    if (!online) return;
    const mark = () => {
      const now = Date.now();
      setLastOnline(now);
      writeLocal(LAST_ONLINE_KEY, now);
    };
    mark();
    const t = setInterval(mark, 60_000);
    return () => clearInterval(t);
  }, [online]);

  return (
    <div className="status-banners">
      {!online && (
        <div className="status-banner status-banner--offline" role="status">
          <strong>Offline.</strong> Showing information saved on this device
          {lastOnline ? `, last synced ${formatAge(lastOnline)}` : ""}. It may be outdated — not live. Reports you
          submit are kept as drafts and sent when you reconnect. <Link to="/offline">Open the offline safety kit</Link>.
        </div>
      )}
      {updateReady && (
        <div className="status-banner status-banner--update" role="status">
          <span>A new version of Bahadvisory is ready.</span>
          <button type="button" className="btn-sm" onClick={applyUpdate}>Reload to update</button>
        </div>
      )}
      {!FIREBASE_CONFIGURED && (
        <div className="status-banner status-banner--warn" role="alert">
          Firebase is not configured. Copy <code>.env.example</code> to <code>.env</code> and add your project keys, or
          set <code>VITE_USE_EMULATORS=true</code> to run against the local emulators.
        </div>
      )}
      {platform.maintenanceMessage && <div className="status-banner status-banner--warn">{platform.maintenanceMessage}</div>}
      {(platform.demoMode || USE_EMULATORS) && !demoDismissed && (
        <div className="status-banner status-banner--demo">
          <span>
            <strong>Demo environment.</strong> Records tagged <em>Simulated</em> are demonstration data, not real flood
            information. For emergencies call <strong>911</strong>.
          </span>
          <button type="button" className="status-banner__close" onClick={() => setDemoDismissed(true)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
    </div>
  );
}
