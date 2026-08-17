import { useMutation, useQueryClient } from "@tanstack/react-query";
import { logHabit } from "./api";
import type { Dashboard, DashboardHabit } from "./types";

export const DASHBOARD_KEY = ["dashboard"] as const;

type LogVariables = { habitId: number; value: number | undefined };

/** Applies a reading to the last day cell the same way the server's aggregation rule will. */
function applyOptimistically(habit: DashboardHabit, value: number): DashboardHabit {
  const lastIndex = habit.days.length - 1;

  // Every level returns a new object. Mutating the cached array in place is the bug
  // where the data is right and the screen never updates, because the reference React
  // compares against did not change.
  const days = habit.days.map((day, index) => {
    if (index !== lastIndex) return day;
    const nextValue = habit.aggregation === "sum" ? day.value + value : value;
    return { ...day, value: nextValue, met: nextValue >= habit.targetValue };
  });

  // Only the day cell moves. currentStreak, atRisk and weeklyCompletionRate are left
  // alone deliberately: computing them here would mean a second copy of the streak
  // rules living in the browser, which is the thing this design is trying to avoid.
  // They arrive from the server a moment later.
  return { ...habit, days };
}

function replaceHabit(dashboard: Dashboard, habit: DashboardHabit): Dashboard {
  return {
    ...dashboard,
    habits: dashboard.habits.map((existing) => (existing.id === habit.id ? habit : existing)),
  };
}

export function useLogHabit() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ habitId, value }: LogVariables) => logHabit(habitId, value),

    onMutate: async ({ habitId, value }) => {
      // Without this, a refetch already in flight can land after the optimistic write
      // and put the old value back.
      await queryClient.cancelQueries({ queryKey: DASHBOARD_KEY });

      const previous = queryClient.getQueryData<Dashboard>(DASHBOARD_KEY);

      queryClient.setQueryData<Dashboard>(DASHBOARD_KEY, (current) =>
        current === undefined
          ? current
          : {
              ...current,
              habits: current.habits.map((habit) =>
                habit.id === habitId ? applyOptimistically(habit, value ?? 1) : habit,
              ),
            },
      );

      return { previous };
    },

    onError: (_error, _variables, context) => {
      // Put the cache back exactly as it was. Without this the optimistic value stays
      // on screen and the user believes a failed write succeeded.
      if (context?.previous !== undefined) {
        queryClient.setQueryData(DASHBOARD_KEY, context.previous);
      }
    },

    onSuccess: (result) => {
      // The server's recomputed habit is the authority — it carries the real streak,
      // and under 'sum' the real running total, neither of which the guess above knew.
      queryClient.setQueryData<Dashboard>(DASHBOARD_KEY, (current) =>
        current === undefined ? current : replaceHabit(current, result.habit),
      );
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: DASHBOARD_KEY });
    },
  });
}
