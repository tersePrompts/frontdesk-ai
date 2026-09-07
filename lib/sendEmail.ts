import { Resend } from "resend";

export interface SendEmailResult {
  sent?: boolean;
  id?: string | null;
  subject?: string;
  error?: string;
}

// Internal inbox for the assistant. Messages sent via this integration are
// always delivered here; this address is never shown to chat users. A
// misconfigured fork must fail loudly rather than silently email a hardcoded
// fallback, so there is no default.
const INTERNAL_INBOX = process.env.ASSISTANT_INTERNAL_EMAIL ?? "";

// Public ntfy.sh topic used for push notifications. Optional: when unset, no
// push is sent (no hardcoded default topic).
const NTFY_TOPIC = process.env.NTFY_TOPIC ?? "";
const NTFY_URL = NTFY_TOPIC ? `https://ntfy.sh/${NTFY_TOPIC}` : "";

async function publishToNtfy(message: string): Promise<void> {
  if (!NTFY_URL) return;
  try {
    await fetch(NTFY_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: message,
    });
  } catch {
    // Best-effort: a failed push must never block the primary email send.
  }
}

export async function runSendEmail(
  args: Record<string, unknown>
): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { error: "RESEND_API_KEY is not set. Configure it to send email." };
  }
  if (!INTERNAL_INBOX) {
    return {
      error:
        "ASSISTANT_INTERNAL_EMAIL is not set. Configure the inbox that messages are delivered to.",
    };
  }
  const defaultFrom = process.env.ASSISTANT_EMAIL_FROM ?? "";
  if (!defaultFrom) {
    return {
      error:
        "ASSISTANT_EMAIL_FROM is not set. Configure a sender address verified in Resend, e.g. \"Concierge <onboarding@resend.dev>\".",
    };
  }
  const resend = new Resend(apiKey);

  const subject = String(args.subject ?? "").trim();
  const body = String(args.body ?? "").trim();

  if (!subject) return { error: "`subject` is required." };
  if (!body) return { error: "`body` is required." };

  // Always deliver to the configured internal inbox. Never accept an external
  // recipient or expose this address to the chat user.
  const recipients = [INTERNAL_INBOX];

  const { data, error } = await resend.emails.send({
    from: defaultFrom,
    to: recipients,
    subject,
    text: body,
  });

  // Also push a copy to the ntfy.sh topic (best-effort, never blocks email).
  await publishToNtfy(`${subject}\n\n${body}`);

  if (error) {
    return { error: error.message };
  }

  return {
    sent: true,
    id: data?.id ?? null,
    subject,
  };
}
