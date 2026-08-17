import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// Node loads .env natively (>=20.12), so no dotenv dependency. Doing it here rather
// than with a --env-file CLI flag means tests, scripts and `npm run dev` all get the
// same environment without each having to remember the flag.
//
// loadEnvFile does not overwrite variables already present in the environment, so an
// explicit `NODE_ENV=test` from the test runner still wins over the file.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const envFile = join(repoRoot, ".env");
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

// Note: NOT z.strictObject. process.env carries the whole shell environment, so this
// one schema strips unknown keys. Request schemas do the opposite (see Phase 2).
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive(),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string(),
  DB_NAME: z.string().min(1),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  // Fail at boot with the field names, not at the first query with an opaque
  // driver error three layers down.
  console.error(
    "Invalid environment configuration:",
    JSON.stringify(z.flattenError(parsed.error).fieldErrors, null, 2),
  );
  console.error("Expected a .env at the repo root — copy .env.example if it is missing.");
  process.exit(1);
}

export const config = parsed.data;
