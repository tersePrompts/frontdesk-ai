import { NextRequest } from "next/server";
import {
  DefaultRequestHandler,
  InMemoryTaskStore,
  JsonRpcTransportHandler,
  ServerCallContext,
} from "@a2a-js/sdk/server";
import { conciergeExecutor } from "@/lib/a2a/executor";
import { AGENT_CARD } from "@/lib/a2a/types";
import { clientIp, isRateLimited } from "@/lib/rateLimit";
import { isValidProviderKey } from "@/lib/ai";

function requireAuth(req: NextRequest): Response | null {
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
  return null;
}

function buildContext(req: NextRequest): ServerCallContext {
  const headers: Record<string, string | string[] | undefined> = {};
  req.headers.forEach((value, key) => {
    headers[key] = value;
  });

  return new ServerCallContext({
    user: {
      get isAuthenticated() {
        return true;
      },
      get userName() {
        return "a2a-client";
      },
    },
    state: new Map([["headers", headers]]),
  });
}

let handler: DefaultRequestHandler | null = null;

function getHandler(): DefaultRequestHandler {
  if (!handler) {
    handler = new DefaultRequestHandler(
      AGENT_CARD,
      new InMemoryTaskStore(),
      conciergeExecutor
    );
  }
  return handler;
}

export async function POST(req: NextRequest) {
  if (process.env.A2A_ENABLED === "false") {
    return Response.json(
      { error: "The A2A endpoint is disabled (A2A_ENABLED=false)." },
      { status: 404 }
    );
  }
  if (isRateLimited(`a2a:${clientIp(req)}`, 20, 60_000)) {
    return Response.json(
      { error: "Rate limit exceeded. Please wait a minute and try again." },
      { status: 429 }
    );
  }

  const authError = requireAuth(req);
  if (authError) return authError;

  const body = await req.json();
  const requestHandler = getHandler();
  const rpcHandler = new JsonRpcTransportHandler(requestHandler);
  const context = buildContext(req);

  const result = await rpcHandler.handle(body, context);

  if (result && typeof (result as { next: unknown }).next === "function") {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of result as AsyncGenerator<{
            jsonrpc: string;
            id: string | number | null;
            result?: unknown;
          }>) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`)
            );
          }
        } catch (err) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                jsonrpc: "2.0",
                id: null,
                error: { code: -32603, message: String(err) },
              })}\n\n`
            )
          );
        }
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }

  return Response.json(result, {
    headers: { "Content-Type": "application/json" },
  });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      Allow: "POST, OPTIONS",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
