import pino from "pino";
import { config } from "./config.js";

// This is a health product handling personal data under PDPA. Identifiers and health
// values do not belong in application logs, and redaction is configured once here
// rather than left to every call site remembering to omit the right field.
export const logger = pino({
  level: config.LOG_LEVEL,
  redact: {
    paths: [
      "req.headers.authorization",
      "*.email",
      "*.password",
      "*.displayName",
      "*.value",
      "email",
      "password",
      "value",
    ],
    remove: true,
  },
});
