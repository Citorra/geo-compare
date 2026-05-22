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
  /** Weight inside the category total (defaults to 1) */
  weight?: number;
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
  /** Weighted 0..100 across all metrics */
  totalScore: number;
  /** Per-category subtotals (0..100) */
  categoryScores: Record<MetricCategory, number>;
}

export interface AuditComparison {
  client: SiteAudit;
  competitor: SiteAudit;
  generatedAt: string;
}

export const CATEGORY_LABELS: Record<MetricCategory, string> = {
  discovery: "Discovery & Schema",
  structure: "Content Structure",
  technical: "Technical SEO",
};

/** Category weight in the total score (must sum to 1) */
export const CATEGORY_WEIGHTS: Record<MetricCategory, number> = {
  discovery: 0.4,
  structure: 0.35,
  technical: 0.25,
};
