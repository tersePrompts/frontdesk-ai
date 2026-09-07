# Frontdesk AI

> **One agent core. Three protocols. Zero config.** Self-hosted personal AI concierge that books your Calendly, takes messages to your inbox, and answers questions about you — exposed to humans (chat UI), AI tools (MCP), and other agents (A2A) from a single ~250-line tool core.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FtersePrompts%2Ffrontdesk-ai)
[![CI](https://github.com/tersePrompts/frontdesk-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/tersePrompts/frontdesk-ai/actions/workflows/ci.yml)

**Docs** · [Make it yours](docs/CUSTOMIZE.md) · [Architecture](docs/ARCHITECTURE.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Agent protocols — A2A](docs/A2A_PLAN.md)

## Why this exists

Every personal site gets the same CTA: "email me and I'll get back to you." This repo is the upgrade — a streaming AI assistant that *acts* when visitors don't want to wait for a reply. But the real contribution is architectural:

> **The same assistant, three doors in.** A single tool core (`calendar`, `send_email`) served simultaneously as a human chat UI, an MCP server for AI tool clients, and an A2A agent for agent-to-agent delegation. Most projects build these as three separate codepaths; this is a minimal, readable, deployable proof that one core can serve all three.

```
                 ┌──────────────────────────────┐
   Humans ─────▶ │  Chat UI  (POST /api/chat)   │
                 │                              │
  MCP clients ─▶ │  MCP      (POST /api/mcp)    │──▶ ┌───────────────┐
 (Claude, Cursor)│                              │    │    tool core   │──▶ Calendly
                 │                              │    │  calendar      │
    A2A agents ─▶│  A2A      (POST /a2a)        │──▶ │  send_email    │──▶ Email (+ ntfy)
                 └──────────────────────────────┘    └───────────────┘
                    one model, one persona,         ~250 lines, shared by all three
                    one provider key you choose
```

## Deploy in 2 steps

1. **Click Deploy** → [![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FtersePrompts%2Ffrontdesk-ai) (Vercel forks the repo and opens its UI for you).
   - Or: fork on GitHub → Import in [Vercel](https://vercel.com) → same thing.
2. **Add one LLM key** in the Vercel project → Settings → Environment:

   | Key | Provider |
   | --- | --- |
   | `ANTHROPIC_API_KEY` | Claude (recommended default) |
   | `OPENAI_API_KEY` | OpenAI |
   | `LLM_API_KEY` (+ `LLM_BASE_URL`) | LiteLLM proxy or any OpenAI-compatible endpoint |
   | `ZAI_API_KEY` | Z.ai GLM (legacy default) |

   Then optionally:
   - `RESEND_API_KEY` + `ASSISTANT_INTERNAL_EMAIL` + `ASSISTANT_EMAIL_FROM` → take-a-message → email
   - `CALENDLY_ACCESS_TOKEN` → meeting booking
   - `NTFY_TOPIC` → visit push notifications

Hit **Deploy**. Done — the app runs fine with just one LLM key; missing keys disable the feature with a clear error instead of breaking chat.

Every free tier you need: pick your LLM (see [Swap your LLM](#swap-your-llm)), Vercel hobby, Calendly free, Resend free, ntfy.sh free.

## Swap your LLM

Frontdesk AI is provider-agnostic. The first provider with a key configured wins (`lib/ai.ts`):

```bash
# Claude
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-5

# OpenAI
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o

# LiteLLM (or any OpenAI-compatible endpoint — Ollama, vLLM, Groq, Together…)
LLM_API_KEY=...
LLM_BASE_URL=https://your-proxy.example/v1
LLM_MODEL=your-model

# Z.ai GLM (default)
ZAI_API_KEY=...
ZAI_MODEL=glm-5.3-flash
```

No code changes — `lib/persona.ts`, `lib/calendly.ts`, and `lib/sendEmail.ts` are all provider-agnostic.

## Make it yours

A full step-by-step walkthrough (persona, branding, assets, keys, deploy checklist) lives in **[docs/CUSTOMIZE.md → Make it yours — 10-minute checklist](docs/CUSTOMIZE.md)**. Short version:
- **Persona** — edit the `OWNER` object at the top of `lib/persona.ts` (name, bio, links, highlights). This is what the assistant actually knows and follows.
- **Branding** — set `NEXT_PUBLIC_ASSISTANT_NAME` / `NEXT_PUBLIC_ASSISTANT_TAGLINE`, `NEXT_PUBLIC_CONTACT_EMAIL`, `NEXT_PUBLIC_LINKEDIN` / `NEXT_PUBLIC_GITHUB`, `NEXT_PUBLIC_UPI_ID` ("buy me a coffee"), and drop your photo at `public/avatar.jpg` + your CV at `public/resume.pdf`.
- **Keys/config** — everything is env-driven; nothing to fork-edit.

## One assistant, three protocols

The same tools (`lib/calendly.ts`, `lib/sendEmail.ts`) and the same model are exposed three ways. For the full picture of why this design wins and how to add a new capability across all three surfaces, read **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

### 1. Human chat UI (REST)
`POST /api/chat` — the streaming chat on the homepage. Vercel AI SDK `streamText`, multi-step tool use (maxSteps=20), rate-limited 40 req/min/IP. No auth (public).

### 2. MCP server (for AI tool clients)
`POST /api/mcp` — an MCP **Streamable HTTP** server exposing `calendar` and `send_email` as tools. Any MCP client (Claude, Cursor, opencode, etc.) can point at it and book meetings / take messages directly.

```jsonc
// MCP client config (e.g. claude_desktop_config / .mcp.json)
{
  "mcpServers": {
    "concierge": {
      "type": "http",
      "url": "https://<your-app>.vercel.app/api/mcp",
      "headers": { "Authorization": "Bearer <your LLM API key>" }
    }
  }
}
```

Auth: `Authorization: Bearer <any configured provider key>` · rate-limited 20 req/min/IP. `GET /api/mcp` returns a human-readable capability summary.

### 3. A2A agent (for agent-to-agent delegation)
`POST /a2a` — an A2A (**Agent-to-Agent**) JSON-RPC endpoint with streaming. Other AI agents discover it via the Agent Card at `/.well-known/agent-card.json` and delegate full tasks: book a meeting, leave a message, or ask a question.

```bash
# Discover the agent
curl https://<your-app>.vercel.app/.well-known/agent-card.json

# Send a task (blocking)
curl -X POST https://<your-app>.vercel.app/a2a \
  -H "Authorization: Bearer $YOUR_LLM_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "SendMessage",
    "params": { "message": { "role": "user",
      "parts": [{ "type": "text", "text": "Book a 30-minute meeting on Thursday" }] } },
    "id": "req-1"
  }'
```

Auth: `Authorization: Bearer <any configured provider key>` · rate-limited 20 req/min/IP · supports `SendMessage`, `SendStreamingMessage`, `GetTask`, `CancelTask`.

---

## Features

- **Streaming chat** — token-by-token streaming; raw text renders instantly mid-stream, then react-markdown appears once the reply settles (no UI jank).
- **Bring your own LLM** — Claude, OpenAI, LiteLLM/any OpenAI-compatible endpoint, or Z.ai GLM. First key configured wins.
- **Calendly scheduling** — `calendar` tool: list event types, check availability, book an invitee, cancel, confirm account.
- **Take-a-message email** — `send_email` tool delivers to your internal inbox; the envelope address is never exposed and never accepts an external recipient.
- **Two conversation modes** — `Chat` (assistant & peer) and `Recruiter` (CV walkthrough) personas; transcripts persist per-mode in localStorage.
- **Privacy by default** — the persona never reveals your phone or internal email, refuses jailbreak attempts, and collects name + email confirmation before any booking/send.
- **Visitor tracking** — `/api/track` best-effort: ip-api geolocation → ntfy push + email. Never blocks the visitor.

## How it works

```
Visitor
   │  POST /api/chat  {"messages", "mode"}
   ▼
app/api/chat/route.ts         Vercel AI SDK streamText (maxSteps=20)
   │  model: lib/ai.ts (Claude / OpenAI / LiteLLM / Z.ai)   rate-limit: 40 req/min/IP
   │  tools: calendar · send_email          (Zod-validated)
   ▼
lib/calendly.ts   ── CALENDLY_ACCESS_TOKEN ──> Calendly API
lib/sendEmail.ts  ── RESEND_API_KEY        ──> Resend API
```

`lib/persona.ts` supplies the persona + guardrails; the chat route sanitizes replayed tool-call history so `streamText` never chokes on a tool invocation missing its result.

## Tech stack

Next.js 15 (App Router, React 19, TypeScript) · Vercel AI SDK v4 · Claude / OpenAI / LiteLLM / Z.ai GLM (provider-agnostic) · Calendly API · Resend · ntfy.sh · react-markdown + remark-gfm · Vitest + jsdom + Testing Library · GitHub Actions · `@modelcontextprotocol/sdk` (MCP) · `@a2a-js/sdk` (A2A).

## Developing

```bash
npm install
cp .env.example .env   # add your keys
npm run dev            # http://localhost:3000
```

| Script | What it does |
| --- | --- |
| `npm run dev` | dev server |
| `npm run build` / `npm run start` | production build / serve |
| `npm run typecheck` | `tsc --noEmit` (includes test files) |
| `npm test` | Vitest suite |

### Configuration

Full reference in `.env.example`:

| Variable | Required | Purpose |
| --- | --- | --- |
| `ZAI_API_KEY` | _or one below_ | Z.ai GLM API key (legacy default) |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | _or one above_ | OpenAI |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | _or one above_ | Anthropic Claude |
| `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` | _or one above_ | LiteLLM / OpenAI-compatible |
| `RESEND_API_KEY` | email | Resend API key — https://resend.com/api-keys |
| `ASSISTANT_INTERNAL_EMAIL` | email | Inbox the assistant emails messages and visit alerts to |
| `ASSISTANT_EMAIL_FROM` | email | Verified sender, e.g. `Concierge <onboarding@resend.dev>` |
| `CALENDLY_ACCESS_TOKEN` | calendar | Calendly PAT — https://calendly.com/integrations/api_webhooks |
| `NTFY_TOPIC` | alerts | ntfy.sh topic for push notifications |
| `NEXT_PUBLIC_ASSISTANT_NAME` / `NEXT_PUBLIC_ASSISTANT_TAGLINE` | branding | Header title / tagline |
| `NEXT_PUBLIC_CONTACT_EMAIL` / `NEXT_PUBLIC_LINKEDIN` / `NEXT_PUBLIC_GITHUB` | branding | Header contact links |
| `NEXT_PUBLIC_UPI_ID` | branding | "Buy me a coffee" UPI id (empty hides the button) |
| `NEXT_PUBLIC_SITE_URL` | branding | Fallback origin for the copied agent set-up |
| `ASSISTANT_NAME` / `ASSISTANT_TAGLINE` | metadata | `<title>` / meta description |
| `ASSISTANT_TIMEZONE` | optional | IANA timezone for availability display |
| `MCP_ENABLED` / `A2A_ENABLED` | optional | Feature flags (default: enabled) |
| `VERCEL_TOKEN` / `VERCEL_PROJECT_ID` | deploy scripts | See below |

## Deploying

`deploy.sh` (macOS/Linux) and `deploy.ps1` (Windows) each run a local build check, deploy `--prod` to Vercel, and report the deployment state. They temporarily hide `.git` during the deploy as a workaround for Vercel's seat-verification block, then restore it. Both resolve the project for status reporting from `VERCEL_PROJECT_ID` or `.vercel/project.json` (from `vercel link`); set your env vars in the Vercel dashboard regardless.

```bash
export VERCEL_TOKEN="<your token>"
./deploy.sh
```

## Testing

Vitest tests cover the Calendly tool (booking, availability, cancellation), the email tool (env gating, ntfy best-effort), persona safety rules, `/api/track`, the chat UI streaming-render behavior (raw text while streaming, markdown on settle, localStorage only when idle), the MCP server (tool listing + execution through the SDK's in-memory transport), and the A2A agent (Agent Card shape, intent routing, executor event lifecycle).

## Project structure

```
app/
  api/
    chat/route.ts     streaming chat (tools + model + rate limit)
    mcp/route.ts      MCP Streamable HTTP server (calendar + send_email tools)
    track/route.ts    visitor tracking (ntfy push + email, best-effort)
  a2a/route.ts        A2A JSON-RPC endpoint (send/get/cancel task, streaming)
  .well-known/agent-card.json/route.ts  A2A Agent Card discovery
  page.tsx            chat UI (modes, streaming render, localStorage)
  Markdown.tsx        react-markdown wrapper
lib/
  ai.ts               provider-agnostic model factory (Claude/OpenAI/LiteLLM/Z.ai)
  calendly.ts         Calendly API wrapper (book/cancel/availability)
  sendEmail.ts        Resend email wrapper
  mcp/server.ts       MCP tool registry (calendar, send_email)
  a2a/executor.ts     A2A agent executor + intent routing
  a2a/types.ts        A2A Agent Card definition
  persona.ts          persona + privacy guardrails (editor-friendly template)
  rateLimit.ts        in-memory per-IP rate limiter
*.test.ts / *.test.tsx    Vitest suites
.github/workflows/ci.yml  typecheck + tests + build on push/PR
deploy.ps1 / deploy.sh    Vercel production deploy scripts
```

## FAQ

**Do I need to be a developer to set this up?**
No. Deploy-to-Vercel, add one LLM key, edit `OWNER` in `lib/persona.ts` and a few branding env vars. The [10-minute checklist](docs/CUSTOMIZE.md) covers it end-to-end. Editing `lib/persona.ts` is plain text — no framework knowledge required.

**Which model should I pick?**
Whatever you already have a key for — Claude, OpenAI, LiteLLM (which also fronts Groq, Ollama, vLLM, Together, custom endpoints), or Z.ai GLM. Claude is a good default for concierge-style tool use. You can switch later without code changes.

**Does this cost money?**
The app itself runs on Vercel's free hobby tier. All integrations (Calendly, Resend, ntfy.sh) have free tiers. You pay for LLM tokens — a personal site's chat traffic is pennies to a couple of dollars a month depending on the model.

**Is it safe to expose on a public site?**
The persona never reveals your phone or internal email, refuses jailbreak attempts, and collects name+email confirmation before any booking or send. Email always routes to your internal inbox (never an external recipient), rate limits apply per IP, and MCP/A2A endpoints additionally require the bearer key. See [SECURITY.md](SECURITY.md).

**What's the difference between the three doors (chat / MCP / A2A)?**
The chat UI is for humans visiting your site. MCP is for AI tool clients (Claude, Cursor, opencode) that want to call `calendar` / `send_email` as tools. A2A is for other AI agents to hand you a whole task end-to-end. Same tools, same model, three protocols — see [ARCHITECTURE.md](docs/ARCHITECTURE.md).

**Do I need a Calendly/Resend account just to try it?**
No. The app runs with one LLM key alone. Missing integration keys disable that feature with a clear error instead of breaking chat.

**Can I extend it with my own tools?**
Yes. Add a `lib/yourTool.ts` with an env-gated `run()` function, register it as a chat tool, an MCP tool, and an A2A route case — [ARCHITECTURE.md#requirements-for-adding-a-capability](docs/ARCHITECTURE.md#requirements-for-adding-a-capability) spells it out.

## Security notes

- Credentials live only in `.env` (gitignored); `.env.example` ships placeholders. `sendEmail.ts` and `track/route.ts` never fall back to a hardcoded inbox/topic — a misconfigured fork fails loudly instead of emailing the original author's address.
- `/api/*` is set to `no-store`; security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`) are applied site-wide.
- Rate limits: `/api/chat` (40/min/IP), `/api/track` (24/min/IP), `/api/mcp` (20/min/IP), `/a2a` (20/min/IP).
- MCP and A2A require `Authorization: Bearer <a configured provider key>`; the chat UI is intentionally public.
- The persona never reveals your phone or internal email, and refuses jailbreak attempts.
- `react-markdown` renders without `rehype-raw`, so raw HTML in model output is inert.
- Visit/push/email integrations are best-effort by design — failures never block the visitor's response.

## License

MIT
