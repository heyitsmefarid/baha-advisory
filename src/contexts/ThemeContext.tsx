import React, { createContext, ReactNode, useContext, useEffect, useState } from "react";
import { readLocal, writeLocal } from "../lib/storage";

export type ThemePreference = "light" | "dark" | "system";

interface ThemeCtx {
  preference: ThemePreference;
  resolved: "light" | "dark";
  setPreference: (p: ThemePreference) => void;
}

const Ctx = createContext<ThemeCtx | undefined>(undefined);
const KEY = "bahadvisory_theme_v1";

function systemTheme(): "light" | "dark" {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPref] = useState<ThemePreference>(() => readLocal<ThemePreference>(KEY, "system"));
  const [system, setSystem] = useState<"light" | "dark">(systemTheme);

  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const fn = () => setSystem(mq.matches ? "dark" : "light");
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);

  const resolved = preference === "system" ? system : preference;

  useEffect(() => {
    const root = document.documentElement;
    if (preference === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", preference);
    root.style.colorScheme = resolved;
  }, [preference, resolved]);

  const setPreference = (p: ThemePreference) => {
    setPref(p);
    writeLocal(KEY, p);
  };

  return <Ctx.Provider value={{ preference, resolved, setPreference }}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
