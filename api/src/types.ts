/**
 * The authenticated caller. Deliberately does not carry the user's email: no
 * endpoint needs it, and personal data you do not hold cannot leak.
 */
export type AuthUser = {
  id: number;
  displayName: string;
  timezone: string;
};

export type HabitKind = "boolean" | "quantity";
export type Aggregation = "sum" | "last";

/** A habit as stored, with no computed history attached. */
export type Habit = {
  id: number;
  name: string;
  kind: HabitKind;
  targetValue: number;
  unit: string;
  aggregation: Aggregation;
};

export type DayCell = {
  /** YYYY-MM-DD in the user's timezone. */
  date: string;
  value: number;
  met: boolean;
};

/**
 * The dashboard's unit of display. Defined once here and consumed by the routes, the
 * tests and (mirrored by hand) the frontend, so the shape has one owner.
 *
 * `aggregation` is included because the frontend needs it: an optimistic update has to
 * know whether a new reading adds to the day's value or replaces it.
 */
export type DashboardHabit = Habit & {
  currentStreak: number;
  atRisk: boolean;
  /** Whole percent, 0..100. */
  weeklyCompletionRate: number;
  /** Exactly 7 entries, oldest first, the last being the user's local today. */
  days: DayCell[];
};

declare global {
  namespace Express {
    interface Request {
      /** Set by requestContext, which is mounted first so everything downstream can rely on it. */
      requestId: string;
      /**
       * Set only by the authenticate middleware. Optional because unauthenticated
       * routes exist (/health), so reading it has to be a decision rather than an
       * assumption — see requireUser.
       */
      user?: AuthUser;
    }
  }
}
