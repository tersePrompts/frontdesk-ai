import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { runSendEmail as RunSendEmail } from "./sendEmail";

const sendMock = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

type SendFn = typeof RunSendEmail;

async function loadSendEmail(): Promise<SendFn> {
  // sendEmail.ts captures env-derived consts at module load, so re-import it
  // after each env setup.
  vi.resetModules();
  return (await import("./sendEmail")).runSendEmail;
}

describe("runSendEmail", () => {
  beforeEach(() => {
    process.env.RESEND_API_KEY = "re_testkey";
    process.env.ASSISTANT_INTERNAL_EMAIL = "owner@internal.example";
    process.env.ASSISTANT_EMAIL_FROM = "Concierge <onboarding@resend.dev>";
    process.env.NTFY_TOPIC = "test-topic";
    sendMock.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
  });

  afterEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.ASSISTANT_INTERNAL_EMAIL;
    delete process.env.ASSISTANT_EMAIL_FROM;
    delete process.env.NTFY_TOPIC;
    vi.unstubAllGlobals();
  });

  it("returns an error when RESEND_API_KEY is missing", async () => {
    const runSendEmail = await loadSendEmail();
    delete process.env.RESEND_API_KEY;
    const result = await runSendEmail({ subject: "Hi", body: "Body" });
    expect(result.error).toMatch(/RESEND_API_KEY is not set/);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("returns an error when ASSISTANT_INTERNAL_EMAIL is unset (no fallback inbox)", async () => {
    delete process.env.ASSISTANT_INTERNAL_EMAIL;
    const runSendEmail = await loadSendEmail();
    const result = await runSendEmail({ subject: "Hi", body: "Body" });
    expect(result.error).toMatch(/ASSISTANT_INTERNAL_EMAIL is not set/);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("returns an error when ASSISTANT_EMAIL_FROM is unset", async () => {
    delete process.env.ASSISTANT_EMAIL_FROM;
    const runSendEmail = await loadSendEmail();
    const result = await runSendEmail({ subject: "Hi", body: "Body" });
    expect(result.error).toMatch(/ASSISTANT_EMAIL_FROM is not set/);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("returns an error when subject or body is missing", async () => {
    const runSendEmail = await loadSendEmail();
    const noSubject = await runSendEmail({ body: "Body" });
    expect(noSubject.error).toMatch(/subject/);

    const noBody = await runSendEmail({ subject: "Hi" });
    expect(noBody.error).toMatch(/body/);

    expect(sendMock).not.toHaveBeenCalled();
  });

  it("always delivers to the internal inbox and confirms without exposing the address", async () => {
    const runSendEmail = await loadSendEmail();
    sendMock.mockResolvedValue({ data: { id: "email_123" }, error: null });

    const result = await runSendEmail({
      subject: "Message for the owner",
      body: "Deal confirmed for Friday",
    });

    expect(result).toEqual({
      sent: true,
      id: "email_123",
      subject: "Message for the owner",
    });
    const sendArgs = sendMock.mock.calls[0][0];
    expect(sendArgs.to).toEqual(["owner@internal.example"]);
    expect(sendArgs.subject).toBe("Message for the owner");
    expect(sendArgs.text).toBe("Deal confirmed for Friday");
    // The envelope must never reveal the internal inbox to the assistant result.
    expect(JSON.stringify(result)).not.toContain("internal.example");
  });

  it("surfaces a Resend API error", async () => {
    const runSendEmail = await loadSendEmail();
    sendMock.mockResolvedValue({
      data: null,
      error: new Error("invalid api key"),
    });

    const result = await runSendEmail({ subject: "Hi", body: "Body" });
    expect(result.error).toMatch(/invalid api key/);
    expect(result.sent).toBeUndefined();
  });

  it("pushes a copy to ntfy best-effort without blocking the send", async () => {
    const runSendEmail = await loadSendEmail();
    // ntfy fetch hangs then fails; send must still succeed.
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    sendMock.mockResolvedValue({ data: { id: "email_2" }, error: null });

    const result = await runSendEmail({ subject: "Hi", body: "Body" });
    expect(result.sent).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("ntfy.sh/"),
      expect.objectContaining({ method: "POST" })
    );
  });

  it("skips the ntfy push entirely when NTFY_TOPIC is unset", async () => {
    delete process.env.NTFY_TOPIC;
    const runSendEmail = await loadSendEmail();
    sendMock.mockResolvedValue({ data: { id: "email_3" }, error: null });

    const result = await runSendEmail({ subject: "Hi", body: "Body" });
    expect(result.sent).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});