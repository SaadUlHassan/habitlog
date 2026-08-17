# Code review: habit dashboard API and component

Reviewed `server.ts` and `HabitDashboard.tsx`.

## Summary

The shape of this is fine. Two endpoints, a component that consumes them, and the
separation between them is sensible. The problems are concentrated rather than spread
out, which is good news for fixing them.

I can't approve this in its current state. Three things need to happen before anything
else is worth discussing:

1. **There is no authentication.** `userId` arrives from the query string and the request
   body, so any caller can read or write any user's health data by changing a number.
2. **Every query is built by string interpolation**, so the same parameter is also an
   injection point.
3. **Neither endpoint currently works.** `/api/dashboard` always returns an empty array,
   and the component fetches in an infinite loop.

Point 3 is worth pausing on. Two of the bugs below are total functional failures, not
edge cases, which suggests this hasn't been run end to end yet. That's an easy thing to
fix in the process, and it would have caught several items here for free.

Below: blocking issues, then things I'd want fixed before this ships, then smaller
points. Happy to pair on any of it.

---

## Blocking

### 1. No authentication or authorisation

`server.ts`, both endpoints:

```ts
const userId = req.query.userId as string;          // GET
const { userId, habitId, value, email } = req.body; // POST
```

The client tells the server who it is. `GET /api/dashboard?userId=2` returns another
user's habits. `POST /api/logs` with someone else's `userId` writes to their account.
This is not a bug in the implementation, it is what the code is designed to do, which is
why it needs to be settled first.

For a health product this is the most serious item on the list. It is a complete
horizontal privilege escalation over medical data, and under GDPR or PDPA a breach here
is reportable.

**Fix.** Identity comes from a session or a verified token, resolved server side, and is
never read from a query string or a body. Put it in one piece of middleware that
attaches `req.user`, and have every handler read from there. Then add an ownership check
on the habit itself: even with a correct `req.user`, `habitId` is still taken at face
value, so you could log against a habit belonging to someone else. Scope the lookup by
user (`WHERE id = ? AND user_id = ?`) and return 404, not 403, when it misses. A 403
confirms the habit exists.

### 2. SQL injection in all four queries

```ts
`SELECT * FROM habits WHERE user_id = ${userId}`
`SELECT * FROM habit_logs WHERE habit_id = ${habit.id} AND log_date > ...`
`SELECT id FROM habit_logs WHERE user_id = ${userId} AND habit_id = ${habitId} ...`
`INSERT INTO habit_logs (...) VALUES (${userId}, ${habitId}, '${value}', CURDATE())`
```

`userId` and `value` both come straight from the client. `?userId=1 OR 1=1` returns every
habit in the table. A `UNION SELECT` returns anything else the DB user can read, and as
covered below the DB user is `root`.

Worth being precise about the blast radius: mysql2 disables multiple statements by
default, so `; DROP TABLE` will not run. That is the only reason this is data exfiltration
rather than data destruction, and it is not a control anyone chose.

**Fix.** Placeholders everywhere, no exceptions:

```ts
const [habits] = await db.query<RowDataPacket[]>(
  "SELECT id, name, target FROM habits WHERE user_id = ?",
  [userId],
);
```

Worth a lint rule banning template literals in query position, because this is the kind
of thing that comes back.

### 3. Production credentials committed to source

```ts
const db = mysql.createPool({
  host: "prod-db.internal",
  user: "root",
  password: "Passw0rd123!",
  database: "healthapp",
});
```

Three separate problems. The credential is in git history, so removing it in a later
commit does not remove it. Every developer running this locally connects to production.
And the account is `root`, so the injection above has unlimited reach.

**Fix.** Config from the environment, validated at boot so a missing variable fails
immediately rather than at the first query. `.env` gitignored, `.env.example` committed.
A least-privilege application user with `SELECT`, `INSERT`, `UPDATE` on the three tables
it needs and nothing else.

**This one needs action beyond the PR.** Rotate that password now, and check the access
logs for `prod-db.internal`. Treat it as exposed regardless of who has seen the branch.

### 4. `/api/dashboard` always returns an empty array

```ts
const result: any[] = [];
habits.forEach(async (habit: any) => {
  const [logs]: any = await db.query(...);
  result.push({ ...habit, logs });
});
res.json(result);
```

`forEach` does not await its callback. Each callback suspends at the first `await` and
returns a promise that `forEach` discards, so `res.json(result)` runs while `result` is
still `[]`. Every dashboard request returns `[]` regardless of the data.

**Fix.** This should be one query rather than one per habit anyway (see item 8), but the
mechanical fix is `Promise.all`:

```ts
const result = await Promise.all(
  habits.map(async (habit) => ({ ...habit, logs: await fetchLogs(habit.id) })),
);
```

`forEach` with an async callback is almost always a mistake. Worth an ESLint rule
(`no-misused-promises`) so it can't recur.

### 5. The component fetches in an infinite loop

```tsx
useEffect(() => {
  fetch(`/api/dashboard?userId=${userId}`)
    .then((res) => res.json())
    .then((data) => setHabits(data));
});
```

No dependency array, so the effect runs after every render. It calls `setHabits`, which
causes a render, which runs the effect again. This does not settle: it is a continuous
request loop for as long as the tab is open, and it will saturate the API from a single
user.

**Fix.** The minimum is `}, [userId]);`. What I'd actually suggest is moving to a data
fetching library (TanStack Query or SWR) so that caching, cancellation and the loading
and error states in item 15 all come from one place. It also removes this entire class of
bug rather than fixing this instance of it.

### 6. Email and health readings written to logs

```ts
console.log(`User ${email} logged habit ${habitId}: ${value}`);
```

A direct identifier and a health measurement, in plaintext, into stdout. Logs are
typically retained for months, aggregated somewhere with much broader access than the
database, and shipped to a third party. This turns a log pipeline into a system of record
for medical data, which is exactly what data protection rules are about.

It is also why `email` is being passed in the request body at all, which is the only
reason the client is sending it.

**Fix.** Structured logger, log `userId` and never `email` or `value`, with a redaction
list configured on the logger rather than trusted to each call site. Drop `email` from
the request body entirely.

---

## Should fix before this ships

### 7. The write is not awaited, and the duplicate check races

```ts
const [existing]: any = await db.query(`SELECT id FROM habit_logs WHERE ...`);
if (existing.length === 0) {
  db.query(`INSERT INTO habit_logs ...`);   // not awaited
  res.json({ success: true });
}
```

Two problems in four lines.

The `INSERT` is not awaited, so the response says `success: true` before the write is
confirmed. If it fails, the client is told it worked and nothing surfaces anywhere.

The check-then-insert is also a classic race. Two requests arriving together both see
zero rows and both insert, so a double tap on a slow connection produces two rows for one
day. Nothing in the schema appears to stop it.

**Fix.** Put a `UNIQUE (habit_id, log_date)` constraint on the table and let the database
settle it, then the whole thing is one atomic statement with no window to race through:

```sql
INSERT INTO habit_logs (habit_id, user_id, value, log_date)
VALUES (?, ?, ?, ?) AS incoming
ON DUPLICATE KEY UPDATE value = incoming.value;
```

Note `AS incoming` rather than `VALUES(value)`, which is deprecated as of MySQL 8.0.20.

### 8. N+1 queries on the dashboard

One query for habits, then one per habit for logs. Twenty habits is twenty one round
trips, and it grows linearly with the most engaged users, which is backwards.

**Fix.** Two queries total. Fetch the habits, then all their logs in one pass, and group
in memory:

```ts
const [logs] = await db.query(
  "SELECT habit_id, log_date, value FROM habit_logs WHERE habit_id IN (?) AND log_date >= ?",
  [habitIds, since],
);
```

Two things to watch. `IN (?)` array expansion works with `pool.query` but not
`pool.execute`, which uses prepared statements and will not expand an array. And
short-circuit when the user has no habits, because `IN ()` is a syntax error.

### 9. The day boundary is wrong, in three different ways

This is the one I'd most want to talk through, because the pieces disagree with each
other and the result is quietly wrong rather than visibly broken.

**Backend.** `CURDATE()` and `NOW()` are the database server's timezone. A user in
Singapore logging at 07:00 local is 23:00 UTC the previous day, so their log is filed
against yesterday. Their streak breaks for a day they completed.

**Frontend.** `completionRate` builds its day strings by mixing local and UTC:

```ts
const d = new Date();
d.setDate(d.getDate() - i);        // local time
days.push(d.toISOString().slice(0, 10));  // converted to UTC
```

`setDate` works in local time, `toISOString` converts to UTC, so for anyone east of UTC
before their local morning the string is the previous day.

**The two do not meet.** I ran this against a real MySQL to be sure. With a `DATE` column
holding `2026-08-17`, mysql2 hydrates it into a JS `Date` at the *Node process's*
timezone, and `res.json` then serialises that:

| API server timezone | what the client receives | `startsWith("2026-08-17")` |
| --- | --- | --- |
| `Asia/Singapore` | `2026-08-16T16:00:00.000Z` | **false** |
| `UTC` | `2026-08-17T00:00:00.000Z` | true |

So `completionRate` silently under-counts, and whether it does depends on the timezone of
the machine the API happens to be deployed on. That is the worst kind of bug: it passes
locally, it passes in CI, and it is wrong in one region.

**Fix.** Pick one definition of "day" and make it server side. Store the user's IANA
timezone, derive the local date from the log instant using `Intl`, and persist it as a
`DATE` column alongside the UTC `TIMESTAMP`. They answer different questions and neither
can be derived from the other later, because timezones change. Then set
`dateStrings: ['DATE']` on the pool so a calendar date stays a string and is never
re-interpreted as an instant, and have the client render the dates the server sends
without doing any date arithmetic of its own.

Related: `log_date > DATE_SUB(NOW(), INTERVAL 7 DAY)` is a rolling 168 hour window, not
the last seven calendar days, so it disagrees with the frontend's seven day array as
well.

### 10. The optimistic update mutates state, so the UI does not update

```tsx
const updated = habits;                              // same reference
updated.find((h) => h.id === habitId)!.logs.push(...); // mutates in place
setHabits(updated);                                   // same reference again
```

`const updated = habits` copies a reference, not the array. The `push` mutates the object
React is already holding, and `setHabits` is then called with a reference it compares
equal to the current state, so it bails out and does not re-render. The data changes and
the screen does not.

The `!` is a second problem. If the habit isn't found, this throws and takes the whole
component down.

**Fix.** Build new objects at every level you change:

```tsx
setHabits((current) =>
  current.map((habit) =>
    habit.id === habitId ? { ...habit, logs: [...habit.logs, newLog] } : habit,
  ),
);
```

### 11. The POST is fire and forget

```tsx
fetch("/api/logs", { method: "POST", ... });
```

Not awaited, `res.ok` never checked, no rollback and nothing shown to the user. A failed
log looks identical to a successful one, permanently, and since the optimistic update
above never renders anyway, the user gets no feedback either way.

**Fix.** Await it, check `res.ok` (`fetch` only rejects on network failure, a 500 resolves
happily), and roll the optimistic state back on failure with a visible error. A mutation
hook with `onMutate` and `onError` gives you this shape for free if you adopt the library
from item 5.

### 12. Stack traces returned to the client

```ts
app.use((err: any, req: any, res: any, next: any) => {
  res.status(500).json({ error: err.stack });
});
```

A stack trace tells an attacker your file paths, your dependency versions and your
internal structure. Every failure also becomes a 500, so a validation error and a database
outage are indistinguishable to the client.

Worth noting this handler catches less than it looks like it does. In Express 4 a rejected
promise from an async handler never reaches it, so the failures above hang the request
until the client times out. Express 5 propagates them natively.

**Fix.** Log the full error server side, return `{ code, message, requestId }` and nothing
else. Generate the `requestId` per request and return it in a header too, so a user
reporting a problem can quote something you can search for.

### 13. Derived state stored in state

```tsx
const [filtered, setFiltered] = useState<Habit[]>([]);
useEffect(() => {
  setFiltered(habits.filter((h) => h.name.includes(search)));
}, [search]);
```

The dependency array lists `search` but the effect reads `habits`, so it holds a stale
closure. On first load `habits` is `[]` when this runs, so the list renders empty until
the user types something, and it never picks up habits arriving later.

`filtered` is not state, it is a function of `habits` and `search`. Storing it creates the
synchronisation problem and the effect is an attempt to solve a problem that did not need
to exist.

**Fix.**

```tsx
const filtered = useMemo(
  () => habits.filter((h) => h.name.toLowerCase().includes(search.toLowerCase())),
  [habits, search],
);
```

That also fixes the case sensitivity: today, typing "water" does not match "Water".

---

## Worth fixing

**14. `key={index}` on a filtered list.** Filtering changes which habit sits at each index,
so React reuses the wrong element and any state inside a row attaches to the wrong habit.
Use `key={habit.id}`.

**15. No loading, error or empty states.** The user sees a blank screen while loading,
and the same blank screen forever if the request fails. "No habits yet" and "we could not
reach the server" are different messages and both need to exist.

**16. `completionRate` ignores `target`.** The interface declares `target: number` and the
calculation never reads it, so any log at all counts the day as complete. A 200ml entry
against a 2000ml goal reads as done. Relatedly the client sends `value: "done"` for what
the type says is numeric, and the backend inserts that string into a numeric column, which
either errors in strict mode or silently stores 0.

Worth stepping back here: the three habits in this product are not one shape. Done or not
done, a daily total, and a nightly reading that a later reading corrects are three
different things, and flattening them into "did you log something" is what produces the
mismatch. A `kind` and an aggregation rule on the habit would make this explicit.

**17. No input validation.** Nothing checks that `habitId` is a number, that `value` is in
range, or that the body has the shape the handler assumes. A schema per route (zod, joi)
that rejects unknown keys as well as bad ones, returning 400 with the offending fields.
Rejecting unknown keys matters here specifically: it is what stops a client sending
`userId` at all.

**18. Wrong status codes.** `res.json({ success: false, reason: "already logged today" })`
returns HTTP 200 for a failure, so clients cannot use status codes and have to parse
prose. Separately, "already logged today" probably should not be an error at all. A repeat
log is a normal thing for a user to do, and the upsert in item 7 makes it a 200 with the
current state.

**19. `any` throughout.** `const [habits]: any`, `result: any[]`, `(habit: any)`, and all
four parameters of the error handler. This turns off type checking at precisely the
boundary where data is least trustworthy, and it is why the `value: string` and
`target: number` mismatch in item 16 compiled. Declare row types and let the compiler help.

**20. `SELECT *` in both queries.** Couples the API response to the table's columns, so
adding a column silently changes the payload, and it is how internal fields end up on the
wire by accident. List the columns.

---

## Nits

- No `<label>` on the search input. A placeholder disappears as soon as you type and is not
  a reliable substitute for assistive technology or autofill.
- `completionRate` allocates seven `Date` objects per habit per render. Irrelevant at this
  size, but it is inside the render path for no reason.
- `log.log_date.startsWith(day)` compares dates as strings. It happens to work when the
  serialisation cooperates, which item 9 shows it does not always do. Compare dates as
  dates.
- Port 3000 is hardcoded, and there is no graceful shutdown, so a deploy can cut a request
  mid-write.
- The pool has no `connectionLimit` or timeout settings.
- No tests. Given items 4, 5 and 9, a single test that loads the dashboard and asserts it
  returns the habits would have caught two blocking issues.

One thing I want to flag as deliberately **not** a problem: the search filter does not need
debouncing. It runs over an already loaded array, so a debounce would only add latency. It
starts to matter if the list is ever paginated and search moves server side, and at that
point it needs cancellation of superseded requests as well.

---

## One structural suggestion

Most of what is above is one theme in different costumes: the server trusts the client,
and the two sides each compute things the other should own. Identity comes from the
client, the day boundary is calculated in two places that disagree, and completion is
derived in the browser from raw logs.

If the server owned all three, the API would return a habit with its streak, its
completion rate and its seven day window already computed, in the user's own timezone.
The component would render what it is given. That removes the timezone mismatch, the
`target` bug and the duplicated date logic together, and it makes the streak rules
testable in isolation, which is where I'd want the tests to be anyway.

Not asking for that in this PR. But items 1, 9 and 16 all become much smaller once the
boundary is drawn there, so it is worth deciding before fixing them individually.
