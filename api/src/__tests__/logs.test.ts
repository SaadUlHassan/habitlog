import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { pool } from "../db.js";
import { addLocalDays, localDateFor } from "../domain/dates.js";
import { countLogs, resetToFixture, type Fixture } from "./helpers/fixtures.js";

const app = createApp();
let fixture: Fixture;

// The fixture's first user is in Asia/Singapore, so "today" here means today there —
// which is the whole point. Deriving it the same way the API does keeps this test
// correct at every hour rather than only when UTC happens to agree.
const todayInSingapore = (): string => localDateFor(new Date(), "Asia/Singapore");

beforeEach(async () => {
  fixture = await resetToFixture();
});

afterAll(async () => {
  await pool.end();
});

function log(body: Record<string, unknown>) {
  return request(app)
    .post(`/api/habits/${fixture.aliceSum}/logs`)
    .set("Authorization", fixture.alice.token)
    .send(body);
}

describe("which dates a log may carry", () => {
  it("accepts a backfill inside the window", async () => {
    const response = await log({ value: 2000, date: addLocalDays(todayInSingapore(), -3) });

    expect(response.status).toBe(200);
    expect(await countLogs(fixture.aliceSum)).toBe(1);
  });

  it("refuses tomorrow", async () => {
    const response = await log({ value: 2000, date: addLocalDays(todayInSingapore(), 1) });

    expect(response.status).toBe(400);
    expect(response.body.error.message).toMatch(/future/i);
    expect(await countLogs(fixture.aliceSum)).toBe(0);
  });

  it("accepts the oldest day still in range and refuses the one before it", async () => {
    // Pinning the boundary rather than a value comfortably inside it, since an
    // off-by-one here would go unnoticed indefinitely.
    const today = todayInSingapore();

    const oldest = await log({ value: 2000, date: addLocalDays(today, -30) });
    expect(oldest.status).toBe(200);

    const tooOld = await log({ value: 2000, date: addLocalDays(today, -31) });
    expect(tooOld.status).toBe(400);
    expect(tooOld.body.error.message).toMatch(/backfill/i);
  });

  it("refuses a date that parses but does not exist", async () => {
    const response = await log({ value: 2000, date: "2026-02-30" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("defaults to the caller's local today", async () => {
    const response = await log({ value: 2000 });

    expect(response.body.log.date).toBe(todayInSingapore());
  });
});

describe("what a log may carry", () => {
  it("logs a boolean habit with no payload at all", async () => {
    // What the dashboard's button actually sends. Express 5 leaves req.body undefined
    // where Express 4 gave an empty object, so this would 400 without a schema default.
    const response = await request(app)
      .post(`/api/habits/${fixture.aliceBoolean}/logs`)
      .set("Authorization", fixture.alice.token);

    expect(response.status).toBe(200);
    expect(response.body.log.value).toBe(1);
  });

  it("refuses a value on a boolean habit rather than discarding it", async () => {
    const response = await request(app)
      .post(`/api/habits/${fixture.aliceBoolean}/logs`)
      .set("Authorization", fixture.alice.token)
      .send({ value: 5 });

    expect(response.status).toBe(400);
    expect(await countLogs(fixture.aliceBoolean)).toBe(0);
  });

  it("requires a value on a quantity habit", async () => {
    const response = await log({});

    expect(response.status).toBe(400);
    expect(response.body.error.message).toMatch(/required/i);
  });

  it("refuses a negative or zero reading", async () => {
    expect((await log({ value: -100 })).status).toBe(400);
    expect((await log({ value: 0 })).status).toBe(400);
    expect(await countLogs(fixture.aliceSum)).toBe(0);
  });
});
