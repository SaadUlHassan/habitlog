import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import { logger } from "../logger.js";

/**
 * Mounted first, so every later middleware, route and the error handler can rely on
 * req.requestId existing.
 *
 * Request logging is hand-rolled on top of pino rather than pulled in via pino-http:
 * the correlation id has to thread through error responses too, so the id is ours to
 * own either way, and this is the whole of what the dependency would have added.
 */
export const requestContext: RequestHandler = (req, res, next) => {
  req.requestId = randomUUID();

  // Echoed so someone reporting a problem can read the id out of their network tab
  // and it can be found directly in the logs.
  res.setHeader("X-Request-Id", req.requestId);

  const startedAt = process.hrtime.bigint();

  res.on("finish", () => {
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    logger.info(
      {
        requestId: req.requestId,
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        durationMs: Math.round(elapsedMs * 100) / 100,
        // The user id is the only identifier that goes to the log. Email and any
        // health value are redacted at the logger — see logger.ts.
        userId: req.user?.id,
      },
      "request",
    );
  });

  next();
};
