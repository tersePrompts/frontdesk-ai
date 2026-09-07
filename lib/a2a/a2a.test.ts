import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AGENT_CARD } from "./types";
import { conciergeExecutor } from "./executor";
import { TaskState, Role } from "@a2a-js/sdk";
import {
  DefaultExecutionEventBus,
} from "@a2a-js/sdk/server";
import type { AgentExecutionEvent, ExecutionEventBus } from "@a2a-js/sdk/server";

const calendlyMock = vi.hoisted(() => vi.fn());
const sendEmailMock = vi.hoisted(() => vi.fn());
const generateTextMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/calendly", () => ({
  runCalendly: (...args: unknown[]) => calendlyMock(...args),
}));

vi.mock("@/lib/sendEmail", () => ({
  runSendEmail: (...args: unknown[]) => sendEmailMock(...args),
}));

vi.mock("@/lib/ai", () => ({
  getModel: vi.fn(() => ({
    chat: vi.fn(),
    languageModel: vi.fn(),
  })),
}));

vi.mock("ai", () => ({
  generateText: (...args: unknown[]) => generateTextMock(...args),
}));

function makeUserMessage(text: string) {
  return {
    messageId: crypto.randomUUID(),
    contextId: "",
    taskId: "",
    role: Role.ROLE_USER,
    parts: [
      {
        content: { $case: "text" as const, value: text },
        metadata: undefined,
        filename: "",
        mediaType: "text/plain",
      },
    ],
    metadata: undefined,
    extensions: [],
    referenceTaskIds: [],
  };
}

function makeRequestContext(text: string, taskId: string, contextId: string) {
  return {
    request: {
      message: makeUserMessage(text),
      configuration: {
        acceptedOutputModes: ["text/plain"],
        returnImmediately: false,
      },
    },
    taskId,
    contextId,
    context: {},
    get userMessage() {
      return this.request.message;
    },
  } as any;
}

describe("AgentCard", () => {
  it("has correct name and version", () => {
    expect(AGENT_CARD.name).toBe("Frontdesk AI");
    expect(AGENT_CARD.version).toBe("1.0.0");
  });

  it("exposes three skills", () => {
    expect(AGENT_CARD.skills).toHaveLength(3);
    const ids = AGENT_CARD.skills.map((s) => s.id).sort();
    expect(ids).toEqual([
      "calendar-scheduling",
      "general-assistant",
      "message-taking",
    ]);
  });

  it("declares streaming capability", () => {
    expect(AGENT_CARD.capabilities?.streaming).toBe(true);
  });

  it("declares JSONRPC interface", () => {
    expect(AGENT_CARD.supportedInterfaces[0].protocolBinding).toBe("JSONRPC");
  });

  it("requires Bearer auth", () => {
    const scheme = AGENT_CARD.securitySchemes.bearerAuth;
    expect(scheme?.scheme?.$case).toBe("httpAuthSecurityScheme");
  });
});

describe("conciergeExecutor", () => {
  beforeEach(() => {
    process.env.CALENDLY_ACCESS_TOKEN = "cal_test";
    process.env.RESEND_API_KEY = "re_test";
    process.env.ASSISTANT_INTERNAL_EMAIL = "inbox@test.com";
    process.env.ASSISTANT_EMAIL_FROM = "Test <on@test.dev>";
    process.env.ZAI_API_KEY = "zai_test";
    process.env.ZAI_MODEL = "glm-5.3-flash";
    calendlyMock.mockClear();
    sendEmailMock.mockClear();
    generateTextMock.mockClear();
  });

  afterEach(() => {
    delete process.env.CALENDLY_ACCESS_TOKEN;
    delete process.env.RESEND_API_KEY;
    delete process.env.ASSISTANT_INTERNAL_EMAIL;
    delete process.env.ASSISTANT_EMAIL_FROM;
    delete process.env.ZAI_API_KEY;
    delete process.env.ZAI_MODEL;
    vi.restoreAllMocks();
  });

  it("routes calendar keywords to runCalendly", async () => {
    calendlyMock.mockResolvedValue({ event_types: [{ name: "30m" }] });
    const bus = new DefaultExecutionEventBus();
    const events: AgentExecutionEvent[] = [];
    bus.on("event", (e) => events.push(e));

    const ctx = makeRequestContext("List my calendar events", "task-1", "ctx-1");
    await conciergeExecutor.execute(ctx, bus);

    expect(calendlyMock).toHaveBeenCalled();
    const lastEvent = events[events.length - 1];
    expect(lastEvent.kind).toBe("statusUpdate");
    if (lastEvent.kind === "statusUpdate") {
      expect(lastEvent.data.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);
    }
  });

  it("routes message keywords to runSendEmail", async () => {
    sendEmailMock.mockResolvedValue({ sent: true, id: "e1" });
    const bus = new DefaultExecutionEventBus();
    const events: AgentExecutionEvent[] = [];
    bus.on("event", (e) => events.push(e));

    const ctx = makeRequestContext("Leave a message for the owner", "task-2", "ctx-2");
    await conciergeExecutor.execute(ctx, bus);

    expect(sendEmailMock).toHaveBeenCalled();
    const lastEvent = events[events.length - 1];
    expect(lastEvent.kind).toBe("statusUpdate");
    if (lastEvent.kind === "statusUpdate") {
      expect(lastEvent.data.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);
    }
  });

  it("routes plain questions to the chat tool", async () => {
    const { routeToTool } = await import("./executor");
    expect(routeToTool("What is the owner's background?").tool).toBe("chat");
    expect(routeToTool("Tell me about the owner").tool).toBe("chat");
    expect(routeToTool("What projects has the owner worked on?").tool).toBe("chat");
  });

  it("routes calendar keywords to the calendar tool", async () => {
    const { routeToTool } = await import("./executor");
    expect(routeToTool("Book a meeting tomorrow").tool).toBe("calendar");
    expect(routeToTool("Check availability for next week").tool).toBe("calendar");
    expect(routeToTool("Cancel the Friday meeting").tool).toBe("calendar");
  });

  it("routes messaging keywords to the email tool", async () => {
    const { routeToTool } = await import("./executor");
    expect(routeToTool("Leave a message for the owner").tool).toBe("email");
    expect(routeToTool("Send an email about the deadline").tool).toBe("email");
  });

  it("publishes task, artifactUpdate, statusUpdate in order", async () => {
    calendlyMock.mockResolvedValue({ result: "ok" });
    const bus = new DefaultExecutionEventBus();
    const events: AgentExecutionEvent[] = [];
    bus.on("event", (e) => events.push(e));

    const ctx = makeRequestContext("Show events", "task-4", "ctx-4");
    await conciergeExecutor.execute(ctx, bus);

    const kinds = events.map((e) => e.kind);
    expect(kinds).toEqual(["task", "artifactUpdate", "statusUpdate"]);
  });

  it("emits failed status when tool throws", async () => {
    calendlyMock.mockRejectedValue(new Error("Calendly down"));
    const bus = new DefaultExecutionEventBus();
    const events: AgentExecutionEvent[] = [];
    bus.on("event", (e) => events.push(e));

    const ctx = makeRequestContext("Book a meeting", "task-5", "ctx-5");
    await conciergeExecutor.execute(ctx, bus);

    const lastEvent = events[events.length - 1];
    expect(lastEvent.kind).toBe("statusUpdate");
    if (lastEvent.kind === "statusUpdate") {
      expect(lastEvent.data.status?.state).toBe(TaskState.TASK_STATE_FAILED);
    }
  });

  it("cancelTask publishes canceled status", async () => {
    const bus = new DefaultExecutionEventBus();
    const events: AgentExecutionEvent[] = [];
    bus.on("event", (e) => events.push(e));

    await conciergeExecutor.cancelTask("task-6", bus);

    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("statusUpdate");
    if (events[0].kind === "statusUpdate") {
      expect(events[0].data.status?.state).toBe(TaskState.TASK_STATE_CANCELED);
    }
  });
});
