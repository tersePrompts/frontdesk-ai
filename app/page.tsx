"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useRef, useState } from "react";
import styles from "./page.module.css";
import Markdown from "./Markdown";

type Mode = "friendly" | "recruiter";

const MODES: Record<
  Mode,
  { emoji: string; label: string; sub: string; placeholder: string }
> = {
  friendly: {
    emoji: "💬",
    label: "Chat",
    sub: "Assistant & peer",
    placeholder: "Ask anything — e.g. can I book a 30-min call?",
  },
  recruiter: {
    emoji: "🎯",
    label: "Recruiter",
    sub: "CV walkthrough",
    placeholder: "Why is this a good fit for the role I'm hiring for?",
  },
};

const COFFEE_UPI = process.env.NEXT_PUBLIC_UPI_ID
  ? `upi://pay?pa=${process.env.NEXT_PUBLIC_UPI_ID}&am=100&cu=INR&tn=Buy%20a%20coffee`
  : "";

const BRAND = {
  name: process.env.NEXT_PUBLIC_ASSISTANT_NAME ?? "Frontdesk AI",
  title: process.env.NEXT_PUBLIC_ASSISTANT_TAGLINE ?? "Personal AI assistant",
  publicEmail: process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "you@example.com",
  linkedin: process.env.NEXT_PUBLIC_LINKEDIN ?? "",
  github: process.env.NEXT_PUBLIC_GITHUB ?? "",
  fallbackOrigin: process.env.NEXT_PUBLIC_SITE_URL ?? "https://frontdesk-ai.vercel.app",
};

export default function Chat() {
  const [mode, setMode] = useState<Mode>("friendly");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [fullscreen, setFullscreen] = useState(false);
  const { messages, sendMessage, status, setMessages } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
      body: () => ({ mode }),
    }),
  });
  const [input, setInput] = useState("");

  const [toolCall, setToolCall] = useState<{ name: string } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [agentCopied, setAgentCopied] = useState(false);

  // Resolve the live origin so the copied agent set-up always points at the
  // current deployment (works on localhost, preview URLs, and the prod alias).
  const origin =
    typeof window !== "undefined"
      ? window.location.origin
      : BRAND.fallbackOrigin;

  const buildAgentConfig = () => {
    return `# ${BRAND.name} — plug me into your agent
# All three surfaces are live at the same origin and share the same tools
# (book a Calendly meeting / send a message / general Q&A).

# REST — streaming chat (same as this page)
POST ${origin}/api/chat
Content-Type: application/json

{ "mode": "friendly", "messages": [{ "role": "user", "content": "book a 30-min call next Tuesday" }] }

# MCP — add calendar + send_email tools to any MCP client (Claude, Cursor, opencode…)
{
  "mcpServers": {
    "concierge": { "type": "http", "url": "${origin}/api/mcp" }
  }
}

# A2A — agent-to-agent. Discover via the Agent Card, or call JSON-RPC directly.
# Discover:  ${origin}/.well-known/agent-card.json
curl ${origin}/a2a -H "Content-Type: application/json" -d '{
  "jsonrpc": "2.0", "method": "SendMessage", "id": "req-1",
  "params": { "message": { "role": "user", "parts": [{ "type": "text", "text": "Book a 30-min call on Thursday at 2pm" }] } }
}'
`;
  };

  const copyAgent = async () => {
    try {
      await navigator.clipboard.writeText(buildAgentConfig());
      setAgentCopied(true);
      setTimeout(() => setAgentCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  const storageKey = `concierge-chat-${mode}`;

  // Drop any tool-invocation parts that never received a result. Replaying a
  // mid-stream "call"-state tool call to the API throws AI_MessageConversionError.
  const sane = (msgs: any[]) =>
    (msgs ?? []).map((m) =>
      m && Array.isArray(m.parts)
        ? {
            ...m,
            parts: m.parts.filter(
              (p: any) =>
                p.type !== "tool-invocation" ||
                p.toolInvocation?.state === "result"
            ),
          }
        : m
    );

  // Theme: apply to <html data-theme> for CSS variables. Persist choice.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("concierge-theme", theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  useEffect(() => {
    try {
      const savedTheme = localStorage.getItem("concierge-theme");
      if (savedTheme === "light" || savedTheme === "dark") setTheme(savedTheme);
    } catch {
      /* ignore */
    }
  }, []);

  // Report the visit once per page load (single, lightweight beacon — no
  // third-party scripts, no heavy fingerprinting, so nothing for AV/blockers
  // to flag). Server resolves IP + coarse location.
  useEffect(() => {
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(
          "/api/track",
          new Blob([JSON.stringify({ mode })], { type: "application/json" })
        );
      } else {
        fetch("/api/track", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode }),
          keepalive: true,
        }).catch(() => {});
      }
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load saved messages for the active mode on mount / mode switch
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) setMessages(sane(parsed) as never[]);
      }
    } catch {
      /* ignore corrupt storage */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const busy = status === "submitted" || status === "streaming";

  // Persist messages after streaming settles (only results are kept). Saving on
  // every streamed delta blocks the main thread with a full serialize + sync
  // localStorage write, which makes live rendering janky.
  useEffect(() => {
    if (messages.length > 0 && !busy) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(sane(messages)));
      } catch {
        /* storage full / unavailable */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, busy]);

  const switchMode = (m: Mode) => {
    if (m === mode) return;
    setMode(m);
    setMessages([]);
    setToolCall(null);
  };

  // Track tool activity from parts
  useEffect(() => {
    const last = messages[messages.length - 1];
    let active: { name: string } | null = null;
    if (last && "parts" in last && Array.isArray(last.parts)) {
      for (const p of last.parts as any[]) {
        if (p.type === "tool-invocation" && p.toolInvocation?.state !== "result") {
          active = { name: p.toolInvocation.toolName };
          break;
        }
      }
    }
    setToolCall(active);
  }, [messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({
      behavior: busy ? "auto" : "smooth",
    });
  }, [messages, toolCall, busy]);

  const clearChat = () => {
    if (confirm("Clear conversation?")) {
      setMessages([]);
      setInput("");
      localStorage.removeItem(storageKey);
    }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    sendMessage({ text });
  };

  const buyCoffee = () => {
    if (!COFFEE_UPI) return;
    if (
      confirm(
        "Buy me a coffee? This will open your UPI app to complete the payment."
      )
    ) {
      window.location.href = COFFEE_UPI;
    }
  };

  return (
    <div
      className={`${styles.app} ${fullscreen ? styles.appFull : ""}`}
    >
      <header className={styles.header}>
        <div className={styles.headerTop}>
          <img
            src="/avatar.jpg"
            alt={BRAND.name}
            className={styles.avatar}
          />
          <div className={styles.brandBlock}>
            <div className={styles.brandRow}>
              <div className={styles.brand}>{BRAND.name}</div>
              <div className={styles.headerButtons}>
                <button
                  className={`${styles.agentCopyBtn} ${agentCopied ? styles.agentCopied : ""}`}
                  onClick={copyAgent}
                  title="Copy a one-shot set-up guide (REST + MCP + A2A) so you can plug this concierge into your own AI agent."
                >
                  {agentCopied ? "✓ Copied" : "🤖 Copy agent set-up"}
                </button>
                <button
                  className={`${styles.themeToggle} ${styles.appFullToggle}`}
                  onClick={() => setFullscreen(!fullscreen)}
                  title={fullscreen ? "Exit full width" : "Expand to full width"}
                >
                  {fullscreen ? "⤡" : "⤢"}
                </button>
                <button
                  className={styles.themeToggle}
                  onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                  title="Toggle theme"
                >
                  {theme === "dark" ? "☀️" : "🌙"}
                </button>
              </div>
            </div>
            <div className={styles.title}>{BRAND.title}</div>
            <div className={styles.socials}>
              <a href={`mailto:${BRAND.publicEmail}`} className={styles.social}>
                ✉ {BRAND.publicEmail}
              </a>
              {BRAND.linkedin && (
                <a href={BRAND.linkedin} target="_blank" rel="noopener noreferrer" className={styles.social}>
                  in LinkedIn
                </a>
              )}
              {BRAND.github && (
                <a href={BRAND.github} target="_blank" rel="noopener noreferrer" className={styles.social}>
                  GitHub
                </a>
              )}
              <a
                href="/resume.pdf"
                download="Resume.pdf"
                target="_blank"
                rel="noopener noreferrer"
                className={styles.social}
              >
                ⬇ CV
              </a>
              {COFFEE_UPI && (
                <button onClick={buyCoffee} className={styles.coffeeBtn}>
                  ☕ Buy me a coffee
                </button>
              )}
            </div>
          </div>
        </div>

        <div className={styles.subtitle}>
          Meet my assistant — it schedules meetings, takes messages & emails them, and answers questions about {BRAND.name}.
        </div>

        <div className={styles.toggleBar}>
          {(Object.keys(MODES) as Mode[]).map((m) => (
            <button
              key={m}
              className={`${styles.toggleBtn} ${mode === m ? styles.toggleActive : ""}`}
              onClick={() => switchMode(m)}
              disabled={busy}
            >
              {MODES[m].emoji} <span className={styles.toggleLabel}>{MODES[m].label}</span>
              <span className={styles.toggleSub}>{MODES[m].sub}</span>
            </button>
          ))}
        </div>
      </header>

      <main className={styles.messages} ref={endRef}>
        {messages.length === 0 && mode === "friendly" && (
          <div className={styles.empty}>
            <p>💬 <b>Chat Mode</b> — hi, I'm the assistant here 👋</p>
            <p>Ask me anything, schedule a meeting, or leave a message. I can also brainstorm ideas and find resources:</p>
            <ul>
              <li>📋 <b>Talk about the owner</b> — experience, skills, projects</li>
              <li>📅 <b>Book a meeting</b> on Calendly</li>
              <li>✉️ <b>Leave a message</b></li>
              <li>🧠 <b>Brainstorm</b> work or side-project ideas</li>
              <li>🔎 <b>Find a resource</b> — a repo or post that's been shared</li>
            </ul>
          </div>
        )}

        {messages.length === 0 && mode === "recruiter" && (
          <div className={styles.empty}>
            <p>🎯 <b>Recruiter Mode</b> — hi, I can walk you through the owner's candidacy like a live interview.</p>
            <p>A few things to know:</p>
            <ul>
              <li><b>Deep, hands-on experience</b> across applied AI, agentic systems, and platform engineering.</li>
              <li><b>Built-for-production thinking</b> — from model integration and orchestration up to enterprise platforms.</li>
            </ul>
            <p className={styles.projectsTry}>Try: <i>"Summarize their experience"</i> · <i>"Book a 30-min call"</i></p>
          </div>
        )}

        {messages.map((m) => {
          const isUser = m.role === "user";
          const lastId = messages[messages.length - 1]?.id;
          const text =
            "content" in m && typeof m.content === "string" && m.content
              ? m.content
              : null;
          const parts =
            "parts" in m && Array.isArray(m.parts) ? (m.parts as any[]) : [];

          return (
            <div key={m.id} className={`${styles.row} ${isUser ? styles.user : styles.assistant}`}>
              <div className={`${styles.bubble} ${isUser ? styles.bubbleUser : styles.bubbleAssistant}`}>
                {isUser ? (
                  text && <div className={styles.mdUser}>{text}</div>
                ) : (
                  parts.map((p, i) => {
                    if (p.type === "tool-invocation") {
                      const t = p.toolInvocation;
                      return (
                        <div key={i} className={styles.tool}>
                          <span className={styles.toolIcon}>⚙</span>{" "}
                          {t.toolName} {t.state === "result" ? "✓" : "…"}
                        </div>
                      );
                    }
                    if (p.type === "text" && p.text) {
                      // While this message is still streaming, render raw text
                      // (cheap pre-wrap) instead of re-parsing markdown on
                      // every delta. react-markdown re-parse per token is
                      // O(n^2) and starves paints, "freezing" the stream until
                      // it completes. Markdown renders once streaming stops.
                      const streamingNow = busy && m.id === lastId;
                      return (
                        <div key={i} className={streamingNow ? styles.text : styles.md}>
                          {streamingNow ? p.text : <Markdown>{p.text}</Markdown>}
                        </div>
                      );
                    }
                    return null;
                  })
                )}
              </div>
            </div>
          );
        })}

        {toolCall && (
          <div className={styles.tool}>
            Running {toolCall.name}…
          </div>
        )}

        <div ref={bottomRef} />
      </main>

      <footer className={styles.form}>
        <form onSubmit={onSubmit} className={styles.inputRow}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => setFullscreen(true)}
            placeholder={MODES[mode].placeholder}
            className={styles.input}
            disabled={busy}
          />
          <button type="submit" className={styles.button} disabled={busy || !input.trim()}>
            Send
          </button>
        </form>
        <div className={styles.actionsRow}>
          <div className={styles.clearLink} onClick={clearChat}>
            Clear conversation
          </div>
        </div>
        <div className={styles.hint}>
          This assistant may send email and book Calendly meetings on the owner's behalf.
        </div>
      </footer>
    </div>
  );
}

