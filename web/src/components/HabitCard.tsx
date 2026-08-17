import { useState } from "react";
import { ApiError } from "../api";
import { formatDayLabel, formatValue } from "../format";
import type { DashboardHabit, DayCell } from "../types";
import { useLogHabit } from "../useLogHabit";

function dayTitle(day: DayCell, habit: DashboardHabit): string {
  const label = formatDayLabel(day.date);

  if (habit.kind === "boolean") {
    return `${label} — ${day.met ? "done" : "not done"}`;
  }

  const unit = habit.unit === "" ? "" : ` ${habit.unit}`;
  return `${label} — ${formatValue(day.value)} of ${formatValue(habit.targetValue)}${unit}`;
}

function streakLabel(habit: DashboardHabit): string {
  if (habit.currentStreak === 0) return "No streak yet";
  const days = habit.currentStreak === 1 ? "day" : "days";
  return `${habit.currentStreak} ${days}`;
}

export function HabitCard({ habit }: { habit: DashboardHabit }) {
  const mutation = useLogHabit();

  // Quantity habits need a reading; the target is the obvious starting point. Boolean
  // habits are logged with no value at all.
  const [reading, setReading] = useState(() => String(habit.targetValue));

  const today = habit.days[habit.days.length - 1];
  const parsedReading = Number(reading);
  const readingIsValid = habit.kind === "boolean" || (Number.isFinite(parsedReading) && parsedReading > 0);

  const submit = () => {
    mutation.mutate({
      habitId: habit.id,
      value: habit.kind === "boolean" ? undefined : parsedReading,
    });
  };

  return (
    <article className="card">
      <header className="card__header">
        <h2 className="card__name">{habit.name}</h2>
        <p className={`card__streak${habit.atRisk ? " card__streak--at-risk" : ""}`}>
          <span aria-hidden="true">{habit.currentStreak === 0 ? "○" : "▲"}</span>{" "}
          {streakLabel(habit)}
          {habit.atRisk && <span className="card__at-risk"> · keep it alive today</span>}
        </p>
      </header>

      <ol className="week" aria-label={`Last 7 days of ${habit.name}`}>
        {/* Oldest to newest, exactly as the server ordered them. The dates are the
            server's own strings; the client never works out what day it is. */}
        {habit.days.map((day) => (
          <li
            key={day.date}
            className={`week__day${day.met ? " week__day--met" : ""}`}
            title={dayTitle(day, habit)}
          >
            <span className="visually-hidden">{dayTitle(day, habit)}</span>
          </li>
        ))}
      </ol>

      <p className="card__weekly">
        {habit.weeklyCompletionRate}% this week
        {habit.kind === "quantity" && today !== undefined && (
          <span className="card__today">
            {" · today "}
            {formatValue(today.value)} of {formatValue(habit.targetValue)}
            {habit.unit === "" ? "" : ` ${habit.unit}`}
          </span>
        )}
      </p>

      <div className="card__actions">
        {habit.kind === "quantity" && (
          <>
            <label className="visually-hidden" htmlFor={`reading-${habit.id}`}>
              {`${habit.name} amount${habit.unit === "" ? "" : ` in ${habit.unit}`}`}
            </label>
            <input
              id={`reading-${habit.id}`}
              className="card__reading"
              type="number"
              min="0"
              step="any"
              value={reading}
              onChange={(event) => setReading(event.target.value)}
            />
          </>
        )}
        <button
          type="button"
          className="card__log"
          onClick={submit}
          // Disabled while in flight so a double tap cannot send two readings. The
          // server would survive it — one row either way — but under 'sum' the second
          // press would add again, which is not what a double tap meant.
          disabled={mutation.isPending || !readingIsValid}
        >
          {mutation.isPending ? "Saving…" : habit.kind === "boolean" ? "Log today" : "Log"}
        </button>
      </div>

      {mutation.isError && (
        <p className="card__error" role="alert">
          {mutation.error instanceof ApiError
            ? mutation.error.message
            : "Could not save that. Check your connection and try again."}
          {mutation.error instanceof ApiError && mutation.error.requestId !== undefined && (
            <span className="card__request-id"> ({mutation.error.requestId.slice(0, 8)})</span>
          )}
        </p>
      )}
    </article>
  );
}
