import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import Chat from "./page";

const useChatMock = vi.hoisted(() => vi.fn());

vi.mock("@ai-sdk/react", () => ({
  useChat: (...args: unknown[]) => useChatMock(...args),
}));

const baseChatState = {
  setMessages: vi.fn(),
  sendMessage: vi.fn(),
};

function assistantMessage(text: string) {
  return {
    id: "a1",
    role: "assistant",
    content: text,
    parts: [{ type: "text", text }],
  };
}

function renderWith(state: Partial<typeof baseChatState> & { messages: unknown[]; status: string }) {
  useChatMock.mockReturnValue({ ...baseChatState, ...state });
  return render(<Chat />);
}

describe("Chat streaming render", () => {
  let setItemSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    // jsdom does not implement scrollIntoView; the auto-scroll effect calls it.
    Element.prototype.scrollIntoView = vi.fn();
    Object.defineProperty(navigator, "sendBeacon", {
      value: vi.fn(() => true),
      configurable: true,
    });
  });

  afterEach(() => {
    setItemSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it("renders the streaming assistant text as raw text (no markdown <p>) while busy", () => {
    const { container } = renderWith({
      status: "streaming",
      messages: [
        { id: "u1", role: "user", content: "hi", parts: [] },
        assistantMessage("Hello **world**"),
      ],
    });

    // Raw text is present verbatim (asterisks unprocessed) and no markdown
    // <p> was produced while streaming.
    expect(container.textContent).toContain("Hello **world**");
    expect(container.querySelector("p")).toBeNull();
  });

  it("renders markdown (<p>) once the stream has settled", () => {
    const { container } = renderWith({
      status: "ready",
      messages: [
        { id: "u1", role: "user", content: "hi", parts: [] },
        assistantMessage("Hello **world**"),
      ],
    });

    // react-markdown strips the ** and wraps in <p><strong>world</strong></p>.
    const el = container.querySelector("p");
    expect(el).not.toBeNull();
    expect(el?.textContent).toBe("Hello world");
  });

  it("does NOT write the transcript to localStorage while streaming", () => {
    renderWith({
      status: "streaming",
      messages: [
        { id: "u1", role: "user", content: "hi", parts: [] },
        assistantMessage("Still typing..."),
      ],
    });

    const chatWrites = setItemSpy.mock.calls.filter(
      (c: string[]) => c[0] === "concierge-chat-friendly"
    );
    expect(chatWrites).toHaveLength(0);
  });

  it("persists the transcript to localStorage once the stream settles", () => {
    const { rerender } = renderWith({
      status: "streaming",
      messages: [
        { id: "u1", role: "user", content: "hi", parts: [] },
        assistantMessage("Done now."),
      ],
    });

    expect(
      setItemSpy.mock.calls.filter((c: string[]) => c[0] === "concierge-chat-friendly")
    ).toHaveLength(0);

    useChatMock.mockReturnValue({
      ...baseChatState,
      status: "ready",
      messages: [
        { id: "u1", role: "user", content: "hi", parts: [] },
        assistantMessage("Done now."),
      ],
    });
    rerender(<Chat />);

    const chatWrites = setItemSpy.mock.calls.filter(
      (c: string[]) => c[0] === "concierge-chat-friendly"
    );
    expect(chatWrites.length).toBeGreaterThan(0);
    const saved = JSON.parse(String(chatWrites[chatWrites.length - 1][1]));
    expect(saved.map((m: { role: string }) => m.role)).toEqual(["user", "assistant"]);
  });
});
