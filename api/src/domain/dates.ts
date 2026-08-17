const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Every date calculation in the app goes through a UTC anchor. UTC has no DST, so
// adding or subtracting days here can never land on a 23- or 25-hour day and
// silently duplicate or skip a date — which is what happens if you subtract
// 86_400_000ms from a real local instant twice a year.
function toUtcAnchor(localDate: string): Date {
  if (!LOCAL_DATE_PATTERN.test(localDate)) {
    throw new Error(`Expected a YYYY-MM-DD local date, got: ${localDate}`);
  }

  const anchor = new Date(
    Date.UTC(
      Number(localDate.slice(0, 4)),
      Number(localDate.slice(5, 7)) - 1,
      Number(localDate.slice(8, 10)),
    ),
  );

  // Catches dates that parse but do not exist: Date.UTC rolls 2026-02-30 forward
  // into March rather than rejecting it.
  if (fromUtcAnchor(anchor) !== localDate) {
    throw new Error(`Not a real calendar date: ${localDate}`);
  }

  return anchor;
}

// The one sanctioned use of toISOString().slice(0, 10) in the codebase, and only
// because the argument is always built by toUtcAnchor and therefore already UTC.
function fromUtcAnchor(anchor: Date): string {
  return anchor.toISOString().slice(0, 10);
}

/** The calendar date at `instant` for someone in `timeZone`. */
export function localDateFor(instant: Date, timeZone: string): string {
  const formatted = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);

  // en-CA formats as YYYY-MM-DD, but that is a property of the locale data rather
  // than a guarantee of the API: a small-ICU build without en-CA would fall back to
  // another order. Every date in the system flows through here and is parsed
  // downstream, so a fallback has to fail loudly instead of quietly producing
  // 17/08/2026 and letting it spread.
  if (!LOCAL_DATE_PATTERN.test(formatted)) {
    throw new Error(`Expected YYYY-MM-DD from Intl for ${timeZone}, got: ${formatted}`);
  }

  return formatted;
}

export function isValidLocalDate(value: string): boolean {
  try {
    toUtcAnchor(value);
    return true;
  } catch {
    return false;
  }
}

export function addLocalDays(localDate: string, days: number): string {
  const anchor = toUtcAnchor(localDate);
  anchor.setUTCDate(anchor.getUTCDate() + days);
  return fromUtcAnchor(anchor);
}

/** `count` consecutive dates ending at `todayLocal`, oldest first. */
export function priorLocalDates(todayLocal: string, count: number): string[] {
  const dates: string[] = [];
  for (let offset = count - 1; offset >= 0; offset--) {
    dates.push(addLocalDays(todayLocal, -offset));
  }
  return dates;
}
