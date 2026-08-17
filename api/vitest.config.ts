import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Integration tests share one Docker MySQL and truncate between cases. Vitest
    // runs files in parallel by default, which would let one file wipe another's
    // fixtures mid-assertion — the classic "green locally, flaky in CI" setup.
    fileParallelism: false,
    // Keeps assertion output readable. loadEnvFile does not overwrite variables that
    // are already set, so this wins over LOG_LEVEL in .env.
    env: { LOG_LEVEL: "silent" },
  },
});
