import { NextRequest } from "next/server";
import { AGENT_CARD } from "@/lib/a2a/types";

export async function GET(_req: NextRequest) {
  return Response.json(AGENT_CARD, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      Allow: "GET, OPTIONS",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
