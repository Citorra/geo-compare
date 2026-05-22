"use client";

import * as React from "react";
import { Progress } from "@/components/ui/progress";
import {
  AuditComparison,
  CATEGORY_LABELS,
  MetricCategory,
  MetricResult,
  SiteAudit,
} from "@/lib/types";
import { cn } from "@/lib/utils";

interface Props {
  data: AuditComparison;
  clientLabel: string;
  competitorLabel: string;
  /** When true, render the per-metric "why this matters" explanations. */
  showWhy?: boolean;
}

function hostnameOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function metricRow(client?: MetricResult, competitor?: MetricResult) {
  const label = client?.label ?? competitor?.label ?? "";
  const clientScore = client?.score ?? 0;
  const competitorScore = competitor?.score ?? 0;
  const winner: "client" | "competitor" | "tie" =
    clientScore === competitorScore
      ? "tie"
      : clientScore > competitorScore
        ? "client"
        : "competitor";
  return { label, clientScore, competitorScore, winner, client, competitor };
}

const ComparisonCard = React.forwardRef<HTMLDivElement, Props>(function ComparisonCard(
  { data, clientLabel, competitorLabel, showWhy = false },
  ref,
) {
  const { client } = data;
  const competitor = data.competitor;
  const isComparison = !!competitor;

  // Group metrics by category. In comparison mode, use the union of ids from
  // both audits; in single-site mode, just the client's metrics.
  const allIds = Array.from(
    new Set([
      ...client.metrics.map((m) => m.id),
      ...(competitor?.metrics.map((m) => m.id) ?? []),
    ]),
  );

  const rowsByCat: Record<MetricCategory, ReturnType<typeof metricRow>[]> = {
    discovery: [],
    structure: [],
    technical: [],
  };
  for (const id of allIds) {
    const c = client.metrics.find((m) => m.id === id);
    const k = competitor?.metrics.find((m) => m.id === id);
    const cat = (c?.category ?? k?.category) as MetricCategory | undefined;
    if (!cat) continue;
    rowsByCat[cat].push(metricRow(c, k));
  }

  const date = new Date(data.generatedAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return (
    <div
      ref={ref}
      className="bg-white text-citorra-ink rounded-2xl border shadow-sm overflow-hidden"
      style={{ width: 920 }}
    >
      {/* Header */}
      <div className="px-8 pt-7 pb-5 border-b flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-citorra grid place-items-center text-white font-bold">
            C
          </div>
          <div className="leading-tight">
            <div className="font-semibold text-base">
              Citorra · {isComparison ? "GEO Snapshot" : "GEO Audit"}
            </div>
            <div className="text-xs text-citorra-mute">
              {isComparison ? "Static metrics comparison" : "Static metrics audit"} · {date}
            </div>
          </div>
        </div>
        <div className="text-xs text-citorra-mute">citorra.com</div>
      </div>

      {/* Totals */}
      <div
        className={cn(
          "grid gap-0 border-b",
          isComparison ? "grid-cols-2" : "grid-cols-1",
        )}
      >
        <SiteHeader
          site={client}
          label={clientLabel || hostnameOf(client.url)}
          eyebrow={isComparison ? "Client" : "Audited site"}
          color="primary"
        />
        {competitor && (
          <SiteHeader
            site={competitor}
            label={competitorLabel || hostnameOf(competitor.url)}
            eyebrow="Competitor"
            color="muted"
          />
        )}
      </div>

      {/* Fetch errors */}
      {(!client.fetchOk || (competitor && !competitor.fetchOk)) && (
        <div className="px-8 py-3 text-sm bg-red-50 text-red-700 border-b">
          {!client.fetchOk && (
            <div>Client fetch failed: {client.fetchError || "unknown error"}</div>
          )}
          {competitor && !competitor.fetchOk && (
            <div>Competitor fetch failed: {competitor.fetchError || "unknown error"}</div>
          )}
        </div>
      )}

      {/* Categories */}
      <div className="px-8 py-6 space-y-7">
        {(Object.keys(rowsByCat) as MetricCategory[]).map((cat) => (
          <CategoryBlock
            key={cat}
            title={CATEGORY_LABELS[cat]}
            clientScore={client.categoryScores[cat]}
            competitorScore={competitor?.categoryScores[cat]}
            rows={rowsByCat[cat]}
            isComparison={isComparison}
            showWhy={showWhy}
          />
        ))}
      </div>

      {/* Footer */}
      <div className="px-8 py-4 border-t bg-secondary/40 text-xs text-citorra-mute flex items-center justify-between">
        <span>Higher is better. Scores are static checks only — full citation-rate audit available on request.</span>
        <span>Citorra GEO</span>
      </div>
    </div>
  );
});

export default ComparisonCard;

/* ---------------------------------------------------------------------- */

function scoreColor(score: number) {
  if (score >= 75) return "bg-emerald-500";
  if (score >= 50) return "bg-amber-500";
  return "bg-rose-500";
}

function SiteHeader({
  site,
  label,
  eyebrow,
  color,
}: {
  site: SiteAudit;
  label: string;
  eyebrow: string;
  color: "primary" | "muted";
}) {
  return (
    <div
      className={cn(
        "px-8 py-6",
        color === "primary" ? "bg-citorra/5" : "bg-secondary/30",
      )}
    >
      <div className="text-xs uppercase tracking-wide text-citorra-mute">{eyebrow}</div>
      <div className="mt-1 font-semibold text-lg truncate">{label}</div>
      <div className="text-xs text-citorra-mute truncate">{hostnameOf(site.finalUrl || site.url)}</div>
      <div className="mt-4 flex items-end gap-3">
        <div className="text-5xl font-bold tabular-nums">{site.totalScore}</div>
        <div className="text-sm text-citorra-mute pb-2">/ 100</div>
      </div>
    </div>
  );
}

function CategoryBlock({
  title,
  clientScore,
  competitorScore,
  rows,
  isComparison,
  showWhy,
}: {
  title: string;
  clientScore: number;
  competitorScore?: number;
  rows: ReturnType<typeof metricRow>[];
  isComparison: boolean;
  showWhy: boolean;
}) {
  return (
    <section>
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="font-semibold text-sm uppercase tracking-wide text-citorra-ink">
          {title}
        </h3>
        <div className="text-xs text-citorra-mute tabular-nums">
          {isComparison ? (
            <>
              Client <span className="font-semibold text-citorra-ink">{clientScore}</span>
              {" · "}
              Competitor{" "}
              <span className="font-semibold text-citorra-ink">{competitorScore}</span>
            </>
          ) : (
            <>
              Score <span className="font-semibold text-citorra-ink">{clientScore}</span>
            </>
          )}
        </div>
      </div>
      <div className="divide-y divide-border/60 rounded-lg border bg-background/40">
        {rows.map((row) => (
          <MetricRow key={row.label} row={row} isComparison={isComparison} showWhy={showWhy} />
        ))}
      </div>
    </section>
  );
}

function MetricRow({
  row,
  isComparison,
  showWhy,
}: {
  row: ReturnType<typeof metricRow>;
  isComparison: boolean;
  showWhy: boolean;
}) {
  const why = row.client?.why || row.competitor?.why;
  return (
    <div className="px-4 py-3">
      <div
        className={cn(
          "grid gap-4 items-center",
          isComparison ? "grid-cols-[1.1fr_1fr_1fr]" : "grid-cols-[1.1fr_1fr]",
        )}
      >
        <div className="text-sm font-medium leading-tight">
          <div>{row.label}</div>
          <div className="text-xs text-citorra-mute mt-0.5 line-clamp-2">
            {row.client?.detail || row.competitor?.detail}
          </div>
        </div>
        <BarCell
          score={row.clientScore}
          highlight={isComparison && row.winner === "client"}
        />
        {isComparison && (
          <BarCell score={row.competitorScore} highlight={row.winner === "competitor"} muted />
        )}
      </div>
      {showWhy && why && (
        <div className="mt-2 text-xs text-citorra-mute bg-secondary/50 rounded-md px-3 py-2 leading-snug">
          <span className="font-semibold text-citorra-ink">Why this matters: </span>
          {why}
        </div>
      )}
    </div>
  );
}

function BarCell({ score, highlight, muted }: { score: number; highlight?: boolean; muted?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <Progress
        value={score}
        className={cn("h-2.5 bg-secondary")}
        indicatorClassName={cn(scoreColor(score), highlight ? "" : "opacity-90")}
      />
      <div
        className={cn(
          "w-8 text-right text-xs tabular-nums",
          highlight ? "font-semibold text-citorra-ink" : muted ? "text-citorra-mute" : "text-citorra-ink",
        )}
      >
        {score}
      </div>
    </div>
  );
}
