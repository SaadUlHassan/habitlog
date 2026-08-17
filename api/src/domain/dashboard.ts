import type { DashboardHabit, Habit } from "../types.js";
import { summariseHabit, type DatedValue } from "./streak.js";

export type HabitLog = DatedValue & { habitId: number };

export function buildDashboardHabit(
  habit: Habit,
  logs: readonly DatedValue[],
  todayLocal: string,
): DashboardHabit {
  return { ...habit, ...summariseHabit(habit.targetValue, logs, todayLocal) };
}

/**
 * Assembles every habit's history from one flat list of logs.
 *
 * This grouping is the reason the dashboard needs exactly two queries: the logs for
 * every habit arrive together and are indexed here, rather than each habit fetching
 * its own rows inside a loop.
 */
export function buildDashboard(
  habits: readonly Habit[],
  logs: readonly HabitLog[],
  todayLocal: string,
): DashboardHabit[] {
  const logsByHabit = new Map<number, DatedValue[]>();

  for (const log of logs) {
    const existing = logsByHabit.get(log.habitId);
    if (existing === undefined) {
      logsByHabit.set(log.habitId, [{ localDate: log.localDate, value: log.value }]);
    } else {
      existing.push({ localDate: log.localDate, value: log.value });
    }
  }

  return habits.map((habit) =>
    buildDashboardHabit(habit, logsByHabit.get(habit.id) ?? [], todayLocal),
  );
}
