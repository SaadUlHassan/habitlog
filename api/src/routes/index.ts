import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { dashboardRouter } from "./dashboard.js";
import { habitsRouter } from "./habits.js";
import { logsRouter } from "./logs.js";
import { meRouter } from "./me.js";

/**
 * Authentication is applied once, here, to the whole router. Individual routes cannot
 * opt out or forget it, and every handler below reaches for the caller through
 * requireUser rather than anything the request said about itself.
 */
export function createApiRouter(): Router {
  const router = Router();

  router.use(authenticate);
  router.use(meRouter);
  router.use(habitsRouter);
  router.use(dashboardRouter);
  router.use(logsRouter);

  return router;
}
