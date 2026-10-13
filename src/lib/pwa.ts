import { useEffect, useState } from "react";

/**
 * Service-worker registration (production builds only) and the browser
 * install prompt. Updates are applied on the next navigation — never
 * mid-emergency without the person choosing to reload.
 */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferredPrompt: InstallPromptEvent | null = null;
const installListeners = new Set<(available: boolean) => void>();
let updateReady: ServiceWorker | null = null;
const updateListeners = new Set<(ready: boolean) => void>();

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e as InstallPromptEvent;
    installListeners.forEach((fn) => fn(true));
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    installListeners.forEach((fn) => fn(false));
  });
}

export function registerServiceWorker() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      const track = (worker: ServiceWorker | null) => {
        worker?.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            updateReady = worker;
            updateListeners.forEach((fn) => fn(true));
          }
        });
      };
      if (reg.waiting && navigator.serviceWorker.controller) {
        updateReady = reg.waiting;
        updateListeners.forEach((fn) => fn(true));
      }
      reg.addEventListener("updatefound", () => track(reg.installing));
      // Reload only when a new version replaces the one controlling this
      // page. The first install also fires controllerchange (clients.claim),
      // and reloading then could wipe a form the visitor is filling in.
      let hadController = Boolean(navigator.serviceWorker.controller);
      let reloading = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (!hadController) {
          hadController = true;
          return;
        }
        if (reloading) return;
        reloading = true;
        window.location.reload();
      });
    } catch (err) {
      console.warn("[pwa] service worker registration failed", err);
    }
  });
}

export function applyUpdate() {
  updateReady?.postMessage("SKIP_WAITING");
}

export function useUpdateReady(): boolean {
  const [ready, setReady] = useState(Boolean(updateReady));
  useEffect(() => {
    updateListeners.add(setReady);
    return () => {
      updateListeners.delete(setReady);
    };
  }, []);
  return ready;
}

export function useInstallPrompt(): { canInstall: boolean; install: () => Promise<boolean>; installed: boolean } {
  const [canInstall, setCanInstall] = useState(Boolean(deferredPrompt));
  const installed = typeof window !== "undefined" && window.matchMedia?.("(display-mode: standalone)").matches;
  useEffect(() => {
    installListeners.add(setCanInstall);
    return () => {
      installListeners.delete(setCanInstall);
    };
  }, []);
  return {
    canInstall,
    installed: Boolean(installed),
    install: async () => {
      if (!deferredPrompt) return false;
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      deferredPrompt = null;
      setCanInstall(false);
      return outcome === "accepted";
    },
  };
}
