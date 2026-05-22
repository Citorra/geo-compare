import { NextRequest, NextResponse } from "next/server";
import { auditSite } from "@/lib/metrics";
import { normalizeUrl } from "@/lib/fetcher";
import type { AuditComparison } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: { clientUrl?: string; competitorUrl?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const clientUrl = normalizeUrl(body.clientUrl ?? "");
  const competitorUrl = normalizeUrl(body.competitorUrl ?? "");

  if (!clientUrl) {
    return NextResponse.json({ error: "clientUrl is required." }, { status: 400 });
  }

  try {
    new URL(clientUrl);
    if (competitorUrl) new URL(competitorUrl);
  } catch {
    return NextResponse.json({ error: "One of the URLs is not valid." }, { status: 400 });
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

  return NextResponse.json(payload);
}
