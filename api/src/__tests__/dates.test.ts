import { describe, expect, it } from "vitest";
import {
  addLocalDays,
  isValidLocalDate,
  localDateFor,
  priorLocalDates,
} from "../domain/dates.js";

const SINGAPORE = "Asia/Singapore";
const NEW_YORK = "America/New_York";

describe("which day is it, for whom", () => {
  it("gives a Singapore user the Singapore date, not the UTC one", () => {
    // 23:00 in Singapore on the 17th is 15:00 UTC on the 17th — but at 17:00 UTC it is
    // already the 18th there. This is the instant where naive UTC handling starts
    // filing a user's evening under the wrong day.
    const lateEvening = new Date("2026-08-17T16:30:00Z");

    expect(localDateFor(lateEvening, SINGAPORE)).toBe("2026-08-18");
    expect(lateEvening.toISOString().slice(0, 10)).toBe("2026-08-17");
  });

  it("puts two users on different calendar dates at the same instant", () => {
    // The reason the seed has a second user in another timezone: there is no single
    // "today" for the system to hold, only a today per user.
    const instant = new Date("2026-08-17T20:00:00Z");

    expect(localDateFor(instant, SINGAPORE)).toBe("2026-08-18");
    expect(localDateFor(instant, NEW_YORK)).toBe("2026-08-17");
  });

  it("puts a New York user's small hours on the previous UTC day", () => {
    const afterMidnight = new Date("2026-08-18T03:00:00Z");

    expect(localDateFor(afterMidnight, NEW_YORK)).toBe("2026-08-17");
    expect(localDateFor(afterMidnight, SINGAPORE)).toBe("2026-08-18");
  });

  it("always produces a YYYY-MM-DD string", () => {
    for (const zone of [SINGAPORE, NEW_YORK, "UTC", "Pacific/Kiritimati", "Pacific/Niue"]) {
      expect(localDateFor(new Date("2026-08-17T12:00:00Z"), zone)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe("walking backwards through the calendar", () => {
  it("does not lose a day to a daylight saving transition", () => {
    // Clocks go forward in New York on 2026-03-08, making it a 23 hour day. Building
    // this window by subtracting 86_400_000ms from local midnight yields
    // 2026-03-04, 05, 06, 07, 09 — the window silently shifts and the 8th disappears,
    // so a streak sees a gap that never happened. Anchoring in UTC, which has no DST,
    // removes the question rather than handling it.
    expect(priorLocalDates("2026-03-09", 5)).toEqual([
      "2026-03-05",
      "2026-03-06",
      "2026-03-07",
      "2026-03-08",
      "2026-03-09",
    ]);
  });

  it("does not repeat a day when the clocks go back", () => {
    // 2026-11-01 is a 25 hour day in New York.
    expect(priorLocalDates("2026-11-03", 5)).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
      "2026-11-03",
    ]);
  });

  it("returns the window oldest first, ending at the day it was asked for", () => {
    const window = priorLocalDates("2026-08-17", 7);

    expect(window).toHaveLength(7);
    expect(window[0]).toBe("2026-08-11");
    expect(window[6]).toBe("2026-08-17");
    expect(new Set(window).size).toBe(7);
  });

  it("crosses month and year boundaries", () => {
    expect(addLocalDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addLocalDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addLocalDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("knows 2028 is a leap year and 2026 is not", () => {
    expect(addLocalDays("2028-03-01", -1)).toBe("2028-02-29");
    expect(addLocalDays("2026-02-28", 1)).toBe("2026-03-01");
  });
});

describe("rejecting dates that are not dates", () => {
  it("accepts a real calendar date", () => {
    expect(isValidLocalDate("2026-08-17")).toBe(true);
  });

  it.each(["2026-02-30", "2026-13-01", "2026-00-10", "2026-04-31"])(
    "rejects %s, which parses but does not exist",
    (value) => {
      // Date.UTC rolls these forward rather than refusing them: 2026-02-30 becomes
      // 2 March. Without the round-trip check they would be accepted as backfill.
      expect(isValidLocalDate(value)).toBe(false);
    },
  );

  it.each(["17/08/2026", "2026-8-17", "not a date", "", "2026-08-17T00:00:00Z"])(
    "rejects %s on shape alone",
    (value) => {
      expect(isValidLocalDate(value)).toBe(false);
    },
  );
});
