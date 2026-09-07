# Make it yours — 10-minute checklist

Once it's deployed, turn the stock template into *your* assistant. Everything here is env-driven or one-file edits — no fork surgery required.

Estimated time: **~10 minutes** for the essentials.

---

## 1. Your persona (the "brain") — 5 min

Edit the `OWNER` object at the top of **`lib/persona.ts`**. This is the single most important edit — it's everything the assistant actually knows about you.

```ts
const OWNER = {
  name: "Alex Example",
  title: "Founder & AI Engineer",
  publicEmail: "you@example.com",
  publicLinks: ["https://linkedin.com/in/you", "https://github.com/you"],
  resumeUrl: "/resume.pdf",
  about: "Your bio — what the assistant answers questions from.",
  skills: "Your tech stack and areas of expertise.",
  highlights: [
    "A concrete achievement",
    "A second durable result",
    "Anything you showcase on your site",
  ],
};
```

Tips:
- **`about`** feeds every answer about you. Write it in full sentences — the model reads it directly.
- **`highlights`** become the bullets the Recruiter persona leads with. Make them specific and quantified ("cut onboarding 60%") not vague ("great at AI").
- The guardrails (never reveal phone/private email, no jailbreaks, collect name+email before any action) are hard-coded below the `OWNER` object. Leave them alone — they're what make the assistant safe on a public site.
- `recruiterPrompt` and `aiPeerPrompt` reference `OWNER`. Fill in the recruiter facts (notice period, comp, locations) in that section if you plan to use Recruiter Mode.

## 2. Branding — 3 min (all env vars)

Set these in your Vercel project → Settings → Environment Variables (or `.env` locally):

| Variable | What it controls |
| --- | --- |
| `NEXT_PUBLIC_ASSISTANT_NAME` | Header name + title tag |
| `NEXT_PUBLIC_ASSISTANT_TAGLINE` | Headline under your name |
| `NEXT_PUBLIC_CONTACT_EMAIL` | The `mailto:` link in the header |
| `NEXT_PUBLIC_LINKEDIN` | LinkedIn link (empty = hidden) |
| `NEXT_PUBLIC_GITHUB` | GitHub link (empty = hidden) |
| `NEXT_PUBLIC_UPI_ID` | "Buy me a coffee" button — a UPI id like `you@upi`. Empty = button hidden. |
| `NEXT_PUBLIC_SITE_URL` | Your live URL, used as the fallback origin in the "Copy agent set-up" guide |
| `ASSISTANT_NAME` / `ASSISTANT_TAGLINE` | `<title>` + meta description (server-rendered) |

`NEXT_PUBLIC_*` vars are inlined into the client at build time — after changing them in Vercel, trigger a new deployment (a push or the Redeploy button).

## 3. Assets — 1 min

- **Photo**: drop your picture at `public/avatar.jpg` (the header avatar).
- **Resume/CV**: replace `public/resume.pdf`.

## 4. Keys (if you want the extras)

Already added an LLM key? Good — chat works. Add these only when you want the corresponding feature:

| Key | Feature |
| --- | --- |
| `CALENDLY_ACCESS_TOKEN` | Meeting booking. Create a Personal Access Token at https://calendly.com/integrations/api_webhooks |
| `RESEND_API_KEY` + `ASSISTANT_INTERNAL_EMAIL` + `ASSISTANT_EMAIL_FROM` | Take-a-message → email + visit alerts |
| `NTFY_TOPIC` | Visit push notifications (ntfy.sh, free, no auth) |

Missing keys fail **loudly but safely**: the tool returns a clear error, nothing crashes, and nothing silently emails the template author's inbox.

## 5. Deploy

```bash
git add -A && git commit -m "Make it mine" && git push
```

Vercel auto-deploys on push. Or hit **Redeploy** in the dashboard.

---

## Checklist

- [ ] `lib/persona.ts` → `OWNER` filled in (name, bio, links, highlights)
- [ ] Recruiter facts filled in (if you use Recruiter Mode)
- [ ] `NEXT_PUBLIC_ASSISTANT_NAME` / `NEXT_PUBLIC_ASSISTANT_TAGLINE` set
- [ ] `NEXT_PUBLIC_CONTACT_EMAIL` set
- [ ] `NEXT_PUBLIC_UPI_ID` set or intentionally left empty
- [ ] `public/avatar.jpg` replaced
- [ ] `public/resume.pdf` replaced
- [ ] Redeployed so `NEXT_PUBLIC_*` changes take effect
- [ ] From your site: send a chat message, ask for your phone number (it should refuse), book a meeting if you configured Calendly