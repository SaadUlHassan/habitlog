import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ApiError, fetchDashboard } from "../api";
import { DASHBOARD_KEY } from "../useLogHabit";
import { HabitCard } from "./HabitCard";
import { SearchInput } from "./SearchInput";

export function Dashboard() {
  // No useEffect anywhere in this app. TanStack Query owns the fetch, its cancellation
  // and its lifecycle, which removes the missing-dependency-array class of bug rather
  // than asking everyone to remember the array.
  const { data, isPending, isError, error, refetch, isFetching } = useQuery({
    queryKey: DASHBOARD_KEY,
    queryFn: fetchDashboard,
  });

  const [search, setSearch] = useState("");

  // Derived, not stored. Keeping a `filtered` state in sync with an effect is how the
  // list ends up one keystroke behind, or empty until the first keystroke.
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    const habits = data?.habits ?? [];
    return term === "" ? habits : habits.filter((habit) => habit.name.toLowerCase().includes(term));
  }, [data, search]);

  if (isPending) {
    return <p className="state">Loading your habits…</p>;
  }

  if (isError) {
    return (
      <div className="state state--error" role="alert">
        <p>
          {error instanceof ApiError ? error.message : "Could not reach the server."}
          {error instanceof ApiError && error.requestId !== undefined && (
            <span className="state__request-id"> ({error.requestId.slice(0, 8)})</span>
          )}
        </p>
        <button type="button" onClick={() => void refetch()}>
          Try again
        </button>
      </div>
    );
  }

  if (data.habits.length === 0) {
    return (
      <div className="state">
        <p>No habits yet.</p>
        <p className="state__hint">
          Create one with <code>POST /api/habits</code> and it will appear here.
        </p>
      </div>
    );
  }

  return (
    <>
      <SearchInput value={search} onChange={setSearch} resultCount={visible.length} />

      {visible.length === 0 ? (
        <p className="state">No habits match “{search.trim()}”.</p>
      ) : (
        <ul className="habits" aria-busy={isFetching}>
          {visible.map((habit) => (
            // Keyed by id, never by index: with a filtered list the index of a given
            // habit changes as you type, and React would reuse the wrong card's state.
            <li key={habit.id}>
              <HabitCard habit={habit} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
