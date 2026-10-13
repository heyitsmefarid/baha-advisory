import { defineConfig } from "vitest/config";

// Rules + integration tests — need the Firestore & Auth emulators running
// (use `npm run test:emulator`, which wraps them in `firebase emulators:exec`).
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/rules/**/*.test.ts", "tests/integration/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
