// Keeps ".env is gitignored" and "a clean clone runs with no manual steps" both true:
// the template is committed, the real file is generated on first run, and neither
// contains a credential that matters outside this machine.
//
// Runs on `prepare` (post-install) rather than `predev` so that every entry point
// gets an environment, including `npm run dev:api` on its own.
import { copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const target = join(root, ".env");

if (existsSync(target)) {
  process.exit(0);
}

copyFileSync(join(root, ".env.example"), target);
console.log("Created .env from .env.example");
