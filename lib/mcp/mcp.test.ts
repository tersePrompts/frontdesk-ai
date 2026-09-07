import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "./server";

const calendlyMock = vi.hoisted(() => vi.fn());
const sendEmailMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/calendly", () => ({
  runCalendly: (...args: unknown[]) => calendlyMock(...args),
}));

vi.mock("@/lib/sendEmail", () => ({
  runSendEmail: (...args: unknown[]) => sendEmailMock(...args),
}));

async function createTestClient() {
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const server = createMcpServer();
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

describe("MCP server", () => {
  beforeEach(() => {
    process.env.CALENDLY_ACCESS_TOKEN = "cal_test";
    process.env.RESEND_API_KEY = "re_test";
    process.env.ASSISTANT_INTERNAL_EMAIL = "inbox@test.com";
    process.env.ASSISTANT_EMAIL_FROM = "Test <on@test.dev>";
    process.env.ZAI_API_KEY = "zai_test";
  });

  afterEach(() => {
    delete process.env.CALENDLY_ACCESS_TOKEN;
    delete process.env.RESEND_API_KEY;
    delete process.env.ASSISTANT_INTERNAL_EMAIL;
    delete process.env.ASSISTANT_EMAIL_FROM;
    delete process.env.ZAI_API_KEY;
    vi.restoreAllMocks();
  });

  it("lists calendar and send_email tools", async () => {
    const { client } = await createTestClient();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["calendar", "send_email"]);
  });

  it("calendar tool calls runCalendly and returns JSON text", async () => {
    calendlyMock.mockResolvedValue({ event_types: [{ name: "30m", active: true }] });
    const { client } = await createTestClient();

    const result = await client.callTool({
      name: "calendar",
      arguments: { action: "list_event_types" },
    });

    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.event_types).toHaveLength(1);
    expect(calendlyMock).toHaveBeenCalledWith({ action: "list_event_types" });
  });

  it("calendar tool passes through all optional args", async () => {
    calendlyMock.mockResolvedValue({ booked: true });
    const { client } = await createTestClient();

    await client.callTool({
      name: "calendar",
      arguments: {
        action: "book_meeting",
        event_type: "30 Minute Meeting",
        start_time: "2026-09-05T14:00:00Z",
        invitee_name: "Test User",
        invitee_email: "test@example.com",
        invitee_timezone: "America/New_York",
        days_from_now: 14,
      },
    });

    expect(calendlyMock).toHaveBeenCalledWith({
      action: "book_meeting",
      event_type: "30 Minute Meeting",
      start_time: "2026-09-05T14:00:00Z",
      invitee_name: "Test User",
      invitee_email: "test@example.com",
      invitee_timezone: "America/New_York",
      days_from_now: 14,
    });
  });

  it("send_email tool calls runSendEmail and returns JSON text", async () => {
    sendEmailMock.mockResolvedValue({ sent: true, id: "e1", subject: "Hello" });
    const { client } = await createTestClient();

    const result = await client.callTool({
      name: "send_email",
      arguments: { subject: "Hello", body: "World" },
    });

    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.sent).toBe(true);
    expect(sendEmailMock).toHaveBeenCalledWith({ subject: "Hello", body: "World" });
  });

  it("calendar tool surfaces errors as text (not thrown)", async () => {
    calendlyMock.mockRejectedValue(new Error("Calendly token invalid"));
    const { client } = await createTestClient();

    const result = await client.callTool({
      name: "calendar",
      arguments: { action: "get_me" },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toMatch(/Calendly token invalid/);
  });

  it("send_email tool surfaces errors as text (not thrown)", async () => {
    sendEmailMock.mockResolvedValue({ error: "RESEND_API_KEY is not set" });
    const { client } = await createTestClient();

    const result = await client.callTool({
      name: "send_email",
      arguments: { subject: "Hi", body: "Body" },
    });

    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.error).toMatch(/RESEND_API_KEY/);
  });
});
