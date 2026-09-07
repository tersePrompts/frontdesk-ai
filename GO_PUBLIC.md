# Go-Public Plan — Frontdesk AI

Status: **audit done, blockers fixed.** Repo is forkable, privacy-scrubbed, and deploys live with 1 LLM key (Claude, OpenAI, LiteLLM, or Z.ai). What remains is launch activation.

---

## 1. The pitch

**Product:** "One agent core, three protocols." A streaming chat assistant that books your Calendly, emails you messages, notifies you on visits, and answers questions about you — plus **REST chat, an MCP server, and an A2A agent card** on the same ~250-line task core — deployed on Vercel in ~2 steps, keys only, with your choice of LLM provider.

**Hook:** Every personal site's CTA is passive ("email me, I'll reply"). This makes the site a doer: it books meetings, takes messages, and lets other AIs (MCP clients, A2A agents) drive it — without the visitor waiting or you being cc'd. The architecture story is the differentiator: most projects implement chat/MCP/A2A as separate codepaths; this serves one core through all three.

**Who it's for:**
- Founders / freelancers / consultants (their Calendly is the money slot)
- Open-source devs with a GitHub-brand personal site
- Teams evaluating MCP/A2A who need a minimal, readable reference implementation
- Anyone reactionary about a "no-code, no-infra, one-true-repo" AI landing page

**Message arithmetic:**
- `fork → one LLM key (Claude/OpenAI/LiteLLM/Z.ai) → live`
- `LLM chat + Calendly + email + notifs, all open source, free tier everything`
- `REST + MCP + A2A from the same ~250 lines of tools you actually control`
- No vector DB, no infra. One assistant, three protocol doors.

---

## 2. Deploy flow (the 1-2 step contract)

| Step | User does | Repo provides |
| --- | --- | --- |
| 1 | Click Deploy button / fork → Vercel import | README button + badges |
| 2 | Paste an LLM key (Claude/OpenAI/LiteLLM/Z.ai) + optional email/calendar/ntfy | `.env.example` as checklist, friendly runtime errors for missing keys |

**Failure rule:** no key → clear tool error, never a crash, never a silent borrow of the author's inbox/topic. (Fixed in this audit: `sendEmail.ts` / `track/route.ts` no longer fall back to hardcoded personal addresses.)

**3rd step (fun, not required):** "Make it yours" — fill in the `OWNER` block in `lib/persona.ts`, branding env vars, avatar.

---

## 3. Launch checklist

**Repo hygiene (done)**
- [x] No secrets in tracked files; `.env` gitignored; history purged of the old Vercel token on `main`
- [x] No personal-address fallbacks; no hardcoded Vercel project/alias in deploy scripts
- [x] CI (typecheck + 52 tests + build) on push/PR
- [x] Security headers + `no-store` APIs + per-IP rate limits on `/api/chat`, `/api/track`, `/api/mcp`, `/a2a`
- [x] Streaming-render fix (no UI jank under traffic)
- [x] MCP server + A2A agent card (REST chat + MCP + A2A on the same tools)

**Launch assets (TODO)**
- [ ] `public/opengraph-image.jpg` (1200×630) + `public/og` — social cards
- [ ] 15-30s screen-recording GIF of streaming book-a-meeting flow (→ upload to README/thread)
- [ ] Switch a working demo URL into the README install block (your live deploy)
- [ ] Add `vercel.json` (inline runtime config) — only if a deploy hardware constraint shows up
- [x] Write `docs/CUSTOMIZE.md` so "make it yours" is a 10-minute followed checklist (persona, avatar, links, resume, UPI)
- [x] `CONTRIBUTING.md` / `SECURITY.md` / `CODE_OF_CONDUCT.md` in place
- [x] `docs/ARCHITECTURE.md` — "one core, three protocols" explainer (the differentiator devs care about)

**Activation (when you're ready to go public)**
- [ ] Push `main`, land the Deploy button + CI badge on the README (Vercel buttons render on GitHub)
- [ ] Post 1 of these per week, not all at once:
  1. **HN "Show HN"** — title: _Show HN: I open-sourced my AI receptionist (fork, 1 key, live on Vercel)_ — body = the pitch + link. Reply to every comment.
  2. **X/Twitter** — thread: screen recording of a visitor booking a meeting, then the 5-line "how I built it" with stack, link.
  3. **r/SideProject + r/selfhosted** — _Your site's landing page can be a doer._ Same recording.
  4. **LinkedIn** — small post: "I put a Calendly-booking AI on my site. Here's the repo." Tag residency, not spam.
  5. **Product Hunt** — only after traffic proves the hook; invest in the maker-first comments.
- [ ] Ask every adopter one question and log answers → decide the next feature (see roadmap)

---

## 4. Traffic readiness (already shipped)

| Risk | Control |
| --- | --- |
| Abuse of public chat endpoint | 40 chat req/min/IP, 24 track, 20 MCP, 20 A2A (in-memory); MCP+A2A require Bearer key |
| LLM cost run-up | 4096 max tokens, 20 max steps; GLM coding-plan pricing is cheap; add per-day key rotation if it becomes a problem |
| Email quota blown | `send_email` and visit-alerts only fire with `RESEND_API_KEY`; alerts are best-effort |
| Caching leaks/round-trips | `/api/*` → `no-store`; page stays static/prerendered |
| Fork emails strangers | No fallback inbox/topic — a missing key errors, it never borrows yours |
| MCP/A2A accidental exposure | Both require `Authorization: Bearer <a configured provider key>`; kill switches `MCP_ENABLED` / `A2A_ENABLED` |
| Crashes under load | Serverless scale-out; no server state beyond the rate-limit map |

**Watch in week 1:** Vercel hobby concurrency (default), Resend free quota (100/day), rate-limit false positives behind shared NAT IPs (lower to 60/min if so), and any hallucinated tool success (persona asks to narrate; keep an eye in the visit emails + ntfy).

---

## 5. Roadmap (defer — don't build before the first 10 forks)

0. **Multi-protocol polish (shipped)** — REST chat + MCP (`/api/mcp`) + A2A (`/a2a`, Agent Card) on the same `lib/calendly.ts` / `lib/sendEmail.ts` tools. (Note: it's now *with* MCP/A2A, contradicting the earlier "no MCP servers" line — an upgrade, not a compromise.)
1. **SMTP swap** — `lib/sendEmail.ts` interface already thin; offer Resend-default + "bring your own SMTP" via an adapter. Unlocks non-dev adopters.
2. **`vercel.json` clone-env hints** — surface env var prompts directly in Vercel's clone UI for a true 1-step.
3. **Persona-as-file** — load persona from a markdown file (`public/persona.md`?) so adoption = edit one doc, not TS.
4. **Theme/OG polish + template gallery** — the visual bar that makes forkers pick you over a React landing template.
5. **Privacy mode toggle** (public vs private facts) + a `/health` endpoint for uptime monitoring of your own instance.
6. **Document the calendar/email action gate** for the "ask before doing" story — it's the trust feature that sells the fork.
7. **MCP resources/prompts + A2A push notifications** — expose calendar slots as read-only MCP resources, and wire A2A async push for long-running tasks.

---

## Appendix: Enabling CI

&gt; Locked out? GitHub only lets pushable PATs create/update `.github/workflows/` when the token has the **Workflow** scope — a token without it gets a "refusing to allow a Personal Access Token… without `workflow` scope" rejection. The workflow file is already in this repo's working tree (`.github/workflows/ci.yml`, locally untracked); one of the two paths below ships it.

**Path A — push it (needs a workflow-scoped token):**

1. Create a new PAT:
   - Classic: https://github.com/settings/tokens/new → check **workflow** (+ `repo` for a private repo) → Generate.
   - Or, in the token with `workflow` scope only:
2. Push with that token (path is your fork's remote):

   ```bash
   git add .github/workflows/ci.yml
   git commit -m "Add CI: typecheck + tests + build on push/PR"
   git push https://<token>@github.com/tersePrompts/frontdesk-ai.git main
   ```

   (Keep the old token for everything else; you only need `workflow` scope for this file.)

**Path B — GitHub web UI (no token needed):** https://github.com/tersePrompts/frontdesk-ai/new/main/.github/workflows → name it `ci.yml`, paste:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
```

Commit it, then confirm: the README CI badge (https://github.com/tersePrompts/frontdesk-ai/actions/workflows/ci.yml) turns green next run.
