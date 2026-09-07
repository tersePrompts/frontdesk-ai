import type { AgentCard } from "@a2a-js/sdk";
import { TaskState, Role } from "@a2a-js/sdk";

export { TaskState, Role };

export type {
  AgentCard,
  Task,
  TaskStatus,
  Message,
  Part,
  Artifact,
  TaskStatusUpdateEvent,
  TaskArtifactUpdateEvent,
  SendMessageRequest,
  GetTaskRequest,
  CancelTaskRequest,
  SendMessageConfiguration,
  AgentSkill,
  AgentCapabilities,
  AgentProvider,
  SecurityScheme,
  SecurityRequirement,
} from "@a2a-js/sdk";

export const AGENT_CARD: AgentCard = {
  name: "Frontdesk AI",
  description:
    "Personal AI concierge that books meetings, takes messages, and answers questions about its owner.",
  version: "1.0.0",
  supportedInterfaces: [
    {
      url: "/a2a",
      protocolBinding: "JSONRPC",
      tenant: "",
      protocolVersion: "1.0",
    },
  ],
  provider: {
    organization: "Frontdesk AI",
    url: "https://github.com/tersePrompts/frontdesk-ai",
  },
  capabilities: {
    streaming: true,
    pushNotifications: false,
    extensions: [],
    extendedAgentCard: false,
  },
  securitySchemes: {
    bearerAuth: {
      scheme: {
        $case: "httpAuthSecurityScheme",
        value: {
          description: "API key via Bearer token",
          scheme: "Bearer",
          bearerFormat: "API Key",
        },
      },
    },
  },
  securityRequirements: [{ schemes: { bearerAuth: { list: [] } } }],
  defaultInputModes: ["text/plain", "application/json"],
  defaultOutputModes: ["text/plain", "application/json"],
  skills: [
    {
      id: "calendar-scheduling",
      name: "Calendar Scheduling",
      description:
        "Books meetings on the owner's Calendly, checks availability, lists event types, and manages scheduled events.",
      tags: ["calendar", "scheduling", "meetings", "calendly"],
      examples: [
        "Book a 30-minute meeting with John tomorrow at 2pm",
        "Check availability for next week",
        "Cancel the meeting scheduled for Friday",
      ],
      inputModes: ["text/plain"],
      outputModes: ["text/plain"],
      securityRequirements: [],
    },
    {
      id: "message-taking",
      name: "Message Taking",
      description:
        "Takes messages and emails them to the owner's internal inbox. Recipient is never exposed.",
      tags: ["email", "messaging", "contact"],
      examples: [
        "Leave a message for the owner about the project update",
        "Send an email reminder about tomorrow's deadline",
      ],
      inputModes: ["text/plain"],
      outputModes: ["text/plain"],
      securityRequirements: [],
    },
    {
      id: "general-assistant",
      name: "General Assistant",
      description:
        "Answers questions about the owner, their background, skills, and availability.",
      tags: ["qa", "information", "assistant"],
      examples: [
        "What is the owner's experience with AI?",
        "Tell me about the owner's background",
        "What projects has the owner worked on?",
      ],
      inputModes: ["text/plain"],
      outputModes: ["text/plain"],
      securityRequirements: [],
    },
  ],
  signatures: [],
};
