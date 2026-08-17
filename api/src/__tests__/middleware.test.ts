import express, { type Express } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { authenticate, requireUser } from "../middleware/auth.js";
import { requestContext } from "../middleware/context.js";
import { errorHandler, notFound, notFoundHandler } from "../middleware/errors.js";
import { validate } from "../middleware/validate.js";

// Built from the real middleware rather than createApp(), so these cases exercise the
// cross-cutting behaviour without needing a database. The auth cases here all fail
// before the user lookup; the ones that hit the database belong with the integration
// tests in Phase 4.
function buildTestApp(): Express {
  const app = express();
  app.use(requestContext);
  // Small limit so the oversized-body case is cheap to provoke; production uses 64kb.
  app.use(express.json({ limit: "200b" }));

  app.get("/deliberate", () => {
    throw notFound("Habit not found");
  });

  app.get("/bug", () => {
    throw new Error("connection refused to prod-db.internal as user root");
  });

  app.get("/async-bug", async () => {
    throw new Error("thrown after an await");
  });

  app.post(
    "/habits",
    validate({ body: z.strictObject({ name: z.string().min(1), target: z.number().positive() }) }),
    (req, res) => {
      res.status(201).json({ received: req.body });
    },
  );

  app.get("/private", authenticate, (_req, res) => {
    res.json({ ok: true });
  });

  // Mounted without `authenticate` on purpose, to prove a wiring mistake fails loudly
  // rather than quietly serving the route as anonymous.
  app.get("/unwired", (req, res) => {
    res.json({ userId: requireUser(req).id });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

const app = buildTestApp();

describe("error handling", () => {
  it("returns a deliberate error with its own status and code", async () => {
    const response = await request(app).get("/deliberate");

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
    expect(response.body.error.message).toBe("Habit not found");
  });

  it("never leaks internals or a stack trace when something unexpected throws", async () => {
    const response = await request(app).get("/bug");

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe("INTERNAL_ERROR");

    // The response carries a correlation id and nothing else: no stack, no message
    // from the underlying failure, no hostname or credential that appeared in it.
    expect(Object.keys(response.body.error).sort()).toEqual(["code", "message", "requestId"]);
    const serialised = JSON.stringify(response.body);
    expect(serialised).not.toContain("prod-db.internal");
    expect(serialised).not.toContain("root");
    expect(serialised).not.toMatch(/\bat\s+\w+.*:\d+:\d+/);
  });

  it("catches errors thrown after an await, without a wrapper", async () => {
    // This is why the stack is on Express 5: in 4.x this request would hang until
    // the client timed out.
    const response = await request(app).get("/async-bug");

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe("INTERNAL_ERROR");
  });

  it("reports an unmatched route in the same envelope as every other error", async () => {
    const response = await request(app).get("/no-such-route");

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
    expect(response.body.error.requestId).toBeTruthy();
  });

  it("correlates the response header with the id in the error body", async () => {
    const response = await request(app).get("/deliberate");

    expect(response.headers["x-request-id"]).toBeTruthy();
    expect(response.body.error.requestId).toBe(response.headers["x-request-id"]);
  });

  it("gives every request its own id", async () => {
    const [first, second] = await Promise.all([
      request(app).get("/deliberate"),
      request(app).get("/deliberate"),
    ]);

    expect(first.body.error.requestId).not.toBe(second.body.error.requestId);
  });
});

describe("unreadable request bodies", () => {
  it("treats malformed JSON as the client's error, not the server's", async () => {
    const response = await request(app)
      .post("/habits")
      .set("Content-Type", "application/json")
      .send("{not json");

    // express.json() throws an http-errors object rather than an AppError; left
    // unhandled it surfaces as a 500 and files routine bad input as a server bug.
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("BAD_REQUEST");
    expect(response.body.error.requestId).toBeTruthy();
  });

  it("rejects a body over the size limit with 413", async () => {
    const response = await request(app)
      .post("/habits")
      .send({ name: "x".repeat(500), target: 30 });

    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("does not forward the parser's own message", async () => {
    const response = await request(app)
      .post("/habits")
      .set("Content-Type", "application/json")
      .send("{not json");

    expect(JSON.stringify(response.body)).not.toContain("JSON");
    expect(JSON.stringify(response.body)).not.toContain("position");
  });
});

describe("validation", () => {
  it("accepts a valid body and passes the parsed value through", async () => {
    const response = await request(app).post("/habits").send({ name: "Read", target: 30 });

    expect(response.status).toBe(201);
    expect(response.body.received).toEqual({ name: "Read", target: 30 });
  });

  it("rejects a missing field with details naming it", async () => {
    const response = await request(app).post("/habits").send({ name: "Read" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(response.body.error.details.source).toBe("body");
    expect(Object.keys(response.body.error.details.issues.fieldErrors)).toContain("target");
  });

  it("rejects an unknown key rather than silently dropping it", async () => {
    // A dropped key means a client typo, or a field the client believes it is
    // setting, looks exactly like success.
    const response = await request(app)
      .post("/habits")
      .send({ name: "Read", target: 30, targett: 999 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("does not echo the rejected input back", async () => {
    const response = await request(app)
      .post("/habits")
      .send({ name: "Weight", target: -1, secretReading: 78.4 });

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).not.toContain("78.4");
  });
});

describe("authentication", () => {
  it("refuses a request with no Authorization header", async () => {
    const response = await request(app).get("/private");

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it.each([
    ["a bare token", "dev-user-1"],
    ["the wrong scheme", "Basic dev-user-1"],
    ["a non-numeric id", "Bearer dev-user-abc"],
    ["an empty id", "Bearer dev-user-"],
  ])("refuses %s", async (_label, header) => {
    const response = await request(app).get("/private").set("Authorization", header);

    expect(response.status).toBe(401);
  });

  it("fails loudly if a route is mounted without the auth middleware", async () => {
    // The dangerous failure mode is the quiet one: a route that forgets `authenticate`
    // and serves whatever an undefined user resolves to.
    const response = await request(app).get("/unwired");

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe("INTERNAL_ERROR");
  });
});
