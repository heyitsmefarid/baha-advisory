import { loadEnv } from "vite";

/**
 * Shared setup for local admin scripts (seed, accounts, export/import).
 *  --emulator    target the local Emulator Suite (default when
 *                FIRESTORE_EMULATOR_HOST is already set)
 *  --production  target the real project (needs FIREBASE_SERVICE_ACCOUNT
 *                or GOOGLE_APPLICATION_CREDENTIALS) — must be explicit.
 */
export function setupScriptEnv(argv = process.argv.slice(2)) {
  const fileEnv = loadEnv("development", process.cwd(), "");
  for (const [k, v] of Object.entries(fileEnv)) if (process.env[k] === undefined) process.env[k] = v;

  const wantsEmulator = argv.includes("--emulator") || Boolean(process.env.FIRESTORE_EMULATOR_HOST);
  const wantsProduction = argv.includes("--production");

  if (wantsEmulator && wantsProduction) {
    throw new Error("Choose either --emulator or --production, not both.");
  }
  if (!wantsEmulator && !wantsProduction) {
    throw new Error(
      "Refusing to run without a target. Use --emulator (local Emulator Suite) or --production (real Firebase project)."
    );
  }
  if (wantsEmulator) {
    process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
    process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";
    process.env.FIREBASE_PROJECT_ID ||= process.env.VITE_FIREBASE_PROJECT_ID || "demo-bahadvisory";
    if (!process.env.FIREBASE_PROJECT_ID.startsWith("demo-") && !argv.includes("--allow-non-demo-emulator")) {
      process.env.FIREBASE_PROJECT_ID = "demo-bahadvisory";
    }
  } else {
    delete process.env.FIRESTORE_EMULATOR_HOST;
    delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
    if (!process.env.FIREBASE_SERVICE_ACCOUNT && !process.env.FIREBASE_PRIVATE_KEY && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      throw new Error("--production needs FIREBASE_SERVICE_ACCOUNT (or GOOGLE_APPLICATION_CREDENTIALS) in your environment / .env.");
    }
  }
  return {
    emulator: wantsEmulator,
    projectId: process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || "(from credentials)",
    flag: (name: string) => argv.includes(name),
    option: (name: string): string | undefined => {
      const i = argv.indexOf(name);
      if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--")) return argv[i + 1];
      const eq = argv.find((a) => a.startsWith(`${name}=`));
      return eq ? eq.slice(name.length + 1) : undefined;
    },
  };
}
