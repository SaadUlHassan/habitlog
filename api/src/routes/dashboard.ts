import { Router } from "express";
import { listActiveHabits, listLogsForUserSince } from "../data/habits.js";
import { buildDashboard } from "../domain/dashboard.js";
import { localDateFor } from "../domain/dates.js";
import { streakWindowStart } from "../domain/streak.js";
import { requireUser } from "../middleware/auth.js";

export const dashboardRouter = Router();

dashboardRouter.get("/dashboard", async (req, res) => {
  const user = requireUser(req);
  const todayLocal = localDateFor(new Date(), user.timezone);

  const habits = await listActiveHabits(user.id);

  // Two queries total, and the second is skipped entirely when there is nothing to
  // fetch logs for. The window is 90 days, not the 7 the UI renders: reading only a
  // week would silently cap every streak at 7 and still look perfectly plausible.
  const logs =
    habits.length === 0 ? [] : await listLogsForUserSince(user.id, streakWindowStart(todayLocal));

  res.json({
    today: todayLocal,
    habits: buildDashboard(habits, logs, todayLocal),
  });
});
