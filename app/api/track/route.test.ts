import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { NextRequest } from "next/server";

type PostFn = (req: NextRequest) => Promise<Response>;

async function loadRoute(): Promise<PostFn> {
  // route.ts captures env-derived consts (NTFY_URL, INTERNAL_INBOX, EMAIL_FROM)
  // at module load, so re-import it after each env setup.
  vi.resetModules();
  return (await import("./route")).POST;
}

function reqWith(
  body: unknown,
  opts: { ip?: string; ua?: string; cfIp?: string } = {}
): NextRequest {
  const headers = new Headers({ "user-agent": opts.ua ?? "test-agent" });
  if (opts.ip) headers.set("x-forwarded-for", opts.ip);
  if (opts.cfIp) headers.set("x-real-ip", opts.cfIp);
  return new Request("http://localhost/api/track", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  }) as NextRequest;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("POST /api/track", () => {
  beforeEach(() => {
    process.env.RESEND_API_KEY = "re_trackkey";
    process.env.ASSISTANT_INTERNAL_EMAIL = "owner@internal.example";
    process.env.ASSISTANT_EMAIL_FROM = "Concierge <onboarding@resend.dev>";
    process.env.NTFY_TOPIC = "track-topic";
  });

  afterEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.ASSISTANT_INTERNAL_EMAIL;
    delete process.env.ASSISTANT_EMAIL_FROM;
    delete process.env.NTFY_TOPIC;
    vi.unstubAllGlobals();
  });

  it("resolves the visitor location from ip-api and pushes to ntfy + email", async () => {
    const POST = await loadRoute();
    const fetchMock = vi.fn((url: string, _init?: RequestInit) => {
      if (String(url).includes("ip-api.com")) {
        return Promise.resolve(
          jsonResponse({
            status: "success",
            city: "Pune",
            regionName: "Maharashtra",
            country: "India",
            countryCode: "IN",
            query: "1.2.3.4",
          })
        );
      }
      if (String(url).includes("ntfy.sh")) {
        return Promise.resolve(new Response("ok", { status: 200 }));
      }
      if (String(url).includes("api.resend.com")) {
        return Promise.resolve(jsonResponse({ id: "email_1" }));
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(
      reqWith({ mode: "friendly" }, { ip: "1.2.3.4", ua: "Mozilla/5.0" })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.ip).toBe("1.2.3.4");
    expect(body.location).toBe("Pune, Maharashtra, India");

    // ntfy push
    const ntfyCall = fetchMock.mock.calls.find(([u]) =>
      String(u).includes("ntfy.sh/track-topic")
    );
    expect(ntfyCall).toBeTruthy();
    expect(String(ntfyCall?.[0])).toContain("ntfy.sh/track-topic");

    // email with auth header from env
    const emailCall = fetchMock.mock.calls.find(([u]) =>
      String(u).includes("api.resend.com")
    );
    expect(emailCall).toBeTruthy();
    const emailInit = emailCall![1];
    const emailHeaders = new Headers(emailInit?.headers as HeadersInit);
    expect(emailHeaders.get("authorization")).toContain("Bearer re_trackkey");
    const emailBody = JSON.parse(String(emailInit?.body));
    expect(emailBody.to).toEqual(["owner@internal.example"]);
    expect(emailBody.from).toBe("Concierge <onboarding@resend.dev>");
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", async () => {
    const POST = await loadRoute();
    const fetchMock = vi.fn((url: string) => {
      if (String(url).includes("ip-api.com")) {
        return Promise.resolve(jsonResponse({ status: "success" }));
      }
      return Promise.resolve(new Response("ok", { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(reqWith({}, { cfIp: "203.0.113.9", ua: "curl" }));
    const body = await res.json();
    expect(body.ip).toBe("203.0.113.9");
    expect(body.location).toBe("");
  });

  it("reports unknown location and does not fail when ip-api lookup fails", async () => {
    const POST = await loadRoute();
    const fetchMock = vi.fn((url: string) => {
      if (String(url).includes("ip-api.com")) {
        return Promise.reject(new Error("timeout"));
      }
      return Promise.resolve(new Response("ok", { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(reqWith({ mode: "recruiter" }, { ip: "9.9.9.9" }));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.location).toBe("");
  });

  it("skips email when RESEND_API_KEY is missing but still pushes to ntfy", async () => {
    const POST = await loadRoute();
    delete process.env.RESEND_API_KEY;
    const fetchMock = vi.fn((url: string) => {
      if (String(url).includes("ip-api.com")) {
        return Promise.resolve(jsonResponse({ status: "success" }));
      }
      return Promise.resolve(new Response("ok", { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(reqWith({}, { ip: "5.5.5.5" }));
    expect(res.status).toBe(200);
    expect(
      fetchMock.mock.calls.some(([u]) => String(u).includes("ntfy.sh"))
    ).toBe(true);
    expect(
      fetchMock.mock.calls.some(([u]) => String(u).includes("api.resend.com"))
    ).toBe(false);
  });
});