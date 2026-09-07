# Multi-Protocol Agent Implementation Plan — Frontdesk AI

## Overview

Expose the same Frontdesk AI assistant via **three protocols** so it works with humans, MCP clients, and A2A agents alike:

| Protocol | Endpoint | Audience | Status |
|----------|----------|----------|--------|
| **REST API** | `POST /api/chat` | Human users (chat UI) | Already exists |
| **MCP** | `POST /api/mcp` (Streamable HTTP) | AI agents needing tool access | New |
| **A2A** | `POST /a2a` + `GET /.well-known/agent-card.json` | AI agents delegating full tasks | New |

All three share the same underlying tools (`lib/calendly.ts`, `lib/sendEmail.ts`), the same LLM (`lib/ai.ts`), and the same `ZAI_API_KEY` authentication.

---

## 1. Architecture

```
                        ┌──────────────────────────────────────────────┐
                        │               Frontdesk AI                  │
                        │                                             │
┌───────────────────────┼──────────────────────────────────────────────┼───────────────────┐
│                       │                                              │                   │
│  Human Chat UI        │  MCP Server              │  A2A Server       │                   │
│  POST /api/chat       │  POST /api/mcp           │  POST /a2a        │                   │
│  (Vercel AI SDK SSE)  │  (Streamable HTTP)       │  (JSON-RPC + SSE) │                   │
│                       │  Streamable HTTP         │                   │                   │
│                       │                          │                   │                   │
└───────────┬───────────┴─────────────┬────────────┴─────────┬─────────┘                   │
            │                         │                      │                             │
            └─────────────────────────┴──────────────────────┘                             │
                                         │                                                │
                               ┌─────────▼──────────┐                                     │
                               │    Shared Tools    │                                     │
                               │  lib/calendly.ts   │                                     │
                               │  lib/sendEmail.ts  │                                     │
                               │  lib/ai.ts (GLM)   │                                     │
                               │  lib/persona.ts    │                                     │
                               └────────────────────┘                                     │
                                                                                         │
                                                ┌────────────────────────────────────────┘
                                                │
                                      ┌─────────▼─────────┐
                                      │   Discovery       │
                                      │  GET /.well-known │
                                      │  /agent-card.json │
                                      └───────────────────┘
```

---

## 2. Files to Create/Modify

### New Files

| File | Purpose |
|------|---------|
| `lib/mcp/server.ts` | MCP server configuration + tool registry |
| `app/api/mcp/route.ts` | MCP Streamable HTTP endpoint |
| `lib/a2a/types.ts` | A2A protocol type definitions |
| `lib/a2a/executor.ts` | AgentExecutor implementation |
| `lib/a2a/store.ts` | In-memory task store |
| `app/.well-known/agent-card.json/route.ts` | A2A AgentCard discovery |
| `app/a2a/route.ts` | A2A JSON-RPC handler |

### Modified Files

| File | Change |
|------|--------|
| `lib/calendly.ts` | Export tool definitions for MCP |
| `lib/sendEmail.ts` | Export tool definitions for MCP |
| `package.json` | Add `@modelcontextprotocol/sdk` and `@a2a-js/sdk` |
| `README.md` | Document all three protocols |
| `.env.example` | Add `MCP_ENABLED`, `A2A_ENABLED` flags |

---

## 3. Protocol Details

### 3.1 REST API (Already Exists)

```http
POST /api/chat
Content-Type: application/json

{
  "messages": [
    { "role": "user", "content": "Book a meeting tomorrow at 2pm" }
  ],
  "mode": "friendly"
}
```

- **Streaming**: Vercel AI SDK SSE (text deltas in `0:` frames)
- **Tools**: Calendar, send_email (defined in `app/api/chat/route.ts`)
- **Auth**: None required (public chat)
- **Status**: Fully working

---

### 3.2 MCP Server (New)

#### 3.2.1 Protocol: Streamable HTTP

MCP now uses Streamable HTTP (not SSE for tool calls). Single endpoint:

```http
POST /api/mcp
Content-Type: application/json
Authorization: Bearer <ZAI_API_KEY>

{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "calendar",
    "arguments": {
      "action": "list_event_types"
    }
  },
  "id": "request-1"
}
```

#### 3.2.2 Tool Definitions

```typescript
// lib/mcp/server.ts

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runCalendly } from "@/lib/calendly";
import { runSendEmail } from "@/lib/sendEmail";

export const mcpServer = new McpServer({
  name: "frontdesk-ai",
  version: "1.0.0"
});

// Tool 1: Calendar
mcpServer.tool(
  "calendar",
  "Schedule and manage meetings via Calendly: list event types, check availability, book/cancel meetings, list scheduled events.",
  {
    action: z.enum([
      "get_me", "list_event_types", "check_availability",
      "list_scheduled_events", "book_meeting", "cancel_meeting"
    ]),
    event_type: z.string().optional(),
    start_time: z.string().optional(),
    invitee_name: z.string().optional(),
    invitee_email: z.string().optional(),
    invitee_timezone: z.string().optional(),
    location_kind: z.string().optional(),
    days_from_now: z.number().optional(),
    scheduled_event: z.string().optional(),
    reason: z.string().optional()
  },
  async (args) => {
    const result = await runCalendly(args);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

// Tool 2: Send Email
mcpServer.tool(
  "send_email",
  "Send an internal email to the owner's inbox. Recipient is fixed and never exposed.",
  {
    subject: z.string(),
    body: z.string()
  },
  async (args) => {
    const result = await runSendEmail(args);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);
```

#### 3.2.3 Endpoint Handler

```typescript
// app/api/mcp/route.ts

import { NextRequest } from "next/server";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { mcpServer } from "@/lib/mcp/server";

export async function POST(req: NextRequest) {
  // Validate auth
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  
  const token = auth.slice(7);
  if (token !== process.env.ZAI_API_KEY) {
    return Response.json({ error: "Invalid API key" }, { status: 401 });
  }
  
  // Handle MCP request
  const body = await req.json();
  const transport = new StreamableHTTPServerTransport("/api/mcp");
  
  await mcpServer.connect(transport);
  const response = await transport.handleRequest(req, body);
  
  return response;
}
```

#### 3.2.4 MCP Capabilities

```json
{
  "capabilities": {
    "tools": {
      "listChanged": false
    },
    "resources": {
      "listChanged": false
    },
    "prompts": {
      "listChanged": false
    }
  }
}
```

---

### 3.3 A2A Server (New)

#### 3.3.1 AgentCard

```typescript
// GET /.well-known/agent-card.json

{
  "name": "Frontdesk AI",
  "description": "Personal AI concierge that books meetings, takes messages, and answers questions about its owner.",
  "version": "1.0.0",
  "supportedInterfaces": [{
    "url": "https://<deployed-url>/a2a",
    "protocolBinding": "JSONRPC",
    "protocolVersion": "1.0"
  }],
  "provider": {
    "organization": "Frontdesk AI",
    "url": "https://github.com/tersePrompts/frontdesk-ai"
  },
  "capabilities": {
    "streaming": true,
    "pushNotifications": false,
    "extendedAgentCard": false
  },
  "defaultInputModes": ["text/plain", "application/json"],
  "defaultOutputModes": ["text/plain", "application/json"],
  "skills": [
    {
      "id": "calendar-scheduling",
      "name": "Calendar Scheduling",
      "description": "Books meetings on the owner's Calendly, checks availability, lists event types, and manages scheduled events.",
      "tags": ["calendar", "scheduling", "meetings", "calendly"],
      "examples": [
        "Book a 30-minute meeting with John tomorrow at 2pm",
        "Check availability for next week",
        "Cancel the meeting scheduled for Friday"
      ]
    },
    {
      "id": "message-taking",
      "name": "Message Taking",
      "description": "Takes messages and emails them to the owner's internal inbox. Recipient is never exposed.",
      "tags": ["email", "messaging", "contact"],
      "examples": [
        "Leave a message for the owner about the project update",
        "Send an email reminder about tomorrow's deadline"
      ]
    },
    {
      "id": "general-assistant",
      "name": "General Assistant",
      "description": "Answers questions about the owner, their background, skills, and availability.",
      "tags": ["qa", "information", "assistant"],
      "examples": [
        "What is the owner's experience with AI?",
        "Tell me about the owner's background",
        "What projects has the owner worked on?"
      ]
    }
  ],
  "securitySchemes": {
    "bearerAuth": {
      "httpAuthSecurityScheme": { "scheme": "bearer", "bearerFormat": "API Key" }
    }
  },
  "security": [{ "bearerAuth": [] }]
}
```

#### 3.3.2 JSON-RPC Methods

| Method | Description |
|--------|-------------|
| `SendMessage` | Process message, return completed task (blocking) |
| `SendStreamingMessage` | Process message, stream updates via SSE |
| `GetTask` | Retrieve task by ID |
| `CancelTask` | Cancel a running task |

#### 3.3.3 Task Lifecycle

```
submitted → working → completed
                ↓
            failed / canceled / input-required
```

#### 3.3.4 Request/Response Format

```typescript
// Request
{
  "jsonrpc": "2.0",
  "method": "SendMessage",
  "params": {
    "message": {
      "role": "user",
      "parts": [{ "type": "text", "text": "Book a meeting tomorrow at 2pm" }],
      "contextId": "optional-context",
      "taskId": "optional-task-id"
    },
    "configuration": {
      "acceptedOutputModes": ["text/plain"],
      "returnImmediately": false
    }
  },
  "id": "request-1"
}

// Response
{
  "jsonrpc": "2.0",
  "id": "request-1",
  "result": {
    "id": "task-uuid",
    "contextId": "context-uuid",
    "status": { "state": "completed" },
    "artifacts": [{
      "artifactId": "artifact-uuid",
      "parts": [{ "type": "text", "text": "Meeting booked for tomorrow at 2pm." }],
      "lastChunk": true
    }]
  }
}
```

---

## 4. Shared Tool Interface

All three protocols call the same functions:

```typescript
// Shared interface across protocols
interface ToolExecutor {
  calendar(args: CalendarArgs): Promise<CalendarResult>;
  sendEmail(args: EmailArgs): Promise<EmailResult>;
}

// Calendar actions (from lib/calendly.ts)
type CalendarAction =
  | "get_me"
  | "list_event_types"
  | "check_availability"
  | "list_scheduled_events"
  | "book_meeting"
  | "cancel_meeting";

// Existing functions reused:
// - runCalendly(args)     → lib/calendly.ts
// - runSendEmail(args)    → lib/sendEmail.ts
// - getZaiClient()        → lib/ai.ts
```

---

## 5. Authentication

| Protocol | Auth Method | Key |
|----------|-------------|-----|
| REST API | None (public) | N/A |
| MCP | Bearer token | `ZAI_API_KEY` |
| A2A | Bearer token | `ZAI_API_KEY` |

All three use the same `ZAI_API_KEY` for simplicity. The key is validated in:
- MCP: `Authorization: Bearer <ZAI_API_KEY>` header
- A2A: `Authorization: Bearer <ZAI_API_KEY>` header (via SDK middleware)

---

## 6. Rate Limiting

Reuse existing `lib/rateLimit.ts`:

| Endpoint | Limit | Window |
|----------|-------|--------|
| `POST /api/chat` | 40 req/min/IP | Already exists |
| `POST /api/mcp` | 20 req/min/IP | New |
| `POST /a2a` | 20 req/min/IP | New |
| `POST /api/track` | 24 req/min/IP | Already exists |

---

## 7. Security Headers

Apply to all API endpoints via `next.config.mjs`:

```javascript
{
  source: "/api/:path*",
  headers: [
    { key: "Cache-Control", value: "no-store, max-age=0" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "SAMEORIGIN" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" }
  ]
}
```

Add CORS for MCP/A2A (cross-origin agent access):

```javascript
{
  source: "/(api/mcp|a2a)",
  headers: [
    { key: "Access-Control-Allow-Origin", value: "*" },
    { key: "Access-Control-Allow-Methods", value: "POST, GET, OPTIONS" },
    { key: "Access-Control-Allow-Headers", value: "Content-Type, Authorization" }
  ]
}
```

---

## 8. Environment Variables

```bash
# Existing (required for all protocols)
ZAI_API_KEY=your_zai_key
ZAI_BASE_URL=https://api.z.ai/api/coding/paas/v4
ZAI_MODEL=glm-5.3-flash

# Optional (per protocol)
MCP_ENABLED=true     # Enable MCP endpoint (default: true)
A2A_ENABLED=true     # Enable A2A endpoint (default: true)

# Optional (feature-specific)
CALENDLY_ACCESS_TOKEN=your_calendly_pat
RESEND_API_KEY=re_xxxxxxxx
ASSISTANT_INTERNAL_EMAIL=you@example.com
NTFY_TOPIC=your_topic
```

---

## 9. Implementation Order

### Phase 1: MCP Server (Simpler)

1. Install `@modelcontextprotocol/sdk`
2. Create `lib/mcp/server.ts` - Tool definitions
3. Create `app/api/mcp/route.ts` - Streamable HTTP endpoint
4. Add rate limiting
5. Write tests
6. Update README

### Phase 2: A2A Server (More Complex)

1. Install `@a2a-js/sdk`
2. Create `lib/a2a/types.ts` - Type definitions
3. Create `lib/a2a/executor.ts` - Business logic
4. Create `lib/a2a/store.ts` - Task storage
5. Create `app/.well-known/agent-card.json/route.ts` - Discovery
6. Create `app/a2a/route.ts` - JSON-RPC handler
7. Add rate limiting
8. Write tests
9. Update README

### Phase 3: Integration & Polish

1. Add CORS headers for MCP/A2A
2. Add `MCP_ENABLED`/`A2A_ENABLED` env flags
3. Update `GO_PUBLIC.md` with multi-protocol pitch
4. Create `docs/MULTI_PROTOCOL.md` with usage examples
5. Verify all three protocols work end-to-end

---

## 10. Testing Strategy

### MCP Tests

1. **Tool Discovery**: `POST /api/mcp` with `tools/list` returns calendar + send_email
2. **Tool Execution**: `POST /api/mcp` with `tools/call` executes calendar action
3. **Auth**: Missing/invalid Bearer token returns 401
4. **Rate Limiting**: Exceeding limit returns 429

### A2A Tests

1. **AgentCard**: `GET /.well-known/agent-card.json` returns valid card
2. **SendMessage**: Blocking request returns completed task
3. **SendStreamingMessage**: SSE stream emits status updates + artifacts
4. **GetTask**: Retrieve task by ID
5. **CancelTask**: Cancel running task
6. **Auth**: Missing/invalid Bearer token returns 401
7. **Rate Limiting**: Exceeding limit returns 429

### Integration Tests

1. **Cross-Protocol**: Same calendar action works via REST, MCP, and A2A
2. **Tool Consistency**: All three protocols expose identical tool behavior

---

## 11. Deployment Notes

- MCP/A2A endpoints must be publicly accessible (no Vercel auth)
- Add CORS headers for cross-origin agent access
- Environment variables needed: same as existing + `MCP_ENABLED`, `A2A_ENABLED`
- Consider `MCP_ENABLED=false` / `A2A_ENABLED=false` for users who only want the chat UI

---

## 12. Future Enhancements

1. **MCP Resources**: Expose calendar slots as MCP resources (read-only access)
2. **MCP Prompts**: Expose persona as MCP prompts (reusable system prompts)
3. **A2A Push Notifications**: Webhook support for long-running tasks
4. **A2A Multi-Tenancy**: Support multiple concierge instances via `tenant` field
5. **Persistent Store**: Redis/PostgreSQL for A2A task persistence across deploys
6. **LLM-Based Routing**: Use GLM to parse complex intents (vs keyword matching)

---

## 13. Verification Checklist

### MCP

- [ ] `POST /api/mcp` with `tools/list` returns calendar + send_email
- [ ] `POST /api/mcp` with `tools/call` executes calendar action
- [ ] `POST /api/mcp` with `tools/call` executes send_email action
- [ ] Auth required (Bearer token)
- [ ] Rate limiting applied (20 req/min)
- [ ] Tests pass

### A2A

- [ ] `GET /.well-known/agent-card.json` returns valid AgentCard
- [ ] `POST /a2a` with `SendMessage` returns completed task
- [ ] `POST /a2a` with `SendStreamingMessage` streams status updates
- [ ] `POST /a2a` with `GetTask` retrieves task by ID
- [ ] `POST /a2a` with `CancelTask` cancels running task
- [ ] Auth required (Bearer token)
- [ ] Rate limiting applied (20 req/min)
- [ ] Tests pass

### Integration

- [ ] Same calendar action works via REST, MCP, and A2A
- [ ] README documents all three protocols
- [ ] `GO_PUBLIC.md` updated with multi-protocol pitch
