import type { Request, RequestHandler } from "express";
import { z, type ZodType } from "zod";
import { validationFailed } from "./errors.js";

type ValidationSources = {
  params?: ZodType;
  query?: ZodType;
  body?: ZodType;
};

const SOURCES = ["params", "query", "body"] as const;

// Express 5 exposes req.query through a getter, so `req.query = parsed` throws
// "Cannot set property query of #<IncomingMessage> which has only a getter".
// defineProperty works for all three sources, so all three take the same path rather
// than one being special-cased.
function replaceSource(req: Request, source: (typeof SOURCES)[number], value: unknown): void {
  Object.defineProperty(req, source, {
    value,
    writable: true,
    configurable: true,
    enumerable: true,
  });
}

/**
 * Parses the given sources and replaces them with the parsed result, so a handler
 * downstream can only ever see validated, correctly typed input.
 *
 * Schemas are expected to be strict objects: silently dropping an unrecognised key
 * means a client typo looks like success.
 *
 * Mount this on the route itself, not ahead of a sub-router. Express populates
 * req.params during route matching, so a router mounted after this ran would overwrite
 * the parsed params with freshly matched string ones.
 */
export function validate(sources: ValidationSources): RequestHandler {
  return (req, _res, next) => {
    for (const source of SOURCES) {
      const schema = sources[source];
      if (schema === undefined) continue;

      const result = schema.safeParse(req[source]);

      if (!result.success) {
        // Only the issues travel back, never the offending input: a rejected habit log
        // body contains someone's health data, and an error response is the last place
        // it should be reflected.
        next(validationFailed({ source, issues: z.flattenError(result.error) }));
        return;
      }

      replaceSource(req, source, result.data);
    }

    next();
  };
}
