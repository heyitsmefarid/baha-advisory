import React, { createContext, ReactNode, useContext } from "react";
import { doc } from "firebase/firestore";
import { db } from "../firebase";
import { useFirestoreDoc } from "../hooks/useFirestoreDoc";
import type { PlatformGeneralSettings } from "../../shared/types";

const DEFAULTS: PlatformGeneralSettings = {
  demoMode: false,
  aiEnabled: true,
  chatbotEnabled: true,
  imageAnalysisEnabled: true,
  publicReportingEnabled: true,
  emergencyHotlines: [{ label: "National emergency hotline", number: "911" }],
};

const Ctx = createContext<PlatformGeneralSettings>(DEFAULTS);

/** Public platform flags (demo mode banner, feature kill-switches, hotlines). */
export function PlatformProvider({ children }: { children: ReactNode }) {
  const { data } = useFirestoreDoc<PlatformGeneralSettings>(() => doc(db, "platform_settings", "general"), []);
  return <Ctx.Provider value={{ ...DEFAULTS, ...(data ?? {}) }}>{children}</Ctx.Provider>;
}

export function usePlatform(): PlatformGeneralSettings {
  return useContext(Ctx);
}
