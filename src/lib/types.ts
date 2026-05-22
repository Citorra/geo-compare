export type MetricStatus = "pass" | "partial" | "fail" | "error";

export interface MetricResult {
  /** Stable machine id, e.g. "llms_txt" */
  id: string;
  /** Human label, e.g. "llms.txt present" */
  label: string;
  /** Which category this belongs to */
  category: MetricCategory;
  /** 0..100 */
  score: number;
  status: MetricStatus;
  /** Short human explanation of the result */
  detail: string;
  /** Static, result-independent "why this matters" line for client-facing output */
  why?: string;
  /** Weight inside the category total (defaults to 1) */
  weight?: number;
  /**
   * True when the metric counts toward the GEO subtotal (signals that drive
   * AI/LLM citation). Set by the `metric()` helper from `GEO_METRICS`.
   */
  geo: boolean;
  /**
   * True when the metric counts toward the SEO subtotal. Set by the `metric()`
   * helper from `SEO_METRICS`. A metric may be both GEO and SEO (e.g. social
   * card tags), in which case it contributes to both subtotals.
   */
  seo: boolean;
}

export type MetricCategory = "discovery" | "structure" | "technical";

export interface SiteAudit {
  url: string;
  finalUrl: string;
  /** ms */
  ttfb: number | null;
  fetchOk: boolean;
  fetchError?: string;
  metrics: MetricResult[];
  /** GEO-tilted weighted total, 0..100. Blends geoScore and seoScore via GEO_SEO_WEIGHTS. */
  totalScore: number;
  /** Weighted 0..100 across GEO-specific metrics only. */
  geoScore: number;
  /** Weighted 0..100 across general-SEO metrics only. */
  seoScore: number;
  /** Per-category subtotals (0..100) — shown as the card's section breakdown. */
  categoryScores: Record<MetricCategory, number>;
}

export interface AuditComparison {
  client: SiteAudit;
  /** Absent in single-site mode (no competitor toggled on). */
  competitor?: SiteAudit;
  generatedAt: string;
}

export const CATEGORY_LABELS: Record<MetricCategory, string> = {
  discovery: "Discovery & Schema",
  structure: "Content Structure",
  technical: "Technical SEO",
};

/**
 * Split of the total score between GEO-specific signals and general SEO.
 * GEO is what this tool focuses on, so it carries the larger share; plain SEO
 * still counts. Must sum to 1. This is the single knob for the GEO tilt.
 */
export const GEO_SEO_WEIGHTS = {
  geo: 0.7,
  seo: 0.3,
} as const;
