const BASE_URL = "https://api.calendly.com";

export class CalendlyApiError extends Error {
  constructor(
    public status: number,
    public detail: string
  ) {
    super(`Calendly API error ${status}: ${detail}`);
  }
}

function requireToken(): string {
  const token = process.env.CALENDLY_ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      "CALENDLY_ACCESS_TOKEN is not set. Add it to your environment (see .env)."
    );
  }
  return token;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = requireToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { message?: string; title?: string };
      detail = body.message ?? body.title ?? res.statusText;
    } catch {
      // ignore parse errors
    }
    throw new CalendlyApiError(res.status, detail);
  }

  return (await res.json()) as T;
}

const get = <T>(path: string, params?: Record<string, string>) => {
  const search = params ? "?" + new URLSearchParams(params).toString() : "";
  return request<T>(`${path}${search}`);
};

const post = (path: string, body: unknown) =>
  request<unknown>(path, { method: "POST", body: JSON.stringify(body) });

interface CalendlyUser {
  uri: string;
  name: string;
  email: string;
  timezone: string;
}

interface EventType {
  uri: string;
  uuid: string;
  name: string;
  active: boolean;
  duration: number;
  scheduling_url: string;
}

interface AvailableTime {
  start_time: string;
  end_time: string;
}

interface ScheduledEvent {
  uri: string;
  uuid: string;
  name: string;
  status: string;
  start_time: string;
  end_time: string;
}

async function getCurrentUser(): Promise<CalendlyUser> {
  const res = await get<{ resource: CalendlyUser }>("/users/me");
  return res.resource;
}

async function listEventTypes(): Promise<EventType[]> {
  const user = await getCurrentUser();
  const res = await get<{ collection: EventType[] }>("/event_types", {
    user: user.uri,
    count: "100",
  });
  return res.collection;
}

async function findEventType(ref: string): Promise<EventType> {
  const types = await listEventTypes();
  const found = types.find(
    (t) => t.name === ref || t.uuid === ref || t.scheduling_url === ref
  );
  if (!found) {
    throw new CalendlyApiError(
      400,
      `Event type "${ref}" not found. Available: ${types
        .map((t) => t.name)
        .join(", ")}`
    );
  }
  return found;
}

function formatInZone(iso: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function extractUuid(ref: string): string | null {
  const match =
    ref.match(/scheduled_events\/([0-9a-fA-F-]{36})/) ??
    ref.match(/^([0-9a-fA-F-]{36})$/);
  return match ? match[1] : null;
}

export interface CalendlyActionResult {
  [key: string]: unknown;
}

export async function runCalendly(args: Record<string, unknown>): Promise<CalendlyActionResult> {
  const action = String(args.action ?? "").trim();
  const timezone = process.env.ASSISTANT_TIMEZONE ?? "America/New_York";
  const daysFromNow = Number(args.days_from_now ?? 7);

  switch (action) {
    case "get_me": {
      const user = await getCurrentUser();
      return {
        name: user.name,
        email: user.email,
        timezone: user.timezone,
      };
    }

    case "list_event_types": {
      const types = await listEventTypes();
      return {
        event_types: types.map((t) => ({
          name: t.name,
          duration_minutes: t.duration,
          scheduling_url: t.scheduling_url,
          active: t.active,
        })),
      };
    }

    case "check_availability": {
      const eventType = await findEventType(String(args.event_type));
      const start = new Date();
      // Calendly rejects a non-future start_time ("start_time must be in the
      // future"), so start from a short buffer ahead of now.
      start.setMinutes(start.getMinutes() + 15);
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + daysFromNow);

      const res = await get<{ collection: AvailableTime[] }>(
        "/event_type_available_times",
        {
          event_type: eventType.uri,
          start_time: start.toISOString(),
          end_time: end.toISOString(),
        }
      );

      return {
        event_type: eventType.name,
        timezone,
        slots: res.collection.map((s) => ({
          start: s.start_time,
          end: s.end_time,
          start_local: formatInZone(s.start_time, timezone),
        })),
      };
    }

    case "list_scheduled_events": {
      const user = await getCurrentUser();
      const start = new Date();
      const end = new Date();
      end.setUTCDate(end.getUTCDate() + daysFromNow);

      const res = await get<{ collection: ScheduledEvent[] }>(
        "/scheduled_events",
        {
          user: user.uri,
          status: "active",
          min_start_time: start.toISOString(),
          max_start_time: end.toISOString(),
          count: "100",
        }
      );

      return {
        events: res.collection.map((e) => ({
          uuid: e.uuid,
          name: e.name,
          status: e.status,
          start: e.start_time,
          end: e.end_time,
        })),
      };
    }

    case "book_meeting": {
      const eventType = await findEventType(String(args.event_type));
      const startTime = String(args.start_time ?? "");
      const inviteeName = String(args.invitee_name ?? "");
      const inviteeEmail = String(args.invitee_email ?? "");

      if (!startTime) return { error: "`start_time` is required to book." };
      if (!inviteeName) return { error: "`invitee_name` is required to book." };
      if (!inviteeEmail) return { error: "`invitee_email` is required to book." };

      const body: Record<string, unknown> = {
        event_type: eventType.uri,
        start_time: startTime,
        invitee: {
          name: inviteeName,
          email: inviteeEmail,
        },
      };
      if (args.invitee_timezone) {
        (body.invitee as Record<string, unknown>).timezone = String(
          args.invitee_timezone
        );
      }
      if (args.location_kind) {
        body.location = { kind: String(args.location_kind) };
      }

      const result = await post("/invitees", body);
      return {
        booked: true,
        event_type: eventType.name,
        start_time: startTime,
        result,
      };
    }

    case "cancel_meeting": {
      const ref = String(args.scheduled_event ?? "");
      if (!ref) return { error: "`scheduled_event` is required to cancel." };
      const uuid = extractUuid(ref);
      if (!uuid) {
        return {
          error:
            "Could not extract a scheduled event uuid. Pass the uuid or its api.calendly.com URL.",
        };
      }
      const body: Record<string, unknown> = {};
      if (args.reason) body.reason = String(args.reason);
      await post(`/scheduled_events/${uuid}/cancellation`, body);
      return { cancelled: true, uuid };
    }

    default:
      return {
        error: `Unknown action "${action}".`,
        valid_actions: [
          "get_me",
          "list_event_types",
          "check_availability",
          "list_scheduled_events",
          "book_meeting",
          "cancel_meeting",
        ],
      };
  }
}
