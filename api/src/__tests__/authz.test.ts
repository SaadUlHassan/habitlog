import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { pool } from "../db.js";
import { countLogs, resetToFixture, type Fixture } from "./helpers/fixtures.js";

const app = createApp();
let fixture: Fixture;

beforeEach(async () => {
  fixture = await resetToFixture();
});

afterAll(async () => {
  await pool.end();
});

describe("who the caller is", () => {
  it("refuses a request with no credentials", async () => {
    const response = await request(app).get("/api/dashboard");

    expect(response.status).toBe(401);
  });

  it("refuses a token that resolves to nobody, indistinguishably from a bad one", async () => {
    const response = await request(app)
      .get("/api/dashboard")
      .set("Authorization", "Bearer dev-user-999999");

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("reports the caller's own timezone and local date", async () => {
    const [alice, bob] = await Promise.all([
      request(app).get("/api/me").set("Authorization", fixture.alice.token),
      request(app).get("/api/me").set("Authorization", fixture.bob.token),
    ]);

    expect(alice.body.timezone).toBe("Asia/Singapore");
    expect(bob.body.timezone).toBe("America/New_York");
  });
});

describe("reaching another user's data", () => {
  it("answers 404, not 403, when logging against someone else's habit", async () => {
    // 403 would confirm the habit exists and belongs to somebody. Existence is itself
    // information, so a habit that is not yours is a habit that is not there.
    const response = await request(app)
      .post(`/api/habits/${fixture.bobBoolean}/logs`)
      .set("Authorization", fixture.alice.token)
      .send({});

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  it("is indistinguishable from a habit that does not exist at all", async () => {
    const notYours = await request(app)
      .post(`/api/habits/${fixture.bobBoolean}/logs`)
      .set("Authorization", fixture.alice.token)
      .send({});
    const notReal = await request(app)
      .post("/api/habits/424242/logs")
      .set("Authorization", fixture.alice.token)
      .send({});

    expect(notReal.status).toBe(notYours.status);
    expect(notReal.body.error.code).toBe(notYours.body.error.code);
    expect(notReal.body.error.message).toBe(notYours.body.error.message);
  });

  it("writes nothing when the habit is not the caller's", async () => {
    await request(app)
      .post(`/api/habits/${fixture.bobBoolean}/logs`)
      .set("Authorization", fixture.alice.token)
      .send({});

    expect(await countLogs(fixture.bobBoolean)).toBe(0);
  });

  it("shows each user only their own habits on the dashboard", async () => {
    const [alice, bob] = await Promise.all([
      request(app).get("/api/dashboard").set("Authorization", fixture.alice.token),
      request(app).get("/api/dashboard").set("Authorization", fixture.bob.token),
    ]);

    expect(alice.body.habits.map((habit: { name: string }) => habit.name).sort()).toEqual([
      "Run",
      "Sleep",
      "Water",
    ]);
    expect(bob.body.habits.map((habit: { name: string }) => habit.name)).toEqual(["Meditate"]);
  });

  it("lists only the caller's habits", async () => {
    const response = await request(app)
      .get("/api/habits")
      .set("Authorization", fixture.bob.token);

    expect(response.body.habits).toHaveLength(1);
    expect(response.body.habits[0].id).toBe(fixture.bobBoolean);
  });
});

describe("identity supplied by the client", () => {
  it("rejects a body carrying a userId rather than honouring it", async () => {
    // The failure in the sample under review: the API trusted req.body.userId. Here
    // strict validation refuses the request outright, so there is no path where a
    // client-supplied identity is read at all.
    const response = await request(app)
      .post(`/api/habits/${fixture.aliceSum}/logs`)
      .set("Authorization", fixture.alice.token)
      .send({ value: 500, userId: fixture.bob.id });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(await countLogs(fixture.aliceSum)).toBe(0);
  });

  it("ignores a userId in the query string", async () => {
    const response = await request(app)
      .get(`/api/dashboard?userId=${fixture.bob.id}`)
      .set("Authorization", fixture.alice.token);

    expect(response.status).toBe(200);
    expect(response.body.habits.map((habit: { name: string }) => habit.name).sort()).toEqual([
      "Run",
      "Sleep",
      "Water",
    ]);
  });

  it("writes the log against the authenticated user, not any id in the path", async () => {
    await request(app)
      .post(`/api/habits/${fixture.aliceSum}/logs`)
      .set("Authorization", fixture.alice.token)
      .send({ value: 500 });

    const bobDashboard = await request(app)
      .get("/api/dashboard")
      .set("Authorization", fixture.bob.token);

    const bobTotals = bobDashboard.body.habits.flatMap((habit: { days: { value: number }[] }) =>
      habit.days.map((day) => day.value),
    );
    expect(bobTotals.every((value: number) => value === 0)).toBe(true);
  });
});
