import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { insertHabit, listActiveHabits } from "../data/habits.js";
import { requireUser } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import type { Habit } from "../types.js";

/**
 * A discriminated union rather than one shape with optional fields, because the two
 * kinds genuinely take different input. A boolean habit has no target to set, no unit
 * to record and no aggregation to choose — its target is 1 by definition and 'sum'
 * would let a repeat log accumulate to "2 of 1 done". Accepting those fields and then
 * quietly overwriting them would mean a client that sets them sees success and gets
 * something else.
 *
 * The same rule is enforced by a check constraint in the schema, so it holds even for
 * a path that never comes through this route.
 */
const CreateHabitBody = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("boolean"),
    name: z.string().trim().min(1).max(120),
  }),
  z.strictObject({
    kind: z.literal("quantity"),
    name: z.string().trim().min(1).max(120),
    // Bounded by DECIMAL(10,2) in the schema; rejecting here gives a 400 with a
    // reason instead of a driver error.
    targetValue: z.number().positive().max(99_999_999),
    unit: z.string().max(20).default(""),
    aggregation: z.enum(["sum", "last"]),
  }),
]);

type CreateHabitInput = z.infer<typeof CreateHabitBody>;

export const habitsRouter = Router();

habitsRouter.get("/habits", async (req, res) => {
  const user = requireUser(req);
  res.json({ habits: await listActiveHabits(user.id) });
});

const createHabit: RequestHandler<unknown, unknown, CreateHabitInput> = async (req, res) => {
  const user = requireUser(req);
  const input = req.body;

  const habit: Omit<Habit, "id"> =
    input.kind === "boolean"
      ? { name: input.name, kind: "boolean", targetValue: 1, unit: "", aggregation: "last" }
      : {
          name: input.name,
          kind: "quantity",
          targetValue: input.targetValue,
          unit: input.unit,
          aggregation: input.aggregation,
        };

  res.status(201).json({ habit: await insertHabit(user.id, habit) });
};

habitsRouter.post(
  "/habits",
  validate<unknown, CreateHabitInput>({ body: CreateHabitBody }),
  createHabit,
);
