import { Router, type RequestHandler } from "express";
import { z } from "zod";
import {
  findHabitForUser,
  listLogsForHabitSince,
  upsertLog,
} from "../data/habits.js";
import { buildDashboardHabit } from "../domain/dashboard.js";
import { addLocalDays, isValidLocalDate, localDateFor } from "../domain/dates.js";
import { meetsTarget, streakWindowStart } from "../domain/streak.js";
import { requireUser } from "../middleware/auth.js";
import { badRequest, notFound } from "../middleware/errors.js";
import { validate } from "../middleware/validate.js";

/** How far back a log may be backfilled, in the user's local days. */
const BACKFILL_LIMIT_DAYS = 30;

const LogParams = z.strictObject({
  habitId: z.coerce.number().int().positive(),
});

const LogBody = z
  .strictObject({
    value: z.number().positive().max(99_999_999).optional(),
    // Shape only. Whether the date is allowed depends on the caller's timezone, which
    // the schema has no access to, so the range check happens in the handler.
    date: z.string().refine(isValidLocalDate, "Expected a YYYY-MM-DD calendar date").optional(),
  })
  // Express 5 leaves req.body undefined when no body is sent, where Express 4 gave an
  // empty object. Logging a boolean habit needs no payload at all, so a bare POST has
  // to mean "the default" rather than fail validation.
  .default({});

type LogParamsInput = z.infer<typeof LogParams>;
type LogBodyInput = z.infer<typeof LogBody>;

export const logsRouter = Router();

const createLog: RequestHandler<LogParamsInput, unknown, LogBodyInput> = async (req, res) => {
  const user = requireUser(req);

  // Ownership is part of the lookup, and a habit belonging to someone else is a 404
  // rather than a 403: answering "forbidden" would confirm that the habit exists.
  const habit = await findHabitForUser(req.params.habitId, user.id);
  if (habit === null) {
    throw notFound("No such habit");
  }

  const todayLocal = localDateFor(new Date(), user.timezone);
  const localDate = req.body.date ?? todayLocal;

  // YYYY-MM-DD compares correctly as a string, so no parsing is needed to order dates.
  if (localDate > todayLocal) {
    throw badRequest("Cannot log a habit for a future date.");
  }
  if (localDate < addLocalDays(todayLocal, -BACKFILL_LIMIT_DAYS)) {
    throw badRequest(`Cannot backfill further than ${BACKFILL_LIMIT_DAYS} days.`);
  }

  let value: number;
  if (habit.kind === "boolean") {
    // Rejected rather than ignored: silently discarding a value the client set is the
    // same failure as silently dropping an unknown key.
    if (req.body.value !== undefined) {
      throw badRequest("A boolean habit is logged without a value.");
    }
    value = 1;
  } else {
    if (req.body.value === undefined) {
      throw badRequest("value is required for a quantity habit.");
    }
    value = req.body.value;
  }

  await upsertLog({
    habitId: habit.id,
    userId: user.id,
    value,
    localDate,
    aggregation: habit.aggregation,
  });

  // Re-read rather than predict the stored value: under 'sum' the row now holds the
  // day's running total, which is not the value that was just sent.
  const logs = await listLogsForHabitSince(habit.id, streakWindowStart(todayLocal));
  const stored = logs.find((log) => log.localDate === localDate);
  const storedValue = stored?.value ?? value;

  // Returning the recomputed habit means the client never has to derive a streak, and
  // the optimistic update in the UI has an authoritative result to settle against.
  res.json({
    log: {
      habitId: habit.id,
      date: localDate,
      value: storedValue,
      met: meetsTarget(storedValue, habit.targetValue),
    },
    habit: buildDashboardHabit(habit, logs, todayLocal),
  });
};

logsRouter.post(
  "/habits/:habitId/logs",
  validate<LogParamsInput, LogBodyInput>({ params: LogParams, body: LogBody }),
  createLog,
);
