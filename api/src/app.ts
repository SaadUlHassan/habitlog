import express, { type Express } from "express";
import { pingDatabase } from "./db.js";
import { requestContext } from "./middleware/context.js";
import { errorHandler, notFoundHandler } from "./middleware/errors.js";

// Exported as a factory rather than a module-level singleton so supertest can build
// an app per test file without binding a port.
export function createApp(): Express {
  const app = express();

  // Nothing gained by advertising the framework and version to a scanner.
  app.disable("x-powered-by");

  // First, so req.requestId exists for every later middleware and for the error
  // handler that reports it.
  app.use(requestContext);
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

  // API routes mount here in Phase 3, behind `authenticate`.

  // Order matters: unmatched routes become a 404 in the same envelope as every other
  // error, and the error handler is last so it sees everything.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
