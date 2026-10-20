import type { AuditComparison, SiteAudit } from "@/lib/types";

const TIMEOUT_MS = 5000;

type SiteColumns = {
  url: string;
  final_url: string | null;
  total: number | null;
  geo: number | null;
  seo: number | null;
  discovery: number | null;
  structure: number | null;
  technical: number | null;
  ttfb_ms: number | null;
};

/** One data-table row per audit run. Column names match the n8n table `geo_compare_runs`. */
export interface RunRow {
  run_id: string;
  generated_at: string;
  mode: "single" | "compare";
  client_url: string;
  client_final_url: string | null;
  client_total: number | null;
  client_geo: number | null;
  client_seo: number | null;
  client_discovery: number | null;
  client_structure: number | null;
  client_technical: number | null;
  client_ttfb_ms: number | null;
  competitor_url: string | null;
  competitor_final_url: string | null;
  competitor_total: number | null;
  competitor_geo: number | null;
  competitor_seo: number | null;
  competitor_discovery: number | null;
  competitor_structure: number | null;
  competitor_technical: number | null;
  competitor_ttfb_ms: number | null;
  /** Stringified `{ client: [...], competitor?: [...] }` — data tables have no JSON column type. */
  metrics_json: string;
}

function siteColumns(site: SiteAudit | undefined): SiteColumns | null {
  if (!site) return null;
  return {
    url: site.url,
    final_url: site.finalUrl || null,
    total: site.totalScore,
    geo: site.geoScore,
    seo: site.seoScore,
    discovery: site.categoryScores.discovery,
    structure: site.categoryScores.structure,
    technical: site.categoryScores.technical,
    ttfb_ms: site.ttfb,
  };
}

function slimMetrics(site: SiteAudit | undefined) {
  return site?.metrics.map(({ id, category, score, status, detail }) => ({
    id,
    category,
    score,
    status,
    detail,
  }));
}

export function buildRunRow(data: AuditComparison): RunRow {
  const c = siteColumns(data.client)!;
  const k = siteColumns(data.competitor);
  return {
    run_id: crypto.randomUUID(),
    generated_at: data.generatedAt,
    mode: data.competitor ? "compare" : "single",
    client_url: c.url,
    client_final_url: c.final_url,
    client_total: c.total,
    client_geo: c.geo,
    client_seo: c.seo,
    client_discovery: c.discovery,
    client_structure: c.structure,
    client_technical: c.technical,
    client_ttfb_ms: c.ttfb_ms,
    competitor_url: k?.url ?? null,
    competitor_final_url: k?.final_url ?? null,
    competitor_total: k?.total ?? null,
    competitor_geo: k?.geo ?? null,
    competitor_seo: k?.seo ?? null,
    competitor_discovery: k?.discovery ?? null,
    competitor_structure: k?.structure ?? null,
    competitor_technical: k?.technical ?? null,
    competitor_ttfb_ms: k?.ttfb_ms ?? null,
    metrics_json: JSON.stringify({
      client: slimMetrics(data.client),
      ...(data.competitor ? { competitor: slimMetrics(data.competitor) } : {}),
    }),
  };
}

/**
 * Posts the run to the n8n webhook (server-side only — the URL and secret never
 * reach the browser). No-op when N8N_WEBHOOK_URL is unset. Never throws: a
 * logging failure must not affect the audit response.
 */
export async function logRunToN8n(data: AuditComparison): Promise<void> {
  const url = process.env.N8N_WEBHOOK_URL;
  if (!url) return;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.N8N_WEBHOOK_SECRET
          ? { "X-Geo-Secret": process.env.N8N_WEBHOOK_SECRET }
          : {}),
      },
      body: JSON.stringify(buildRunRow(data)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) console.error(`[n8n-log] webhook responded ${res.status}`);
  } catch (err) {
    console.error("[n8n-log] failed to post run:", err instanceof Error ? err.message : err);
  }
}
