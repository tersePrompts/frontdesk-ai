import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runCalendly } from "@/lib/calendly";
import { runSendEmail } from "@/lib/sendEmail";

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "frontdesk-ai",
    version: "1.0.0",
  });

  server.tool(
    "calendar",
    "Schedule and manage meetings via Calendly: list event types, check availability, book/cancel meetings, list scheduled events.",
    {
      action: z
        .enum([
          "get_me",
          "list_event_types",
          "check_availability",
          "list_scheduled_events",
          "book_meeting",
          "cancel_meeting",
        ])
        .describe("The calendar action to perform"),
      event_type: z
        .string()
        .optional()
        .describe(
          "Event type name, UUID, or scheduling URL (required for check_availability and book_meeting)"
        ),
      start_time: z
        .string()
        .optional()
        .describe(
          "ISO-8601 UTC start time, e.g. 2026-09-01T14:00:00Z (required for book_meeting)"
        ),
      invitee_name: z.string().optional().describe("Invitee display name (book_meeting)"),
      invitee_email: z.string().optional().describe("Invitee email address (book_meeting)"),
      invitee_timezone: z
        .string()
        .optional()
        .describe("IANA timezone of the invitee, e.g. America/New_York"),
      location_kind: z
        .string()
        .optional()
        .describe(
          "e.g. zoom_conference. Omit if the event type specifies a location"
        ),
      days_from_now: z.number().optional().describe("Days ahead to search (default 7)"),
      scheduled_event: z
        .string()
        .optional()
        .describe("Scheduled event uuid or URL (cancel_meeting)"),
      reason: z.string().optional().describe("Cancellation reason"),
    },
    async (args) => {
      const result = await runCalendly(args as Record<string, unknown>);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "send_email",
    "Send an internal email to the owner's inbox. The recipient is fixed and never exposed. Use when leaving a message for the owner.",
    {
      subject: z.string().describe("Email subject line"),
      body: z.string().describe("Plain-text email body"),
    },
    async (args) => {
      const result = await runSendEmail(args as Record<string, unknown>);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  return server;
}
