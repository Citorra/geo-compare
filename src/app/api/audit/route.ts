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

  if (!clientUrl || !competitorUrl) {
    return NextResponse.json(
      { error: "Both clientUrl and competitorUrl are required." },
      { status: 400 },
    );
  }

  try {
    new URL(clientUrl);
    new URL(competitorUrl);
  } catch {
    return NextResponse.json({ error: "One of the URLs is not valid." }, { status: 400 });
  }

  const [client, competitor] = await Promise.all([
    auditSite(clientUrl),
    auditSite(competitorUrl),
  ]);

  const payload: AuditComparison = {
    client,
    competitor,
    generatedAt: new Date().toISOString(),
  };

  return NextResponse.json(payload);
}
