import { NextRequest } from "next/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "@/lib/mcp/server";
import { clientIp, isRateLimited } from "@/lib/rateLimit";
import { isValidProviderKey } from "@/lib/ai";

export async function POST(req: NextRequest) {
  if (process.env.MCP_ENABLED === "false") {
    return Response.json(
      { error: "The MCP endpoint is disabled (MCP_ENABLED=false)." },
      { status: 404 }
    );
  }
  if (isRateLimited(`mcp:${clientIp(req)}`, 20, 60_000)) {
    return Response.json(
      { error: "Rate limit exceeded. Please wait a minute and try again." },
      { status: 429 }
    );
  }

  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return Response.json(
      { error: "Unauthorized. Provide Authorization: Bearer <your LLM API key>." },
      { status: 401 }
    );
  }

  const token = auth.slice(7);
  if (!isValidProviderKey(token)) {
    return Response.json({ error: "Invalid API key." }, { status: 401 });
  }

  const server = createMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  await server.connect(transport);

  return transport.handleRequest(req);
}

export async function GET(req: NextRequest) {
  return new Response(
    JSON.stringify({
      name: "Frontdesk AI MCP Server",
      description:
        "MCP server exposing calendar scheduling and message-taking tools.",
      version: "1.0.0",
      tools: [
        {
          name: "calendar",
          description:
            "Schedule and manage meetings via Calendly: list event types, check availability, book/cancel meetings, list scheduled events.",
        },
        {
          name: "send_email",
          description:
            "Send an internal email to the owner's inbox. Recipient is never exposed.",
        },
      ],
    }),
    {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    }
  );
}

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      Allow: "POST, GET, OPTIONS",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
