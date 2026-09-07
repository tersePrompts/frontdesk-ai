# Architecture — one tool core, three protocols

Frontdesk AI's whole point is that **one assistant core is exposed three ways with zero duplication**. Most projects build a chat UI, an MCP server, and an A2A agent as three separate codebases. This repo shows they can be three thin shells over the same ~250 lines of tool code.

```
                    ┌───────────────────────────────────────────┐
  HUMAN             │  POST /api/chat  ── chat surface          │
  visitor ────────▶ │    Vercel AI SDK streamText + tools       │
                    │                                           │
  MCP CLIENT        │  POST /api/mcp  ── MCP surface            │        ┌──────────────────┐
  (Claude, Cursor) ─▶    MCP Streamable HTTP transport          │──────▶ │   TOOL CORE       │
                    │                                           │        │  lib/calendly.ts  │──▶ Calendly API
                    │                                           │        │  lib/sendEmail.ts │──▶ Resend + ntfy
  A2A AGENT         │  POST /a2a  ── A2A surface                │        └──────────────────┘
  (JSON-RPC, SSE) ─▶│    DefaultRequestHandler + executor       │
                    └───────────────────────────────────────────┘
                        one model (lib/ai.ts) · one persona (lib/persona.ts)
```

## The tool core

Two protocol-agnostic functions do all the real work:

- **`lib/calendly.ts`** → `runCalendly({ action, ...args })` — wraps the Calendly REST API. Six actions: `get_me`, `list_event_types`, `check_availability`, `list_scheduled_events`, `book_meeting`, `cancel_meeting`.
- **`lib/sendEmail.ts`** → `runSendEmail({ subject, body })` — wraps Resend + ntfy. Recipient is always `ASSISTANT_INTERNAL_EMAIL` and the address is never returned to a caller.

They know nothing about chat, MCP, or A2A. They take plain arguments and return plain JSON. That's the contract that lets one core serve three shells.

## The three shells

### 1. Chat surface — `app/api/chat/route.ts`

The human path. Uses the Vercel AI SDK's `streamText` with `maxSteps: 20`, registering `calendar` and `send_email` as Zod-validated tools.

```
POST /api/chat  { messages, mode }
   │
   ▼  streamText({ model: getModel(), system: getSystemPrompt(mode) })
   │       tools: { calendar ← runCalendly, send_email ← runSendEmail }
   ▼
   delta stream → client UI
```

- No auth (public site, rate-limited 40 req/min/IP).
- The persona (`lib/persona.ts`) selects the mode: `friendly` (default), `recruiter`, `aipeer`.
- Tool-call history from the client is sanitized before replay so `streamText` never sees a tool invocation without a result.

### 2. MCP surface — `lib/mcp/server.ts` + `app/api/mcp/route.ts`

Registers the *same* tools on an MCP server via `server.tool("calendar", ...)` and `server.tool("send_email", ...)`, served over MCP Streamable HTTP (`WebStandardStreamableHTTPServerTransport`).

```
POST /api/mcp   (Authorization: Bearer <provider key>)
   │
   ▼  MCP JSON-RPC: tools/list → tools/call
   │       calendar   ← runCalendly
   │       send_email ← runSendEmail
   ▼
   JSON-RPC response
```

- `GET /api/mcp` returns a human-readable capability summary for browser checks.
- Requires the deployed LLM key as the bearer token; rate-limited 20 req/min/IP. Kill switch `MCP_ENABLED=false`.

### 3. A2A surface — `lib/a2a/*` + `app/a2a/route.ts`

Implements the Google A2A (Agent2Agent) protocol. Discoverable via the **Agent Card** at `/.well-known/agent-card.json`, which advertises three skills: `calendar-scheduling`, `message-taking`, `general-assistant`.

```
Agent card                JSON-RPC endpoint
 GET /.well-known/        POST /a2a  (Bearer)
 agent-card.json               │
      │                        ▼  SendMessage / SendStreamingMessage
      ▼                   DefaultRequestHandler + InMemoryTaskStore
  skills ─────────────────▶  conciergeExecutor  ─▶ runCalendly / runSendEmail
                                 │  event bus: task → artifactUpdate → statusUpdate
                                 ▼
                        JSON response or SSE stream
```

The **executor** (`lib/a2a/executor.ts`) routes intent by keyword: calendar words → `runCalendly`, message words → `runSendEmail`, anything else → a `generateText` LLM call. It publishes task lifecycle events (`WORKING → COMPLETED/FAILED/CANCELED`).

- Requires the deployed LLM key as the bearer token; rate-limited 20 req/min/IP. Kill switch `A2A_ENABLED=false`.

## Shared plumbing

| Concern | Where | Notes |
| --- | --- | --- |
| Model choice | `lib/ai.ts` | First configured key wins: Anthropic → OpenAI → LiteLLM → Z.ai |
| Persona | `lib/persona.ts` | `OWNER` template + guardrails shared by all modes |
| Rate limiting | `lib/rateLimit.ts` | In-memory fixed-window per-IP, different limits per endpoint |
| Env gating | `lib/sendEmail.ts`, routes | Missing keys → clear error, never a crash, never a fallback inbox |

## Why this design

- **One place to add behavior.** A new tool (e.g. `read_todos`) is one `runX()` function + one registration in `lib/mcp/server.ts` + one tool in the chat route + one route case in the A2A executor.
- **One model, one persona.** All three surfaces answer with the same model and the same facts about you. An MCP client and a visitor get the same assistant.
- **Protocols are thin.** Most of the complexity lives in the SDKs (`@modelcontextprotocol/sdk`, `@a2a-js/sdk`), not in this repo — which is exactly why the repo stays readable.

## Requirements for adding a capability

1. It lives in the tool core (`lib/`), protocol-agnostic.
2. It fails loudly and safely when its env keys are missing.
3. It's reachable from all three surfaces (chat tool, MCP tool, A2A route/executor) — parity is a feature, not an accident.
4. It ships with tests in the Vitest suite.