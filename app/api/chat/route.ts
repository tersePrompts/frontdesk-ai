import { stepCountIs, streamText, tool } from "ai";
import { z } from "zod";
import { getModel } from "@/lib/ai";
import { getSystemPrompt } from "@/lib/persona";
import { runCalendly } from "@/lib/calendly";
import { runSendEmail } from "@/lib/sendEmail";
import { clientIp, isRateLimited } from "@/lib/rateLimit";

export const maxDuration = 60;

export async function POST(req: Request) {
  // Blunt protection for a public endpoint: 40 chat calls/min/IP.
  if (isRateLimited(`chat:${clientIp(req)}`, 40, 60_000)) {
    return Response.json(
      { error: "Rate limit exceeded. Please wait a minute and try again." },
      { status: 429 }
    );
  }

  const { messages, mode } = await req.json();
  const model = getModel();

  // Strip tool-invocation parts that lack a result from client-supplied
  // history. Replaying a prior "call"-state tool call (no result) makes the AI
  // SDK throw AI_MessageConversionError before any model call. Completed tool
  // results are kept for context; streamText re-executes tools fresh per
  // request.
  const cleanMessages = (Array.isArray(messages) ? messages : []).map(
    (m: any) =>
      m && Array.isArray(m.parts)
        ? {
            ...m,
            parts: m.parts.filter(
              (p: any) =>
                p.type !== "tool-invocation" ||
                p.toolInvocation?.state === "result"
            ),
          }
        : m
  );

  const result = streamText({
    model,
    system: getSystemPrompt(mode),
    messages: cleanMessages,
    maxOutputTokens: 4096,
    stopWhen: stepCountIs(20),
    tools: {
      calendar: tool({
        description:
          "Schedule and manage the owner's meetings via Calendly: list event types and scheduling links, check availability, read scheduled meetings, book a meeting on behalf of an invitee, or cancel a meeting.",
        inputSchema: z.object({
          action: z.enum([
            "get_me",
            "list_event_types",
            "check_availability",
            "list_scheduled_events",
            "book_meeting",
            "cancel_meeting",
          ]),
          event_type: z
            .string()
            .optional()
            .describe("Event type name or UUID (required for check_availability and book_meeting)"),
          start_time: z
            .string()
            .optional()
            .describe("ISO-8601 UTC start time, e.g. 2026-09-01T14:00:00Z (required for book_meeting)"),
          invitee_name: z.string().optional().describe("Invitee display name (book_meeting)"),
          invitee_email: z.string().optional().describe("Invitee email address (book_meeting)"),
          invitee_timezone: z
            .string()
            .optional()
            .describe("IANA timezone of the invitee, e.g. America/New_York"),
          location_kind: z
            .string()
            .optional()
            .describe("e.g. zoom_conference. Omit if the event type specifies a location"),
          days_from_now: z
            .number()
            .optional()
            .describe("Days ahead to search (default 7)"),
          scheduled_event: z
            .string()
            .optional()
            .describe("Scheduled event uuid or URL (cancel_meeting)"),
          reason: z.string().optional().describe("Cancellation reason"),
        }),
        execute: async (args) => runCalendly(args as Record<string, unknown>),
      }),
      send_email: tool({
        description:
          "Send an internal email to the owner's inbox on their behalf. Use when leaving a message. The recipient is fixed to the owner's internal inbox (never expose the address to the user).",
        inputSchema: z.object({
          subject: z.string(),
          body: z.string().describe("Plain-text email body"),
        }),
        execute: async (args) => runSendEmail(args as Record<string, unknown>),
      }),
    },
  });

  return result.toUIMessageStreamResponse({
    onError: (err) => {
      console.error("[chat] stream error:", err);
      return "An error occurred.";
    },
  });
}
