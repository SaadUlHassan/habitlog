/**
 * The only place the frontend touches a date at all, and it does no arithmetic — it
 * turns a server-supplied YYYY-MM-DD into a human label and nothing else.
 *
 * `new Date("2026-08-11")` parses as UTC midnight and then renders in the *browser's*
 * timezone, so for anyone west of UTC the label silently shows the previous day. The
 * fix is to build the instant explicitly and pin the formatter to UTC, so the browser's
 * own timezone cannot move a date the server already decided.
 */
const DAY_LABEL = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

const FULL_DATE = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

function toUtcInstant(localDate: string): Date {
  return new Date(
    Date.UTC(
      Number(localDate.slice(0, 4)),
      Number(localDate.slice(5, 7)) - 1,
      Number(localDate.slice(8, 10)),
    ),
  );
}

export const formatDayLabel = (localDate: string): string => DAY_LABEL.format(toUtcInstant(localDate));

export const formatFullDate = (localDate: string): string => FULL_DATE.format(toUtcInstant(localDate));

/** Trims trailing zeros so 2000.00 reads as 2000 and 7.50 as 7.5. */
export function formatValue(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}
