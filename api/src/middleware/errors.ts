import type { ErrorRequestHandler, RequestHandler } from "express";
import { logger } from "../logger.js";

/**
 * An error we chose to produce, as opposed to one that escaped. The distinction is
 * what the handler below uses to decide how much to tell the client.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown): AppError =>
  new AppError(400, "BAD_REQUEST", message, details);

export const validationFailed = (details: unknown): AppError =>
  new AppError(400, "VALIDATION_ERROR", "Request validation failed", details);

export const unauthorized = (message = "Authentication required"): AppError =>
  new AppError(401, "UNAUTHORIZED", message);

// There is deliberately no 403 helper. The only authorisation decision this API makes
// is "is this your habit", and answering 403 there confirms the habit exists and
// belongs to somebody else. Ownership failures are 404.
export const notFound = (message = "Not found"): AppError =>
  new AppError(404, "NOT_FOUND", message);

export const conflict = (message: string): AppError => new AppError(409, "CONFLICT", message);

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(notFound(`No route matches ${req.method} ${req.path}`));
};

/**
 * express.json() rejects malformed and oversized bodies by throwing an http-errors
 * style object rather than an AppError: `{ status: 400, expose: true }` for unparseable
 * JSON, `{ status: 413 }` for a body over the limit. Without this they would fall
 * through to the catch-all below and be reported as 500s — telling the client the
 * server is broken when in fact their request was, and filing routine bad input in the
 * logs at error level.
 *
 * `expose: true` is the convention meaning the error was raised for the client's
 * benefit. We honour the status but still substitute our own message rather than
 * forwarding parser internals.
 */
function clientErrorStatus(err: unknown): number | null {
  if (typeof err !== "object" || err === null) return null;
  if (!("expose" in err) || err.expose !== true) return null;

  const status =
    "status" in err && typeof err.status === "number"
      ? err.status
      : "statusCode" in err && typeof err.statusCode === "number"
        ? err.statusCode
        : null;

  return status !== null && status >= 400 && status < 500 ? status : null;
}

export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    // The response is already streaming; there is no status left to set. Hand back to
    // Express, which will destroy the socket rather than emit a corrupt body.
    next(err);
    return;
  }

  const requestId = req.requestId;
  const userId = req.user?.id;

  if (err instanceof AppError) {
    logger.warn(
      { requestId, userId, code: err.code, status: err.status, details: err.details },
      err.message,
    );
    res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        requestId,
        ...(err.details === undefined ? {} : { details: err.details }),
      },
    });
    return;
  }

  const parserStatus = clientErrorStatus(err);
  if (parserStatus !== null) {
    const code = parserStatus === 413 ? "PAYLOAD_TOO_LARGE" : "BAD_REQUEST";
    logger.warn({ requestId, userId, status: parserStatus, code }, "unreadable request body");
    res.status(parserStatus).json({
      error: { code, message: "Could not read the request body.", requestId },
    });
    return;
  }

  // Anything that is not an AppError is a bug rather than a rejected request. The
  // full error, stack included, goes to the log; the client gets a correlation id and
  // nothing else. A stack trace in a response body is a map of the server's internals.
  logger.error({ requestId, userId, err }, "unhandled error");
  res.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "Something went wrong.", requestId },
  });
};
