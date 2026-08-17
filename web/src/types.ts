// Mirrored by hand from api/src/types.ts. A types-only workspace package would remove
// the duplication and is the right answer for anything longer-lived; at this size the
// wiring cost outweighed it, and the shapes are small enough to keep honest. Noted in
// the README as a deliberate cut rather than an oversight.

export type HabitKind = "boolean" | "quantity";
export type Aggregation = "sum" | "last";

export type DayCell = {
  /** YYYY-MM-DD in the user's timezone, decided by the server. */
  date: string;
  value: number;
  met: boolean;
};

export type DashboardHabit = {
  id: number;
  name: string;
  kind: HabitKind;
  targetValue: number;
  unit: string;
  aggregation: Aggregation;
  currentStreak: number;
  atRisk: boolean;
  weeklyCompletionRate: number;
  /** Exactly 7, oldest first, the last being today. */
  days: DayCell[];
};

export type Dashboard = {
  today: string;
  habits: DashboardHabit[];
};

export type CurrentUser = {
  id: number;
  displayName: string;
  timezone: string;
  today: string;
};

export type LogResult = {
  log: { habitId: number; date: string; value: number; met: boolean };
  habit: DashboardHabit;
};
