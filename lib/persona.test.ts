import { describe, it, expect } from "vitest";
import { getSystemPrompt, systemPrompt, recruiterPrompt, aiPeerPrompt } from "./persona";

describe("getSystemPrompt", () => {
  it("returns the default system prompt for unknown or missing modes", () => {
    expect(getSystemPrompt("assistant")).toBe(systemPrompt);
    expect(getSystemPrompt("anything")).toBe(systemPrompt);
    expect(getSystemPrompt("")).toBe(systemPrompt);
  });

  it("returns the recruiter prompt for recruiter mode", () => {
    expect(getSystemPrompt("recruiter")).toBe(recruiterPrompt);
  });

  it("returns the AI peer prompt for aipeer mode", () => {
    expect(getSystemPrompt("aipeer")).toBe(aiPeerPrompt);
  });

  it("all prompts enforce the privacy guardrails", () => {
    for (const prompt of [systemPrompt, recruiterPrompt, aiPeerPrompt]) {
      expect(prompt).toContain("NEVER share the owner's phone number");
      expect(prompt).toMatch(/NEVER reveal the owner's private email/i);
    }
  });

  it("action gate requires identity before acting", () => {
    for (const prompt of [systemPrompt, recruiterPrompt, aiPeerPrompt]) {
      expect(prompt).toMatch(/collect.*NAME, EMAIL|NAME, EMAIL, and optionally/i);
    }
  });
});