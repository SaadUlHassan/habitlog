import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { fetchCurrentUser } from "./api";
import { Dashboard } from "./components/Dashboard";
import { formatFullDate } from "./format";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function Header() {
  const { data } = useQuery({ queryKey: ["me"], queryFn: fetchCurrentUser });

  return (
    <header className="app__header">
      <h1 className="app__title">Habits</h1>
      {data !== undefined && (
        <p className="app__subtitle">
          {data.displayName} · {formatFullDate(data.today)}
          {/* The date and timezone both come from the server. The browser's own clock
              and timezone are never consulted. */}
          <span className="app__zone"> ({data.timezone})</span>
        </p>
      )}
    </header>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <main className="app">
        <Header />
        <Dashboard />
      </main>
    </QueryClientProvider>
  );
}
