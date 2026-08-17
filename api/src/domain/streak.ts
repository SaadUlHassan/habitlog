import type { DayCell } from "../types.js";
import { addLocalDays, priorLocalDates } from "./dates.js";

/** How far back the streak walk can see. Also the read window for dashboard queries. */
export const STREAK_WINDOW_DAYS = 90;

export const WEEK_DAYS = 7;

export type DatedValue = {
  localDate: string;
  value: number;
};

export type HabitSummary = {
  currentStreak: number;
  atRisk: boolean;
  weeklyCompletionRate: number;
  days: DayCell[];
};

/**
 * The whole definition of a counting day, in one place. Meeting the target counts, so
 * a habit logged at exactly its target is complete — the boundary the whole streak
 * rests on lives here and not in two subtly different comparisons.
 */
export function meetsTarget(value: number, targetValue: number): boolean {
  return value >= targetValue;
}

/** The earliest local date a streak calculation needs to see. */
export function streakWindowStart(todayLocal: string): string {
  return addLocalDays(todayLocal, -(STREAK_WINDOW_DAYS - 1));
}

/**
 * Pure by design: it takes today as an argument and never calls `new Date()`, never
 * touches the database, and never reads a timezone. That is what makes the streak
 * rules testable as rules, and what lets the timezone behaviour be proven separately
 * rather than inferred from an endpoint's output.
 *
 * `logs` holds at most one entry per date — the unique key on (habit_id, local_date)
 * means aggregation already happened on write, so this compares and never sums.
 */
export function summariseHabit(
  targetValue: number,
  logs: readonly DatedValue[],
  todayLocal: string,
): HabitSummary {
  const valueByDate = new Map<string, number>();
  for (const log of logs) {
    valueByDate.set(log.localDate, log.value);
  }

  const valueOn = (date: string): number => valueByDate.get(date) ?? 0;
  const isCountingDay = (date: string): boolean => meetsTarget(valueOn(date), targetValue);

  const days: DayCell[] = priorLocalDates(todayLocal, WEEK_DAYS).map((date) => ({
    date,
    value: valueOn(date),
    met: isCountingDay(date),
  }));

  const metThisWeek = days.filter((day) => day.met).length;
  const weeklyCompletionRate = Math.round((metThisWeek / WEEK_DAYS) * 100);

  if (isCountingDay(todayLocal)) {
    return {
      currentStreak: walkBack(todayLocal, isCountingDay, logs.length),
      atRisk: false,
      weeklyCompletionRate,
      days,
    };
  }

  // An incomplete today does not break a streak until the day is over. The run is
  // measured to yesterday instead and flagged, so the UI can say "keep it alive"
  // rather than showing a streak that has already been reset at breakfast.
  const yesterday = addLocalDays(todayLocal, -1);
  if (isCountingDay(yesterday)) {
    return {
      currentStreak: walkBack(yesterday, isCountingDay, logs.length),
      atRisk: true,
      weeklyCompletionRate,
      days,
    };
  }

  // Nothing running, so nothing is at risk. atRisk is about a streak you could still
  // lose today, and there is no streak here to lose.
  return { currentStreak: 0, atRisk: false, weeklyCompletionRate, days };
}

function walkBack(
  from: string,
  isCountingDay: (date: string) => boolean,
  maxDays: number,
): number {
  let streak = 0;
  let cursor = from;

  // A streak can never be longer than the number of logs it is built from, which is
  // also what guarantees this terminates rather than walking backwards forever.
  while (streak < maxDays && isCountingDay(cursor)) {
    streak += 1;
    cursor = addLocalDays(cursor, -1);
  }

  return streak;
}
