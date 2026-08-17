import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { truncateAllTables } from "../data/reset.js";
import { pool } from "../db.js";
import { localDateFor, priorLocalDates } from "../domain/dates.js";

// Why this is a script and not db/002_seed.sql: log dates have to be generated
// relative to *each user's* local today, and doing that in SQL would mean either
// CONVERT_TZ (the official MySQL image ships without the named timezone tables, so
// it returns NULL) or hardcoded UTC offsets (wrong half the year anywhere with DST).
// Running it in Node lets the seed call the same localDateFor the API uses, so there
// is one definition of "local date" in the project rather than two that can drift.

const SEED_WINDOW_DAYS = 30;

type SeedHabit = {
  name: string;
  kind: "boolean" | "quantity";
  targetValue: number;
  unit: string;
  aggregation: "sum" | "last";
  /**
   * The day's total `offset` days before the user's local today, or null for no log.
   * This is the already-aggregated daily value, which is what the table holds: the
   * unique key means one row per habit per day, so `sum` habits are summed on write.
   */
  valueFor: (offset: number) => number | null;
};

type SeedUser = {
  email: string;
  displayName: string;
  timezone: string;
  habits: SeedHabit[];
};

// Patterns are deterministic rather than random so every streak on the dashboard has
// an explainable value, and so a reset produces the same demo twice.
const SEED_USERS: SeedUser[] = [
  {
    email: "aria@example.com",
    displayName: "Aria Tan",
    timezone: "Asia/Singapore",
    habits: [
      {
        // Unbroken run of 6 days ending today, with older gaps behind it.
        name: "Morning run",
        kind: "boolean",
        targetValue: 1,
        unit: "",
        aggregation: "last",
        valueFor: (offset) => (offset === 6 || offset === 13 ? null : 1),
      },
      {
        // Nothing logged today yet: an 8 day streak that is still alive but at risk.
        name: "Drink water",
        kind: "quantity",
        targetValue: 2000,
        unit: "ml",
        aggregation: "sum",
        valueFor: (offset) => {
          if (offset === 0) return null;
          if (offset === 9) return 1250;
          if (offset > 20) return null;
          return 2000 + (offset % 3) * 250;
        },
      },
      {
        // Logged today but under target, which is not the same as not logged: proves
        // a below-target reading does not count towards the streak.
        name: "Sleep",
        kind: "quantity",
        targetValue: 7,
        unit: "hours",
        aggregation: "last",
        valueFor: (offset) => {
          if (offset === 0) return 6.5;
          if (offset === 1) return 7;
          if (offset % 5 === 0) return 6;
          return 7.5;
        },
      },
      {
        // Sits exactly on target today and one unit under it yesterday, so the >=
        // boundary is visible in the running app and not only in a unit test.
        name: "Read",
        kind: "quantity",
        targetValue: 30,
        unit: "minutes",
        aggregation: "sum",
        valueFor: (offset) => {
          if (offset === 0) return 30;
          if (offset === 1) return 29;
          if (offset > 14) return null;
          return 45;
        },
      },
      {
        // Deliberately never logged, so the "no history yet" card has something to render.
        name: "Stretch",
        kind: "boolean",
        targetValue: 1,
        unit: "",
        aggregation: "last",
        valueFor: () => null,
      },
    ],
  },
  {
    // Exists specifically to demonstrate the timezone handling: for part of every
    // day this user's local date differs from the other user's.
    email: "miles@example.com",
    displayName: "Miles Okafor",
    timezone: "America/New_York",
    habits: [
      {
        name: "Meditate",
        kind: "boolean",
        targetValue: 1,
        unit: "",
        aggregation: "last",
        valueFor: (offset) => (offset === 12 ? null : 1),
      },
      {
        name: "Drink water",
        kind: "quantity",
        targetValue: 2500,
        unit: "ml",
        aggregation: "sum",
        valueFor: (offset) => (offset !== 0 && offset % 7 === 0 ? 1500 : 2600),
      },
      {
        name: "Sleep",
        kind: "quantity",
        targetValue: 7.5,
        unit: "hours",
        aggregation: "last",
        valueFor: (offset) => {
          if (offset === 0) return null;
          return offset % 4 === 0 ? 6.5 : 8;
        },
      },
      {
        // Neither today nor yesterday reaches target, so this one shows a streak of
        // zero rather than every card looking like a success.
        name: "Steps",
        kind: "quantity",
        targetValue: 8000,
        unit: "steps",
        aggregation: "sum",
        valueFor: (offset) => (offset > 20 ? null : 7000 + (offset % 5) * 600),
      },
    ],
  },
];

async function isAlreadySeeded(connection: PoolConnection): Promise<boolean> {
  const [rows] = await connection.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS user_count FROM users",
  );
  return Number(rows[0]?.user_count ?? 0) > 0;
}

async function seed(connection: PoolConnection): Promise<void> {
  const now = new Date();
  const logRows: Array<[number, number, number, string]> = [];

  for (const user of SEED_USERS) {
    const [userResult] = await connection.query<ResultSetHeader>(
      "INSERT INTO users (email, display_name, timezone) VALUES (?, ?, ?)",
      [user.email, user.displayName, user.timezone],
    );
    const userId = userResult.insertId;

    const todayLocal = localDateFor(now, user.timezone);
    const dates = priorLocalDates(todayLocal, SEED_WINDOW_DAYS);

    console.log(`\n${user.displayName} (${user.timezone}) — local today is ${todayLocal}`);

    for (const habit of user.habits) {
      const [habitResult] = await connection.query<ResultSetHeader>(
        `INSERT INTO habits (user_id, name, kind, target_value, unit, aggregation)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [userId, habit.name, habit.kind, habit.targetValue, habit.unit, habit.aggregation],
      );
      const habitId = habitResult.insertId;

      let logged = 0;
      let metInLastSeven = 0;

      dates.forEach((date, index) => {
        const offset = dates.length - 1 - index;
        const value = habit.valueFor(offset);
        if (value === null) return;

        logRows.push([habitId, userId, value, date]);
        logged += 1;
        if (offset < 7 && value >= habit.targetValue) metInLastSeven += 1;
      });

      const target = `${habit.targetValue}${habit.unit ? ` ${habit.unit}` : ""}`;
      console.log(
        `  ${habit.name.padEnd(12)} ${habit.aggregation.padEnd(4)} target ${target.padEnd(12)}` +
          `${String(logged).padStart(2)} logs, ${metInLastSeven}/7 met`,
      );
    }
  }

  if (logRows.length > 0) {
    // Bulk `VALUES ?` expansion is a mysql2 query() feature. execute() uses prepared
    // statements, which do not expand arrays — the same trap as `IN (?)`.
    //
    // logged_at is left to its column default: it records when the row was written,
    // which for seed data is genuinely now. local_date is the field carrying meaning
    // here, and inventing a plausible historical instant per row would be false
    // precision.
    await connection.query("INSERT INTO habit_logs (habit_id, user_id, value, local_date) VALUES ?", [
      logRows,
    ]);
  }

  console.log(`\nInserted ${logRows.length} habit logs.`);
}

async function main(): Promise<void> {
  const force = process.argv.includes("--force");
  const connection = await pool.getConnection();

  try {
    if (await isAlreadySeeded(connection)) {
      if (!force) {
        console.log("Database already seeded — skipping. Use --force to reseed.");
        return;
      }
      console.log("Reseeding (--force).");
    }

    // TRUNCATE commits implicitly in MySQL, so it cannot take part in a transaction
    // and runs on its own first.
    await truncateAllTables(connection);

    // The logs go in as one bulk insert after every habit is written, so a failure
    // there would otherwise leave users and habits committed — and the next plain
    // run would see rows, report "already seeded", and skip, leaving a half-seeded
    // database that looks fine until a dashboard comes back empty.
    await connection.beginTransaction();
    try {
      await seed(connection);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  } finally {
    connection.release();
    await pool.end();
  }
}

// The pool is closed in main's finally, on both the success and failure paths.
main().catch((error: unknown) => {
  console.error("Seed failed:", error);
  process.exitCode = 1;
});
