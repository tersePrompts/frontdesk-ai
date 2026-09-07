# Contributing to Frontdesk AI

Thanks for considering a contribution. This project is small on purpose — it stays readable so anyone can fork it and make it theirs. Keep contributions in that spirit.

## Ground rules

- **Small, focused PRs.** One thing per PR. If a change touches more than one surface (chat + MCP + A2A), say that in the description — that's usually a sign we should split it.
- **No personal data.** This repo is a public template. Never add a hardcoded email, phone, URL, or UPI id. Everything owner-specific belongs in `lib/persona.ts` or env vars.
- **All three protocols stay in sync.** The point of this project is that `calendar` and `send_email` serve chat, MCP, *and* A2A from one core. A new capability must be reachable from all three surfaces, or it doesn't land.
- **Tests or it didn't happen.** The suite covers every tool and route. New behavior ships with tests, and the full suite stays green.

## Getting started

```bash
git clone https://github.com/tersePrompts/frontdesk-ai.git
cd frontdesk-ai
npm install
cp .env.example .env   # add any LLM key (see README)
npm run dev            # http://localhost:3000
```

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | dev server |
| `npm run typecheck` | `tsc --noEmit` (includes tests) |
| `npm test` | Vitest suite |
| `npm run build` | production build |

CI runs all three on every PR. Run them locally before pushing.

## Where things live

| Path | What it is |
| --- | --- |
| `lib/ai.ts` | provider-agnostic model factory (Claude / OpenAI / LiteLLM / Z.ai) |
| `lib/persona.ts` | persona template + privacy guardrails (the "make it yours" file) |
| `lib/calendly.ts` | Calendly tool core — the single source of calendar behavior |
| `lib/sendEmail.ts` | email tool core |
| `app/api/chat/route.ts` | human chat surface (streamText + tools) |
| `lib/mcp/server.ts` + `app/api/mcp/route.ts` | MCP surface |
| `lib/a2a/*` + `app/a2a/route.ts` | A2A surface |
| `lib/rateLimit.ts` | shared in-memory per-IP rate limiter |

The architecture doc — `docs/ARCHITECTURE.md` — explains how the tool core maps to all three surfaces. Read it before touching a route.

## Making a change

1. Fork + branch: `git checkout -b feat/your-change`
2. Make the change, add/adjust tests.
3. `npm run typecheck && npm test`.
4. Commit with a clear message (see the repo's existing history for style — e.g. `feat:`, `fix:`, `test:`).
5. Push and open a PR against `main`.

## Review

PRs get a quick pass. Expect feedback on: protocol parity (does MCP/A2A get the change too?), env gating (does it fail loudly without keys?), and test coverage. Be kind; it's a small project.

## Docs

User-facing changes should update the README. New concepts that touch multiple surfaces belong in `docs/ARCHITECTURE.md`. Branding/persona guidance lives in `docs/CUSTOMIZE.md`.
