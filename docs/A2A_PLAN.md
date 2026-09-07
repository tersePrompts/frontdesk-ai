# Multi-Protocol Agent Implementation Plan — Frontdesk AI

## Overview

Expose the same Frontdesk AI assistant via **three protocols**:

| Protocol | Endpoint | Audience |
|----------|----------|----------|
| **REST API** | `POST /api/chat` | Human users (chat UI) |
| **MCP** | `POST /api/mcp` | AI agents needing tool access (Calendly, Email) |
| **A2A** | `POST /a2a` | AI agents delegating full tasks |

All three share the same underlying tools (`lib/calendly.ts`, `lib/sendEmail.ts`) and the same `ZAI_API_KEY` authentication.

---

## 1. Protocol Architecture

```
                    ┌─────────────────────────────────────────────┐
                    │              Frontdesk AI                   │
┌───────────────────┼─────────────────────────────────────────────┼───────────────────┐
│  Human Chat UI    │  MCP Server          │  A2A Server          │                   │
│  POST /api/chat   │  POST /api/mcp       │  POST /a2a           │                   │
│  (SSE streaming)  │  (tool calls)        │  (task delegation)   │                   │
└─────────┬─────────┴──────────┬───────────┴──────────┬───────────┘                   │
          │                    │                      │                               │
          └────────────────────┴──────────────────────┘                               │
                                   │                                                  │
                         ┌─────────▼─────────┐                                        │
                         │   Shared Tools    │                                        │
                         │  • Calendly       │                                        │
                         │  • Send Email     │                                        │
                         │  • GLM Chat       │                                        │
                         └───────────────────┘                                        │
                                                                                    │
                                              ┌──────────────────────────────────────┘
                                              │
                                    ┌─────────▼─────────┐
                                    │   Discovery       │
                                    │  GET /.well-known │
                                    │  /agent-card.json │
                                    └───────────────────┘
```

---

## 2. Files to Create

| File | Purpose |
|------|---------|
| `app/.well-known/agent-card.json/route.ts` | AgentCard discovery endpoint |
| `app/a2a/route.ts` | JSON-RPC handler (SendMessage, GetTask, CancelTask, SendStreamingMessage) |
| `lib/a2a/types.ts` | A2A protocol type definitions |
| `lib/a2a/executor.ts` | AgentExecutor implementation (business logic) |
| `lib/a2a/store.ts` | In-memory task store (upgradeable to Redis/DB) |
| `lib/a2a/streaming.ts` | SSE streaming helpers for task updates |
| `app/a2a/a2a.test.ts` | Tests for A2A endpoints |

---

## 3. AgentCard Definition

```typescript
// app/.well-known/agent-card.json/route.ts
{
  name: "Frontdesk AI",
  description: "Personal AI concierge that books meetings, takes messages, and answers questions about its owner.",
  version: "1.0.0",
  supportedInterfaces: [{
    url: "https://<deployed-url>/a2a",
    protocolBinding: "JSONRPC",
    protocolVersion: "1.0"
  }],
  provider: {
    organization: "Frontdesk AI",
    url: "https://github.com/tersePrompts/frontdesk-ai"
  },
  capabilities: {
    streaming: true,
    pushNotifications: false,
    extendedAgentCard: false
  },
  defaultInputModes: ["text/plain", "application/json"],
  defaultOutputModes: ["text/plain", "application/json"],
  skills: [
    {
      id: "calendar-scheduling",
      name: "Calendar Scheduling",
      description: "Books meetings on the owner's Calendly, checks availability, lists event types, and manages scheduled events.",
      tags: ["calendar", "scheduling", "meetings", "calendly"],
      examples: [
        "Book a 30-minute meeting with John tomorrow at 2pm",
        "Check the owner's availability for next week",
        "Cancel the meeting scheduled for Friday"
      ]
    },
    {
      id: "message-taking",
      name: "Message Taking",
      description: "Takes messages and emails them to the owner's internal inbox. Recipient is never exposed.",
      tags: ["email", "messaging", "contact"],
      examples: [
        "Leave a message for the owner about the project update",
        "Send an email reminder about tomorrow's deadline"
      ]
    },
    {
      id: "general-assistant",
      name: "General Assistant",
      description: "Answers questions about the owner, their background, skills, and availability.",
      tags: ["qa", "information", "assistant"],
      examples: [
        "What is the owner's experience with AI?",
        "Tell me about the owner's background",
        "What projects has the owner worked on?"
      ]
    }
  ],
  securitySchemes: {
    bearerAuth: {
      httpAuthSecurityScheme: { scheme: "bearer", bearerFormat: "API Key" }
    }
  },
  security: [{ bearerAuth: [] }]
}
```

---

## 4. JSON-RPC Endpoint Structure

```typescript
// app/a2a/route.ts

// Supported methods:
// - SendMessage        → Process message, return completed task (blocking)
// - SendStreamingMessage → Process message, stream updates via SSE
// - GetTask            → Retrieve task by ID
// - ListTasks          → List active tasks (optional)
// - CancelTask         → Cancel a running task

// Request format:
{
  jsonrpc: "2.0",
  method: "SendMessage",
  params: {
    message: {
      role: "user",
      parts: [{ type: "text", text: "Book a meeting tomorrow at 2pm" }],
      contextId: "optional-context",
      taskId: "optional-task-id"
    },
    configuration: {
      acceptedOutputModes: ["text/plain"],
      returnImmediately: false  // blocking
    }
  },
  id: "request-1"
}

// Response format:
{
  jsonrpc: "2.0",
  id: "request-1",
  result: {
    id: "task-uuid",
    contextId: "context-uuid",
    status: { state: "completed" },
    artifacts: [{
      artifactId: "artifact-uuid",
      parts: [{ type: "text", text: "Meeting booked for tomorrow at 2pm." }],
      lastChunk: true
    }]
  }
}
```

---

## 5. AgentExecutor Implementation

```typescript
// lib/a2a/executor.ts

export class ConciergeExecutor implements AgentExecutor {
  async execute(
    requestContext: RequestContext,
    eventBus: ExecutionEventBus
  ): Promise<void> {
    const { taskId, contextId, userMessage, task } = requestContext;
    
    // 1. Publish initial task if new
    if (!task) {
      eventBus.publishTask({
        kind: "task",
        id: taskId,
        contextId,
        status: { state: "submitted", timestamp: new Date().toISOString() },
        history: [userMessage]
      });
    }
    
    // 2. Update to working state
    eventBus.publishTaskStatus({
      taskId, contextId,
      status: {
        state: "working",
        message: { role: "agent", parts: [{ kind: "text", text: "Processing..." }] }
      }
    });
    
    // 3. Extract user intent from message
    const userText = userMessage.parts
      .filter(p => p.kind === "text")
      .map(p => p.text)
      .join("\n");
    
    // 4. Route to appropriate tool based on intent
    const result = await this.routeToTool(userText);
    
    // 5. Publish artifact
    eventBus.publishTaskArtifact({
      taskId, contextId,
      artifact: {
        artifactId: crypto.randomUUID(),
        parts: [{ kind: "text", text: result }],
        lastChunk: true
      }
    });
    
    // 6. Mark completed
    eventBus.publishTaskStatus({
      taskId, contextId,
      status: { state: "completed", timestamp: new Date().toISOString() },
      final: true
    });
  }
  
  private async routeToTool(text: string): Promise<string> {
    // Simple intent detection (could use LLM for complex routing)
    const lower = text.toLowerCase();
    
    if (lower.includes("book") || lower.includes("meeting") || lower.includes("schedule")) {
      return await this.handleCalendar(text);
    }
    if (lower.includes("message") || lower.includes("email") || lower.includes("send")) {
      return await this.handleMessage(text);
    }
    // Default: general chat
    return await this.handleChat(text);
  }
  
  private async handleCalendar(text: string): Promise<string> {
    // Reuse existing calendly.ts
    const result = await runCalendly({ action: "list_event_types" });
    // Parse intent and execute appropriate action
    // ... (implementation details)
    return `Calendar action completed: ${JSON.stringify(result)}`;
  }
  
  private async handleMessage(text: string): Promise<string> {
    // Reuse existing sendEmail.ts
    const result = await runSendEmail({
      subject: "Message from A2A Agent",
      body: text
    });
    return result.sent ? "Message delivered." : `Failed: ${result.error}`;
  }
  
  private async handleChat(text: string): Promise<string> {
    // Reuse existing GLM chat (simplified - no streaming for A2A)
    const zai = getZaiClient();
    const result = await zai.chat({
      model: process.env.ZAI_MODEL ?? "glm-5.3-flash",
      messages: [{ role: "user", content: text }],
      maxTokens: 1024
    });
    return result.choices[0].message.content;
  }
}
```

---

## 6. Task Store

```typescript
// lib/a2a/store.ts

interface Task {
  id: string;
  contextId: string;
  status: TaskStatus;
  artifacts: Artifact[];
  history: Message[];
  metadata: Record<string, unknown>;
}

// In-memory store for MVP
const tasks = new Map<string, Task>();

export const taskStore = {
  get: (id: string) => tasks.get(id),
  set: (id: string, task: Task) => tasks.set(id, task),
  delete: (id: string) => tasks.delete(id),
  list: (filter?: { contextId?: string; state?: TaskState }) => {
    return Array.from(tasks.values()).filter(t => {
      if (filter?.contextId && t.contextId !== filter.contextId) return false;
      if (filter?.state && t.status.state !== filter.state) return false;
      return true;
    });
  }
};
```

---

## 7. Streaming Implementation

For `SendStreamingMessage`, return SSE stream:

```typescript
// lib/a2a/streaming.ts

export function createA2AStream(
  taskId: string,
  contextId: string,
  executor: AgentExecutor,
  requestContext: RequestContext
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };
      
      // Create event bus that sends SSE events
      const eventBus: ExecutionEventBus = {
        publishTask: (task) => send({ jsonrpc: "2.0", id: requestContext.id, result: { task } }),
        publishTaskStatus: (update) => send({ jsonrpc: "2.0", id: requestContext.id, result: { statusUpdate: update } }),
        publishTaskArtifact: (update) => send({ jsonrpc: "2.0", id: requestContext.id, result: { artifactUpdate: update } }),
      };
      
      try {
        await executor.execute(requestContext, eventBus);
      } catch (err) {
        // Publish error status
        eventBus.publishTaskStatus({
          taskId, contextId,
          status: { state: "failed", message: { role: "agent", parts: [{ kind: "text", text: String(err) }] } },
          final: true
        });
      }
      
      controller.close();
    }
  });
  
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    }
  });
}
```

---

## 8. Security Considerations

1. **API Key Authentication**: Require Bearer token in `Authorization` header
2. **Rate Limiting**: Reuse existing `lib/rateLimit.ts` (40 req/min per IP)
3. **Input Validation**: Sanitize incoming messages, enforce max length
4. **Tool Gating**: Same privacy rules as chat (require name/email before booking)
5. **Audit Log**: Log all A2A task executions for monitoring

---

## 9. Integration with Existing Code

| Existing File | Reuse In A2A |
|---------------|--------------|
| `lib/calendly.ts` | Calendar tool actions |
| `lib/sendEmail.ts` | Message/email sending |
| `lib/ai.ts` | GLM client for general chat |
| `lib/persona.ts` | System prompts (optional - A2A agents may not need persona) |
| `lib/rateLimit.ts` | A2A endpoint rate limiting |

---

## 10. Testing Strategy

1. **Unit Tests**: AgentExecutor routing logic, task store operations
2. **Integration Tests**: Full JSON-RPC request/response cycle
3. **Streaming Tests**: SSE event format, stream completion
4. **Agent Card Tests**: Valid JSON, correct endpoints, skill definitions
5. **Client Tests**: Use `@a2a-js/sdk` client to verify interop

---

## 11. Deployment Notes

- A2A endpoints must be publicly accessible (no Vercel auth)
- Add CORS headers for cross-origin agent access
- Environment variables needed: same as existing (`ZAI_API_KEY`, `CALENDLY_ACCESS_TOKEN`, etc.)
- Consider adding `A2A_ENABLED=true` env var to opt-in (default: disabled for backward compat)

---

## 12. Future Enhancements

1. **Push Notifications**: Webhook support for long-running tasks
2. **Multi-Tenancy**: Support multiple concierge instances via `tenant` field
3. **Extended AgentCard**: Authenticated card with additional private skills
4. **Persistent Store**: Redis/PostgreSQL for task persistence across deploys
5. **LLM-Based Routing**: Use GLM to parse complex intents (vs simple keyword matching)

---

## 13. Implementation Order

1. Create `lib/a2a/types.ts` - Type definitions
2. Create `lib/a2a/store.ts` - Task storage
3. Create `lib/a2a/executor.ts` - Business logic
4. Create `lib/a2a/streaming.ts` - SSE helpers
5. Create `app/.well-known/agent-card.json/route.ts` - Discovery
6. Create `app/a2a/route.ts` - JSON-RPC handler
7. Create `app/a2a/a2a.test.ts` - Tests
8. Update `README.md` - Document A2A usage
9. Update `GO_PUBLIC.md` - Add A2A to marketing pitch

---

## 14. Verification Checklist

- [ ] AgentCard served at `/.well-known/agent-card.json`
- [ ] JSON-RPC endpoint accepts `SendMessage` and returns completed task
- [ ] Streaming works via `SendStreamingMessage`
- [ ] Calendar tool invoked correctly via A2A
- [ ] Message taking works via A2A
- [ ] General chat works via A2A
- [ ] Rate limiting applied
- [ ] Authentication required
- [ ] Tests pass
- [ ] Documentation updated
