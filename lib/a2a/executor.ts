import type { AgentExecutor, RequestContext, ExecutionEventBus } from "@a2a-js/sdk/server";
import { AgentEvent } from "@a2a-js/sdk/server";
import { TaskState, Role } from "@a2a-js/sdk";
import { runCalendly } from "@/lib/calendly";
import { runSendEmail } from "@/lib/sendEmail";
import { getModel } from "@/lib/ai";

function extractText(parts: Array<{ content?: { $case: string; value: unknown } }>): string {
  return parts
    .filter((p): p is typeof p & { content: { $case: "text"; value: string } } =>
      p.content?.$case === "text"
    )
    .map((p) => p.content.value)
    .join("\n");
}

async function handleCalendar(text: string): Promise<string> {
  const lower = text.toLowerCase();

  if (lower.includes("cancel")) {
    const uuidMatch = text.match(
      /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/
    );
    const result = await runCalendly({
      action: "cancel_meeting",
      scheduled_event: uuidMatch?.[0] ?? text,
      reason: "Canceled via A2A agent",
    });
    return JSON.stringify(result);
  }

  if (lower.includes("book") || lower.includes("schedule")) {
    const result = await runCalendly({ action: "list_event_types" });
    return JSON.stringify(result);
  }

  if (lower.includes("available") || lower.includes("free")) {
    const result = await runCalendly({ action: "list_event_types" });
    return JSON.stringify(result);
  }

  if (lower.includes("list") || lower.includes("event") || lower.includes("meeting")) {
    const result = await runCalendly({ action: "list_scheduled_events" });
    return JSON.stringify(result);
  }

  const result = await runCalendly({ action: "list_event_types" });
  return JSON.stringify(result);
}

async function handleMessage(text: string): Promise<string> {
  const subjectMatch = text.match(/subject[:\s]+(.+?)(?:\n|$)/i);
  const subject = subjectMatch?.[1]?.trim() ?? "Message from A2A Agent";
  const body = text.replace(/subject[:\s]+.+\n?/i, "").trim() || text;

  const result = await runSendEmail({ subject, body });
  return JSON.stringify(result);
}

async function handleChat(text: string): Promise<string> {
  const { generateText } = await import("ai");
  const model = getModel();
  const { text: reply } = await generateText({
    model,
    prompt: text,
    maxTokens: 1024,
  });
  return reply;
}

export function routeToTool(text: string): { tool: "calendar" | "email" | "chat"; run: () => Promise<string> } {
  const lower = text.toLowerCase();

  if (
    lower.includes("book") ||
    lower.includes("meeting") ||
    lower.includes("schedule") ||
    lower.includes("calendar") ||
    lower.includes("availability") ||
    lower.includes("available") ||
    lower.includes("cancel") ||
    lower.includes("event")
  ) {
    return { tool: "calendar", run: () => handleCalendar(text) };
  }

  if (
    lower.includes("message") ||
    lower.includes("email") ||
    lower.includes("send") ||
    lower.includes("leave a note")
  ) {
    return { tool: "email", run: () => handleMessage(text) };
  }

  return { tool: "chat", run: () => handleChat(text) };
}

export const conciergeExecutor: AgentExecutor = {
  async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const { taskId, contextId, userMessage } = requestContext;

    eventBus.publish(
      AgentEvent.task({
        id: taskId,
        contextId,
        status: {
          state: TaskState.TASK_STATE_WORKING,
          message: {
            messageId: crypto.randomUUID(),
            contextId,
            taskId,
            role: Role.ROLE_AGENT,
            parts: [
              {
                content: { $case: "text", value: "Processing your request..." },
                metadata: undefined,
                filename: "",
                mediaType: "text/plain",
              },
            ],
            metadata: undefined,
            extensions: [],
            referenceTaskIds: [],
          },
          timestamp: new Date().toISOString(),
        },
        artifacts: [],
        history: [userMessage],
        metadata: undefined,
      })
    );

    try {
      const userText = extractText(userMessage.parts as Array<{ content?: { $case: string; value: unknown } }>);
      const { run } = routeToTool(userText);
      const result = await run();

      eventBus.publish(
        AgentEvent.artifactUpdate({
          taskId,
          contextId,
          artifact: {
            artifactId: crypto.randomUUID(),
            name: "result",
            description: "Agent response",
            parts: [
              {
                content: { $case: "text", value: result },
                metadata: undefined,
                filename: "",
                mediaType: "text/plain",
              },
            ],
            metadata: undefined,
            extensions: [],
          },
          append: false,
          lastChunk: true,
          metadata: undefined,
        })
      );

      eventBus.publish(
        AgentEvent.statusUpdate({
          taskId,
          contextId,
          status: {
            state: TaskState.TASK_STATE_COMPLETED,
            message: {
              messageId: crypto.randomUUID(),
              contextId,
              taskId,
              role: Role.ROLE_AGENT,
              parts: [
                {
                  content: { $case: "text", value: result },
                  metadata: undefined,
                  filename: "",
                  mediaType: "text/plain",
                },
              ],
              metadata: undefined,
              extensions: [],
              referenceTaskIds: [],
            },
            timestamp: new Date().toISOString(),
          },
          metadata: undefined,
        })
      );
    } catch (err) {
      eventBus.publish(
        AgentEvent.statusUpdate({
          taskId,
          contextId,
          status: {
            state: TaskState.TASK_STATE_FAILED,
            message: {
              messageId: crypto.randomUUID(),
              contextId,
              taskId,
              role: Role.ROLE_AGENT,
              parts: [
                {
                  content: {
                    $case: "text",
                    value: err instanceof Error ? err.message : "Unknown error",
                  },
                  metadata: undefined,
                  filename: "",
                  mediaType: "text/plain",
                },
              ],
              metadata: undefined,
              extensions: [],
              referenceTaskIds: [],
            },
            timestamp: new Date().toISOString(),
          },
          metadata: undefined,
        })
      );
    }

    eventBus.finished();
  },

  async cancelTask(taskId: string, eventBus: ExecutionEventBus): Promise<void> {
    eventBus.publish(
      AgentEvent.statusUpdate({
        taskId,
        contextId: "",
        status: {
          state: TaskState.TASK_STATE_CANCELED,
          message: {
            messageId: crypto.randomUUID(),
            contextId: "",
            taskId,
            role: Role.ROLE_AGENT,
            parts: [
              {
                content: { $case: "text", value: "Task canceled." },
                metadata: undefined,
                filename: "",
                mediaType: "text/plain",
              },
            ],
            metadata: undefined,
            extensions: [],
            referenceTaskIds: [],
          },
          timestamp: new Date().toISOString(),
        },
        metadata: undefined,
      })
    );
    eventBus.finished();
  },
};
