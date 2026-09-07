import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { runCalendly, CalendlyApiError } from "./calendly";

const TOKEN = "cal_secret_test_token";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Routes global fetch by URL; `handler` receives the URL + init and returns a Response.
function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init))
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

const currentUser = {
  uri: "https://api.calendly.com/users/U001",
  name: "Jane Doe",
  email: "jane.doe@example.com",
  timezone: "Asia/Kolkata",
};

const eventTypes = [
  {
    uri: "https://api.calendly.com/event_types/ET001",
    uuid: "et-001",
    name: "30 Minute Meeting",
    active: true,
    duration: 30,
    scheduling_url: "https://calendly.com/janedoe/30min",
  },
  {
    uri: "https://api.calendly.com/event_types/ET002",
    uuid: "et-002",
    name: "Coffee Chat",
    active: false,
    duration: 15,
    scheduling_url: "https://calendly.com/janedoe/coffee",
  },
];

const availableTimes = [
  {
    start_time: "2026-09-04T14:00:00.000000Z",
    end_time: "2026-09-04T14:30:00.000000Z",
  },
];

const scheduledEvents = [
  {
    uri: "https://api.calendly.com/scheduled_events/SE001",
    uuid: "se-001",
    name: "30 Minute Meeting",
    status: "active",
    start_time: "2026-09-05T10:00:00.000000Z",
    end_time: "2026-09-05T10:30:00.000000Z",
  },
];

describe("runCalendly", () => {
  beforeEach(() => {
    process.env.CALENDLY_ACCESS_TOKEN = TOKEN;
    process.env.ASSISTANT_TIMEZONE = "America/New_York";
  });

  afterEach(() => {
    delete process.env.CALENDLY_ACCESS_TOKEN;
    delete process.env.ASSISTANT_TIMEZONE;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("throws if the access token is missing", async () => {
    delete process.env.CALENDLY_ACCESS_TOKEN;
    await expect(runCalendly({ action: "get_me" })).rejects.toThrow(
      /CALENDLY_ACCESS_TOKEN is not set/
    );
  });

  it("get_me returns the authenticated user", async () => {
    mockFetch((url) => {
      if (url.endsWith("/users/me")) return jsonResponse({ resource: currentUser });
      return jsonResponse({}, 404);
    });

    const result = await runCalendly({ action: "get_me" });
    expect(result).toEqual({
      name: "Jane Doe",
      email: "jane.doe@example.com",
      timezone: "Asia/Kolkata",
    });
  });

  it("list_event_types maps the collection", async () => {
    mockFetch((url) => {
      if (url.endsWith("/users/me")) return jsonResponse({ resource: currentUser });
      if (url.includes("/event_types")) return jsonResponse({ collection: eventTypes });
      return jsonResponse({}, 404);
    });

    const result = (await runCalendly({ action: "list_event_types" })) as {
      event_types: Array<{
        name: string;
        duration_minutes: number;
        scheduling_url: string;
        active: boolean;
      }>;
    };
    expect(result.event_types).toHaveLength(2);
    expect(result.event_types[0]).toEqual({
      name: "30 Minute Meeting",
      duration_minutes: 30,
      scheduling_url: "https://calendly.com/janedoe/30min",
      active: true,
    });
  });

  it("check_availability finds the event type and formats slots in the configured timezone", async () => {
    process.env.ASSISTANT_TIMEZONE = "Europe/London";
    const fetchMock = mockFetch((url) => {
      if (url.endsWith("/users/me")) return jsonResponse({ resource: currentUser });
      if (url.includes("/event_types")) return jsonResponse({ collection: eventTypes });
      if (url.includes("/event_type_available_times")) {
        return jsonResponse({ collection: availableTimes });
      }
      return jsonResponse({}, 404);
    });

    const result = (await runCalendly({
      action: "check_availability",
      event_type: "30 Minute Meeting",
      days_from_now: 5,
    })) as {
      event_type: string;
      timezone: string;
      slots: Array<{ start: string; end: string; start_local: string }>;
    };

    expect(result.event_type).toBe("30 Minute Meeting");
    expect(result.timezone).toBe("Europe/London");
    expect(result.slots).toHaveLength(1);
    expect(result.slots[0].start).toBe(availableTimes[0].start_time);
    // Localized via Intl in the configured timezone, so it must NOT be raw UTC.
    expect(String(result.slots[0].start_local)).not.toBe(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "UTC",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(availableTimes[0].start_time))
    );

    const availCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("/event_type_available_times")
    );
    expect(String(availCall?.[0])).toContain("event_type=https%3A%2F%2Fapi.calendly.com%2Fevent_types%2FET001");
  });

  it("check_availability errors when the event type does not exist", async () => {
    mockFetch((url) => {
      if (url.endsWith("/users/me")) return jsonResponse({ resource: currentUser });
      if (url.includes("/event_types")) return jsonResponse({ collection: eventTypes });
      return jsonResponse({}, 404);
    });

    await expect(
      runCalendly({ action: "check_availability", event_type: "Nope" })
    ).rejects.toThrow(/Event type "Nope" not found/);
  });

  it("book_meeting rejects when identity fields are missing", async () => {
    mockFetch((url) => {
      if (url.endsWith("/users/me")) return jsonResponse({ resource: currentUser });
      if (url.includes("/event_types")) return jsonResponse({ collection: eventTypes });
      return jsonResponse({}, 404);
    });

    const noTime = await runCalendly({
      action: "book_meeting",
      event_type: "30 Minute Meeting",
      invitee_name: "Priya",
      invitee_email: "priya@example.com",
    });
    expect(noTime.error).toMatch(/start_time/);

    mockFetch((url) => {
      if (url.endsWith("/users/me")) return jsonResponse({ resource: currentUser });
      if (url.includes("/event_types")) return jsonResponse({ collection: eventTypes });
      return jsonResponse({}, 404);
    });

    const noName = await runCalendly({
      action: "book_meeting",
      event_type: "30 Minute Meeting",
      start_time: "2026-09-04T14:00:00Z",
      invitee_email: "priya@example.com",
    });
    expect(noName.error).toMatch(/invitee_name/);

    mockFetch((url) => {
      if (url.endsWith("/users/me")) return jsonResponse({ resource: currentUser });
      if (url.includes("/event_types")) return jsonResponse({ collection: eventTypes });
      return jsonResponse({}, 404);
    });

    const noEmail = await runCalendly({
      action: "book_meeting",
      event_type: "30 Minute Meeting",
      start_time: "2026-09-04T14:00:00Z",
      invitee_name: "Priya",
    });
    expect(noEmail.error).toMatch(/invitee_email/);
  });

  it("book_meeting POSTs to /invitees with the invitee payload", async () => {
    let postedBody: string | null = null;
    mockFetch((url, init) => {
      if (url.endsWith("/users/me")) return jsonResponse({ resource: currentUser });
      if (url.includes("/event_types")) return jsonResponse({ collection: eventTypes });
      if (url.endsWith("/invitees")) {
        postedBody = String(init?.body);
        return jsonResponse({ resource: {} });
      }
      return jsonResponse({}, 404);
    });

    const result = await runCalendly({
      action: "book_meeting",
      event_type: "30 Minute Meeting",
      start_time: "2026-09-04T14:00:00Z",
      invitee_name: "Priya Kapoor",
      invitee_email: "priya@example.com",
      invitee_timezone: "Asia/Kolkata",
    });

    expect(result.booked).toBe(true);
    expect(postedBody).not.toBeNull();
    const parsed = JSON.parse(postedBody!);
    expect(parsed.event_type).toBe("https://api.calendly.com/event_types/ET001");
    expect(parsed.start_time).toBe("2026-09-04T14:00:00Z");
    expect(parsed.invitee).toEqual({
      name: "Priya Kapoor",
      email: "priya@example.com",
      timezone: "Asia/Kolkata",
    });
  });

  it("list_scheduled_events maps upcoming meetings", async () => {
    mockFetch((url) => {
      if (url.endsWith("/users/me")) return jsonResponse({ resource: currentUser });
      if (url.includes("/scheduled_events")) {
        return jsonResponse({ collection: scheduledEvents });
      }
      return jsonResponse({}, 404);
    });

    const result = (await runCalendly({ action: "list_scheduled_events" })) as {
      events: Array<{
        uuid: string;
        name: string;
        status: string;
        start: string;
        end: string;
      }>;
    };
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      uuid: "se-001",
      name: "30 Minute Meeting",
      status: "active",
    });
  });

  it("cancel_meeting extracts the uuid from a full URL and POSTs the cancellation", async () => {
    let postedUrl = "";
    mockFetch((url, init) => {
      if (url.endsWith("/cancellation")) {
        postedUrl = url;
        return jsonResponse({ resource: {} });
      }
      return jsonResponse({}, 404);
    });

    const result = await runCalendly({
      action: "cancel_meeting",
      scheduled_event:
        "https://api.calendly.com/scheduled_events/6d2c5d14-6d5b-4f6f-9a4e-9b3c2f3a0000",
      reason: "timezone conflict",
    });

    expect(result).toEqual({
      cancelled: true,
      uuid: "6d2c5d14-6d5b-4f6f-9a4e-9b3c2f3a0000",
    });
    expect(postedUrl).toContain(
      "/scheduled_events/6d2c5d14-6d5b-4f6f-9a4e-9b3c2f3a0000/cancellation"
    );
  });

  it("cancel_meeting rejects a malformed scheduled_event ref", async () => {
    const fetchMock = mockFetch(() => jsonResponse({}, 404));
    const result = await runCalendly({
      action: "cancel_meeting",
      scheduled_event: "not-a-uuid",
    });
    expect(result.error).toMatch(/Could not extract a scheduled event uuid/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a helpful error for unknown actions", async () => {
    const fetchMock = mockFetch(() => jsonResponse({}, 404));
    const result = await runCalendly({ action: "do_the_thing" });
    expect(result.error).toMatch(/Unknown action "do_the_thing"/);
    expect(result.valid_actions).toContain("book_meeting");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws a CalendlyApiError with the API message on non-ok responses", async () => {
    mockFetch(() =>
      jsonResponse(
        { message: "start_time must be in the future" },
        400
      )
    );

    const err = await runCalendly({ action: "get_me" }).catch((e) => e);
    expect(err).toBeInstanceOf(CalendlyApiError);
    expect((err as CalendlyApiError).status).toBe(400);
    expect((err as CalendlyApiError).detail).toContain(
      "start_time must be in the future"
    );
  });
});