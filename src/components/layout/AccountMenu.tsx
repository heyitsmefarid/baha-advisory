import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { useTheme, type ThemePreference } from "../../contexts/ThemeContext";
import { ROLE_LABELS, dashboardPathFor } from "../../../shared/roles";

export function ThemeSwitch() {
  const { preference, setPreference } = useTheme();
  const next: Record<ThemePreference, ThemePreference> = { system: "light", light: "dark", dark: "system" };
  const label = { system: "Auto", light: "Light", dark: "Dark" }[preference];
  return (
    <button
      type="button"
      className="chip-btn"
      onClick={() => setPreference(next[preference])}
      title="Switch color theme"
      aria-label={`Color theme: ${label}. Switch theme`}
    >
      <span aria-hidden="true">{preference === "dark" ? "☾" : preference === "light" ? "☀" : "◐"}</span> {label}
    </button>
  );
}

export default function AccountMenu() {
  const { currentUser, appRole, isAnonymous, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (!currentUser || isAnonymous) {
    return (
      <Link to="/login" className="chip-btn chip-btn--solid">
        Sign in
      </Link>
    );
  }

  const initial = (currentUser.displayName || currentUser.email || "U").charAt(0).toUpperCase();
  return (
    <div className="account-menu" ref={ref}>
      <button
        type="button"
        className="account-menu__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="avatar" aria-hidden="true">
          {initial}
        </span>
        <span className="sr-only">Account menu</span>
      </button>
      {open && (
        <div className="account-menu__panel" role="menu">
          <div className="account-menu__who">
            <strong>{currentUser.displayName || currentUser.email}</strong>
            <span>{ROLE_LABELS[appRole]}</span>
          </div>
          <Link role="menuitem" to={dashboardPathFor(appRole)} onClick={() => setOpen(false)}>
            {appRole === "citizen" ? "My account" : "Dashboard"}
          </Link>
          {appRole !== "citizen" && (
            <Link role="menuitem" to="/me" onClick={() => setOpen(false)}>
              Personal settings
            </Link>
          )}
          <Link role="menuitem" to="/alerts" onClick={() => setOpen(false)}>
            Alerts & saved places
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={async () => {
              setOpen(false);
              await logout();
              navigate("/");
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
