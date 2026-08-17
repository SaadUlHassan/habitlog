import type { CurrentUser, Dashboard, LogResult } from "./types";

// The seeded developer token. Real auth would put a session cookie or a bearer token
// here instead; nothing else in the client would change, because the server never
// learns who the caller is from anything the client sends in a body or query string.
// `dev-user-2` is the New York user, useful for seeing the timezone handling.
const DEV_TOKEN = "dev-user-1";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | undefined;

  constructor(status: number, code: string, message: string, requestId: string | undefined) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    // Carried so a user reporting a problem can quote the same id that appears in the
    // server's logs.
    this.requestId = requestId;
  }
}

function readString(source: object, key: string): string | undefined {
  if (!(key in source)) return undefined;
  const value: unknown = Reflect.get(source, key);
  return typeof value === "string" ? value : undefined;
}

/** Pulls { code, message, requestId } out of the server's error envelope, if it is one. */
function readErrorEnvelope(payload: unknown): {
  code: string;
  message: string;
  requestId: string | undefined;
} {
  if (typeof payload === "object" && payload !== null && "error" in payload) {
    const envelope: unknown = payload.error;
    if (typeof envelope === "object" && envelope !== null) {
      return {
        code: readString(envelope, "code") ?? "UNKNOWN",
        message: readString(envelope, "message") ?? "The request failed.",
        requestId: readString(envelope, "requestId"),
      };
    }
  }

  return { code: "UNKNOWN", message: "The request failed.", requestId: undefined };
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${DEV_TOKEN}`,
      ...init?.headers,
    },
  });

  // fetch only rejects on a network failure; a 404 or a 500 resolves perfectly happily.
  // Every call goes through here so that no caller has to remember it.
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const { code, message, requestId } = readErrorEnvelope(payload);
    throw new ApiError(response.status, code, message, requestId);
  }

  // The one unchecked boundary in the client: the response is trusted to match its
  // declared type. Validating it would mean a schema library in the browser too, which
  // is worth it when the API is someone else's and overkill when it is this one.
  const payload: unknown = await response.json();
  return payload as T;
}

export const fetchCurrentUser = (): Promise<CurrentUser> => apiFetch<CurrentUser>("/me");

export const fetchDashboard = (): Promise<Dashboard> => apiFetch<Dashboard>("/dashboard");

export function logHabit(habitId: number, value: number | undefined): Promise<LogResult> {
  return apiFetch<LogResult>(`/habits/${habitId}/logs`, {
    method: "POST",
    // A boolean habit is logged with no value at all; sending one is a 400 rather than
    // being quietly ignored.
    body: JSON.stringify(value === undefined ? {} : { value }),
  });
}
