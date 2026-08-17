import type { Request, RequestHandler } from "express";
import type { RowDataPacket } from "mysql2/promise";
import { pool } from "../db.js";
import type { AuthUser } from "../types.js";
import { AppError, unauthorized } from "./errors.js";

// A stand-in for a session or JWT check, not a shortcut around one. What matters is
// the contract it establishes: identity is resolved server-side and published as
// req.user, and nothing downstream is allowed to learn who the caller is any other
// way. Replacing this with real auth changes how identity is *proven* and touches no
// route, because no route reads a user id from the request.
const DEV_TOKEN_PATTERN = /^Bearer\s+dev-user-(\d+)$/;

export const authenticate: RequestHandler = async (req, _res, next) => {
  const header = req.get("authorization");
  const match = header === undefined ? null : DEV_TOKEN_PATTERN.exec(header);

  if (match === null) {
    next(unauthorized("Provide an Authorization header of the form 'Bearer dev-user-<id>'"));
    return;
  }

  // Number(undefined) is NaN, so this covers the capture group being absent — which
  // the pattern makes impossible but the type does not — without a non-null assertion.
  const userId = Number(match[1]);
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    next(unauthorized("Malformed developer token"));
    return;
  }

  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, display_name, timezone FROM users WHERE id = ?",
    [userId],
  );

  const row = rows[0];
  if (row === undefined) {
    // Same response as a missing token. A token that resolves to nobody should not be
    // distinguishable from one that was never valid.
    next(unauthorized("Unknown or expired credentials"));
    return;
  }

  req.user = {
    id: Number(row.id),
    displayName: String(row.display_name),
    timezone: String(row.timezone),
  };

  next();
};

/**
 * Reads the authenticated user, or fails loudly if the route was mounted without
 * `authenticate`. That is a wiring mistake rather than a client error, so it surfaces
 * as a 500 instead of silently treating the request as anonymous.
 *
 * Typed by the one field it reads rather than by Request, so it accepts handlers whose
 * params and body have been narrowed by validate().
 */
export function requireUser(req: Pick<Request, "user">): AuthUser {
  if (req.user === undefined) {
    throw new AppError(500, "INTERNAL_ERROR", "Route is missing authentication middleware");
  }
  return req.user;
}
