import { NextRequest, NextResponse } from "next/server";
import { auditSite } from "@/lib/metrics";
import { normalizeUrl } from "@/lib/fetcher";
import type { AuditComparison } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function corsJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: CORS_HEADERS });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  let body: { clientUrl?: string; competitorUrl?: string };
  try {
    body = await req.json();
  } catch {
    return corsJson({ error: "Invalid JSON body." }, 400);
  }

  const clientUrl = normalizeUrl(body.clientUrl ?? "");
  const competitorUrl = normalizeUrl(body.competitorUrl ?? "");

  if (!clientUrl) {
    return corsJson({ error: "clientUrl is required." }, 400);
  }

  try {
    new URL(clientUrl);
    if (competitorUrl) new URL(competitorUrl);
  } catch {
    return corsJson({ error: "One of the URLs is not valid." }, 400);
  }

  const [client, competitor] = await Promise.all([
    auditSite(clientUrl),
    competitorUrl ? auditSite(competitorUrl) : Promise.resolve(undefined),
  ]);

  const payload: AuditComparison = {
    client,
    ...(competitor ? { competitor } : {}),
    generatedAt: new Date().toISOString(),
  };

  return corsJson(payload);
}
