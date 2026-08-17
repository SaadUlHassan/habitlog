import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { pool } from "../db.js";
import { countLogs, resetToFixture, storedValue, type Fixture } from "./helpers/fixtures.js";

const app = createApp();
let fixture: Fixture;

beforeEach(async () => {
  fixture = await resetToFixture();
});

afterAll(async () => {
  await pool.end();
});

function logWater(token: string, value: number) {
  return request(app)
    .post(`/api/habits/${fixture.aliceSum}/logs`)
    .set("Authorization", token)
    .send({ value });
}

describe("two submissions of the same day", () => {
  it("keeps one row and answers both", async () => {
    const [first, second] = await Promise.all([
      logWater(fixture.alice.token, 500),
      logWater(fixture.alice.token, 500),
    ]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await countLogs(fixture.aliceSum)).toBe(1);
  });

  it("loses neither reading under 'sum'", async () => {
    // The point of the unique key plus an atomic upsert: both requests reach the
    // database and one takes the insert branch and one the update branch. A
    // read-then-write would let both see "no row yet" and one write would vanish.
    await Promise.all([logWater(fixture.alice.token, 500), logWater(fixture.alice.token, 500)]);

    expect(await storedValue(fixture.aliceSum)).toBe(1000);
  });

  it("holds the total under ten simultaneous writes", async () => {
    await Promise.all(
      Array.from({ length: 10 }, () => logWater(fixture.alice.token, 250)),
    );

    expect(await countLogs(fixture.aliceSum)).toBe(1);
    expect(await storedValue(fixture.aliceSum)).toBe(2500);
  });
});

describe("what 'idempotent' does and does not mean here", () => {
  it("is idempotent in rows, not in value, for a summing habit", async () => {
    // Worth being explicit about, because it is the honest limit of the design. The
    // unique key guarantees one row per day. It does not decide whether a second
    // identical request means "I drank again" or "my phone retried", and for a summing
    // habit those need different answers. Distinguishing them needs an idempotency key
    // from the client, which is a production gap rather than something built here.
    await logWater(fixture.alice.token, 500);
    await logWater(fixture.alice.token, 500);

    expect(await countLogs(fixture.aliceSum)).toBe(1);
    expect(await storedValue(fixture.aliceSum)).toBe(1000);
  });

  it("is idempotent in both for a replacing habit", async () => {
    const send = () =>
      request(app)
        .post(`/api/habits/${fixture.aliceLast}/logs`)
        .set("Authorization", fixture.alice.token)
        .send({ value: 7.5 });

    await send();
    await send();

    expect(await countLogs(fixture.aliceLast)).toBe(1);
    expect(await storedValue(fixture.aliceLast)).toBe(7.5);
  });

  it("settles on one of the values when two replacing writes race", async () => {
    await Promise.all([
      request(app)
        .post(`/api/habits/${fixture.aliceLast}/logs`)
        .set("Authorization", fixture.alice.token)
        .send({ value: 6 }),
      request(app)
        .post(`/api/habits/${fixture.aliceLast}/logs`)
        .set("Authorization", fixture.alice.token)
        .send({ value: 8 }),
    ]);

    expect(await countLogs(fixture.aliceLast)).toBe(1);
    // Last writer wins, and which one that is genuinely is not determined — the
    // guarantee is one coherent row, not a particular winner.
    expect([6, 8]).toContain(await storedValue(fixture.aliceLast));
  });

  it("is fully idempotent for a boolean habit however many times it is pressed", async () => {
    const press = () =>
      request(app)
        .post(`/api/habits/${fixture.aliceBoolean}/logs`)
        .set("Authorization", fixture.alice.token)
        .send({});

    await Promise.all([press(), press(), press()]);

    expect(await countLogs(fixture.aliceBoolean)).toBe(1);
    expect(await storedValue(fixture.aliceBoolean)).toBe(1);
  });
});

describe("the streak the client is handed back", () => {
  it("reflects the write that just happened", async () => {
    const response = await request(app)
      .post(`/api/habits/${fixture.aliceSum}/logs`)
      .set("Authorization", fixture.alice.token)
      .send({ value: 2000 });

    expect(response.body.habit.currentStreak).toBe(1);
    expect(response.body.habit.atRisk).toBe(false);
    expect(response.body.log.met).toBe(true);
  });

  it("reports the day's running total, not the value just sent", async () => {
    await logWater(fixture.alice.token, 1200);
    const second = await logWater(fixture.alice.token, 1200);

    // Under 'sum' the stored row now holds 2400. Echoing back the 1200 that was sent
    // would leave the client's optimistic state permanently wrong.
    expect(second.body.log.value).toBe(2400);
    expect(second.body.log.met).toBe(true);
    expect(second.body.habit.currentStreak).toBe(1);
  });
});
