import React, { ReactNode, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import StatusBanners from "./StatusBanners";
import AccountMenu, { ThemeSwitch } from "./AccountMenu";

interface NavDef {
  to: string;
  label: string;
  icon?: string;
  end?: boolean;
}

const PRIMARY: NavDef[] = [
  { to: "/", label: "Map", icon: "◉", end: true },
  { to: "/navigate", label: "Navigate", icon: "➤" },
  { to: "/report", label: "Report", icon: "＋" },
  { to: "/evacuation", label: "Evacuate", icon: "⌂" },
];

const SECONDARY: NavDef[] = [
  { to: "/overview", label: "Island overview" },
  { to: "/alerts", label: "Alerts" },
  { to: "/risk", label: "Flood risk" },
  { to: "/advisories", label: "Advisories" },
  { to: "/assistant", label: "Ask Baha AI" },
];

const MORE_ONLY: NavDef[] = [{ to: "/offline", label: "Offline safety kit" }];

const FOOTER_LINKS: NavDef[] = [
  { to: "/offline", label: "Offline kit" },
  { to: "/pricing", label: "Pricing" },
  { to: "/business-model", label: "Business model" },
  { to: "/demo", label: "Demo guide" },
];

/**
 * Public application shell. Desktop: one top bar with every destination.
 * Mobile: compact top bar + bottom tab bar (thumb reach) with a "More"
 * sheet. The SOS action is present on every public screen.
 */
export default function AppShell({ children, fullBleed = false }: { children: ReactNode; fullBleed?: boolean }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const location = useLocation();
  const moreActive = SECONDARY.some((s) => location.pathname.startsWith(s.to));

  return (
    <div className={`app-shell ${fullBleed ? "app-shell--full" : ""}`}>
      <header className="app-bar">
        <Link to="/" className="app-bar__brand" aria-label="Bahadvisory home">
          <img className="app-bar__icon" src="/logo/bahadvisory_icon.png" alt="" />
          <img className="app-bar__wordmark" src="/logo/bahadvisory_textlogo.png" alt="Bahadvisory" />
        </Link>
        <nav className="app-bar__nav" aria-label="Main">
          {[...PRIMARY, ...SECONDARY].map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end ?? false}
              className={({ isActive }) => `app-bar__link ${isActive ? "app-bar__link--active" : ""}`}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="app-bar__actions">
          <Link to="/evacuation?sos=1" className="sos-btn" aria-label="SOS — request help and share your location">
            SOS
          </Link>
          <span className="app-bar__theme">
            <ThemeSwitch />
          </span>
          <AccountMenu />
        </div>
      </header>

      <StatusBanners />

      <main className={`app-main ${fullBleed ? "app-main--full" : ""}`} id="main">
        {children}
      </main>

      {!fullBleed && (
        <footer className="app-footer">
          <span>Bahadvisory — flood safety across Mindoro Island. Emergency: call 911.</span>
          <nav aria-label="Footer">
            {FOOTER_LINKS.map((l) => (
              <Link key={l.to} to={l.to}>
                {l.label}
              </Link>
            ))}
          </nav>
        </footer>
      )}

      <nav className="tab-bar" aria-label="Main">
        {PRIMARY.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `tab-bar__item ${isActive ? "tab-bar__item--active" : ""}`}
          >
            <span className="tab-bar__icon" aria-hidden="true">
              {item.icon}
            </span>
            {item.label}
          </NavLink>
        ))}
        <button
          type="button"
          className={`tab-bar__item ${moreActive || moreOpen ? "tab-bar__item--active" : ""}`}
          onClick={() => setMoreOpen((o) => !o)}
          aria-expanded={moreOpen}
        >
          <span className="tab-bar__icon" aria-hidden="true">
            ≡
          </span>
          More
        </button>
      </nav>

      {moreOpen && (
        <div className="more-sheet" onClick={() => setMoreOpen(false)}>
          <div className="more-sheet__panel" onClick={(e) => e.stopPropagation()}>
            {[...SECONDARY, ...MORE_ONLY, ...FOOTER_LINKS].map((l) => (
              <Link key={l.to} to={l.to} className="more-sheet__link" onClick={() => setMoreOpen(false)}>
                {l.label}
              </Link>
            ))}
            <div className="more-sheet__theme">
              <ThemeSwitch />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
