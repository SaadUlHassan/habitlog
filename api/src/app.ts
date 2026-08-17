import express, { type Express } from "express";
import { pingDatabase } from "./db.js";

// Exported as a factory rather than a module-level singleton so supertest can build
// an app per test file without binding a port.
export function createApp(): Express {
  const app = express();

  app.use(express.json({ limit: "64kb" }));

  // Deliberately not behind auth, and deliberately not routed through the generic
  // error handler: a health probe that reports 500 "internal error" when the database
  // is down has told the orchestrator nothing useful.
  app.get("/health", async (_req, res) => {
    try {
      await pingDatabase();
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false, error: "database unreachable" });
    }
  });

  return app;
}
