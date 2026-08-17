import { describe, expect, it } from "vitest";
import { addLocalDays } from "../domain/dates.js";
import { summariseHabit, type DatedValue } from "../domain/streak.js";

// A fixed "today" rather than a real one. The module takes today as an argument
// precisely so these rules can be stated as rules, and so the suite does not behave
// differently depending on the hour it runs at.
const TODAY = "2026-08-17";

/** `daysAgo` days before TODAY, in the user's local calendar. */
function log(daysAgo: number, value: number): DatedValue {
  return { localDate: addLocalDays(TODAY, -daysAgo), value };
}

/** A boolean habit: target 1, logged as 1. */
function done(daysAgo: number): DatedValue {
  return log(daysAgo, 1);
}

describe("current streak", () => {
  it("is zero with no logs at all, and nothing is at risk", () => {
    const result = summariseHabit(1, [], TODAY);

    expect(result.currentStreak).toBe(0);
    // atRisk means a streak you could still lose today. There is none to lose.
    expect(result.atRisk).toBe(false);
  });

  it("is one when only today is done", () => {
    const result = summariseHabit(1, [done(0)], TODAY);

    expect(result.currentStreak).toBe(1);
    expect(result.atRisk).toBe(false);
  });

  it("counts consecutive days ending today", () => {
    const result = summariseHabit(1, [done(0), done(1), done(2)], TODAY);

    expect(result.currentStreak).toBe(3);
    expect(result.atRisk).toBe(false);
  });

  it("survives an unlogged today, measured to yesterday and flagged at risk", () => {
    // The rule that matters: an incomplete today has not broken anything yet, because
    // the day is not over. Showing 0 here would reset a user's streak at breakfast.
    const result = summariseHabit(1, [done(1), done(2)], TODAY);

    expect(result.currentStreak).toBe(2);
    expect(result.atRisk).toBe(true);
  });

  it("is broken by a missing day, and stops at the gap", () => {
    // Days 0 and 1 done, day 2 missed, days 3 and 4 done. The run ends at the gap.
    const result = summariseHabit(1, [done(0), done(1), done(3), done(4)], TODAY);

    expect(result.currentStreak).toBe(2);
  });

  it("is zero when neither today nor yesterday counts, however long the older run", () => {
    const result = summariseHabit(1, [done(2), done(3), done(4), done(5)], TODAY);

    expect(result.currentStreak).toBe(0);
    expect(result.atRisk).toBe(false);
  });
});

describe("quantity habits", () => {
  it("does not count a day logged below target", () => {
    // Logged, but short. Not the same as unlogged, and still not a counting day.
    const result = summariseHabit(2000, [log(0, 1999), log(1, 2000)], TODAY);

    expect(result.days[6]?.value).toBe(1999);
    expect(result.days[6]?.met).toBe(false);
    expect(result.currentStreak).toBe(1);
    expect(result.atRisk).toBe(true);
  });

  it("counts a day sitting exactly on target", () => {
    // The >= boundary. This is also the case that silently inverts if DECIMAL values
    // ever arrive as strings, since "9.00" >= "10.00" is true.
    const result = summariseHabit(2000, [log(0, 2000)], TODAY);

    expect(result.days[6]?.met).toBe(true);
    expect(result.currentStreak).toBe(1);
  });

  it("counts a day above target", () => {
    const result = summariseHabit(7, [log(0, 8.5)], TODAY);

    expect(result.currentStreak).toBe(1);
  });

  it("treats a day with no log as zero rather than absent", () => {
    const result = summariseHabit(2000, [log(1, 2000)], TODAY);

    expect(result.days[6]?.value).toBe(0);
    expect(result.days[6]?.met).toBe(false);
  });
});

describe("the seven day window", () => {
  it("always has exactly seven days, oldest first, ending today", () => {
    const result = summariseHabit(1, [], TODAY);

    expect(result.days).toHaveLength(7);
    expect(result.days[0]?.date).toBe("2026-08-11");
    expect(result.days[6]?.date).toBe(TODAY);
  });

  it("ignores logs older than the window when reporting days, but not the streak", () => {
    const longRun = Array.from({ length: 20 }, (_, index) => done(index));
    const result = summariseHabit(1, longRun, TODAY);

    expect(result.days).toHaveLength(7);
    // The window is a display concern; the streak sees the whole history it was given.
    expect(result.currentStreak).toBe(20);
  });
});

describe("weekly completion rate", () => {
  it("is zero with nothing logged", () => {
    expect(summariseHabit(1, [], TODAY).weeklyCompletionRate).toBe(0);
  });

  it("is one hundred when every day of the week counts", () => {
    const week = Array.from({ length: 7 }, (_, index) => done(index));

    expect(summariseHabit(1, week, TODAY).weeklyCompletionRate).toBe(100);
  });

  it("is a whole percentage of the last seven days", () => {
    // Three of seven is 42.857…, reported as 43.
    const result = summariseHabit(1, [done(0), done(1), done(2)], TODAY);

    expect(result.weeklyCompletionRate).toBe(43);
  });

  it("counts only days inside the window", () => {
    const result = summariseHabit(1, [done(0), done(8), done(9)], TODAY);

    expect(result.weeklyCompletionRate).toBe(14);
  });
});
