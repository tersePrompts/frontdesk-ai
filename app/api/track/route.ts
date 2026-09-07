import { NextRequest, NextResponse } from "next/server";
import { isRateLimited } from "@/lib/rateLimit";

export const runtime = "nodejs";

const NTFY_TOPIC = process.env.NTFY_TOPIC ?? "";
// Optional facilitator: when NTFY_TOPIC is unset no push is attempted (no
// hardcoded default topic that could leak a fork's visitors to a stranger's
// public inbox).
const NTFY_URL = NTFY_TOPIC ? `https://ntfy.sh/${NTFY_TOPIC}` : "";

// Internal inbox for visit notifications. Never exposed to chat users.
const INTERNAL_INBOX =
  process.env.ASSISTANT_INTERNAL_EMAIL ?? "";
const EMAIL_FROM = process.env.ASSISTANT_EMAIL_FROM ?? "";

// Free IP geolocation, no API key needed. Replies with the geolocation in
// city/countryName form (ip-api.com free endpoints).
async function lookupLocation(ip: string): Promise<string> {
  try {
    const url = `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,city,regionName,country,countryCode,query`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return "";
    const j = (await res.json()) as {
      status?: string;
      city?: string;
      regionName?: string;
      country?: string;
      countryCode?: string;
    };
    if (j.status !== "success") return "";
    return [j.city, j.regionName, j.country].filter(Boolean).join(", ");
  } catch {
    return "";
  }
}

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  // Blunt protection for a public endpoint: 24 visits/min/IP (a real user
  // fires exactly one beacon per page load, so this never trips legit usage).
  if (isRateLimited(`track:${ip}`, 24, 60_000)) {
    return NextResponse.json(
      { ok: false, error: "rate limited" },
      { status: 429 }
    );
  }

  const ua = req.headers.get("user-agent") ?? "";
  const referer = req.headers.get("referer") ?? "";
  const { mode } = (await req.json().catch(() => ({}))) ?? {};

  const location = await lookupLocation(ip);

  const subject = `🌐 New site visit${location ? ` — ${location}` : ""}`;
  const text = [
    `New visitor to frontdesk-ai.vercel.app`,
    ``,
    `IP: ${ip}`,
    location ? `Location: ${location}` : "Location: (unknown)",
    `Page/mode: ${mode ?? "unknown"}`,
    referer ? `Referrer: ${referer}` : "",
    ``,
    `User-Agent: ${ua.slice(0, 400)}`,
  ]
    .filter((l) => l !== "")
    .join("\n");

  // Best-effort push + email; never block/delay the visitor's response.
  const tasks: Promise<void>[] = [];

  const apiKey = process.env.RESEND_API_KEY;
  if (NTFY_URL) {
    tasks.push(
      fetch(NTFY_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: `${subject}\n\n${text}`,
      }).then(() => undefined, () => undefined)
    );
  }

  if (apiKey) {
    tasks.push(
      fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: EMAIL_FROM,
          to: [INTERNAL_INBOX],
          subject,
          text,
        }),
      }).then(() => undefined, () => undefined)
    );
  }

  await Promise.all(tasks);

  return NextResponse.json({ ok: true, ip, location, ua: ua.slice(0, 200) });
}
