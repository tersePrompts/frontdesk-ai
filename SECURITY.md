# Security Policy

## Reporting a vulnerability

This project is a template for personal sites, but it still exposes public endpoints (`/api/chat`, `/api/track`, and authenticated `/api/mcp`, `/a2a`). If you find a vulnerability, please report it privately rather than opening a public issue.

**Do not** open a public GitHub issue for security bugs.

- **Report via GitHub private vulnerability reporting** on the repo (Security → Report a vulnerability), or
- **Email the maintainers** at the address listed on the repository's GitHub profile.

Please include:
- A description of the bug and its impact.
- Steps to reproduce (minimal).
- Affected endpoints/config.
- Optional: a suggested fix.

You'll get an acknowledgment within a few days. We'll keep you updated as the issue is assessed and fixed, and credit you (if you want) once a fix ships.

## Security model at a glance

| Surface | Auth | Rate limit |
| --- | --- | --- |
| `POST /api/chat` | public (intentional) | 40 req/min/IP |
| `POST /api/track` | public (intentional) | 24 req/min/IP |
| `POST /api/mcp` | `Authorization: Bearer <provider key>` | 20 req/min/IP |
| `POST /a2a` | `Authorization: Bearer <provider key>` | 20 req/min/IP |

## Hardening checklist for your fork

- **Never commit `.env`** — it is gitignored. `.env.example` ships placeholders only.
- **Set a real LLM key** — chat needs one provider key; without it, MCP/A2A have no valid bearer token and the chat route errors loudly.
- **Internal email is never exposed to users** — `sendEmail.ts` always delivers to `ASSISTANT_INTERNAL_EMAIL` and never returns the address in results. Keep it that way in forks.
- **Keep the persona guardrails** — `lib/persona.ts` refuses to reveal phone/internal email and blocks jailbreaks. If you relax them, you accept the exposure.
- **Rate limits** are in-memory per instance — fine for a personal site, not a defense against distributed abuse. If you expect heavy traffic, put the app behind a real WAF or a shared rate-limiter.
- **Markdown rendering is inert** — `react-markdown` runs without `rehype-raw`, so model HTML output can't inject scripts. Don't add raw-HTML rendering without an allow-list.

## Scope

In scope: the code in this repository. Out of scope: your Vercel account, API keys, Calendly/Resend/ntfy credentials, and any deployed fork you don't control.

## Supported versions

Only the `main` branch is supported. We generally won't backport fixes to release branches.