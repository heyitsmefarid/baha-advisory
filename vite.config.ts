import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { bahadvisoryApi } from "./server/devPlugin";
import { bahadvisoryPwa } from "./server/pwaPlugin";

export default defineConfig(({ mode, command }) => {
  if (command === "serve" || process.argv.includes("preview")) {
    // The dev API (server/) runs inside this process and reads backend
    // secrets from process.env. Only VITE_* vars are ever exposed to the
    // browser bundle — GROQ_API_KEY etc. stay server-side.
    const all = loadEnv(mode, process.cwd(), "");
    for (const [k, v] of Object.entries(all)) {
      if (process.env[k] === undefined) process.env[k] = v;
    }
  }
  return {
    plugins: [react(), bahadvisoryApi(), bahadvisoryPwa()],
    server: { port: 5173 },
    ssr: { external: ["firebase-admin"] },
    build: {
      rollupOptions: {
        output: {
          // Long-lived vendor chunks: app updates don't re-download these.
          manualChunks: {
            react: ["react", "react-dom", "react-router-dom"],
            firebase: ["firebase/app", "firebase/auth", "firebase/firestore"],
            leaflet: ["leaflet", "react-leaflet"],
          },
        },
      },
    },
  };
});
