import * as cheerio from "cheerio";
import { FetchedPage, fetchPage, fetchRobots, originOf, probeUrl } from "./fetcher";
import {
  GEO_SEO_WEIGHTS,
  MetricCategory,
  MetricResult,
  SiteAudit,
} from "./types";

/* ---------------------------------------------------------------------- */
/* Helpers                                                                */
/* ---------------------------------------------------------------------- */

function statusFromScore(score: number): "pass" | "partial" | "fail" {
  if (score >= 80) return "pass";
  if (score >= 40) return "partial";
  return "fail";
}

/**
 * Static "why this matters" copy, keyed by metric id. Result-independent —
 * shown in client-facing output when the explanations toggle is on.
 */
const METRIC_WHY: Record<string, string> = {
  llms_txt:
    "llms.txt gives AI assistants a curated map of your most important pages, improving how accurately they summarise and cite you.",
  json_ld:
    "Structured data lets LLMs and search engines parse what your page is about without guessing, making your content easier to quote.",
  open_graph:
    "Open Graph tags control how your page looks when shared and give crawlers a clean title, description and image to work from.",
  twitter_card:
    "Twitter Card tags ensure a rich, correct preview when your page is shared on X and other platforms that read them.",
  h1_count:
    "A single clear H1 tells crawlers the page's main topic; multiple or missing H1s dilute that signal.",
  heading_hierarchy:
    "A clean heading order (no skipped levels) helps AI models chunk your content into coherent, citable sections.",
  word_count:
    "Pages with enough substantive text give AI models the context they need to answer questions and cite you confidently.",
  faq: "Question-and-answer content maps directly onto how people prompt AI assistants, making it prime material to be quoted.",
  semantic_html:
    "Semantic tags (main, article, nav…) help crawlers separate real content from navigation and boilerplate.",
  https:
    "HTTPS is a baseline trust signal; crawlers and search engines deprioritise or distrust pages served without it.",
  sitemap:
    "A sitemap helps crawlers discover every page quickly, so none of your content is missed during indexing.",
  viewport:
    "A mobile viewport tag signals a responsive page — a ranking and crawl-quality factor for search and AI systems.",
  ttfb: "A fast first byte means crawlers can fetch more of your pages within their time budget before giving up.",
  canonical:
    "A canonical tag consolidates duplicate URLs into one, so ranking and citation signals aren't split across copies.",
  ai_crawlers:
    "If robots.txt blocks GPTBot, ClaudeBot and similar agents, your content can't be cited by those AI assistants at all.",
};

/**
 * Metric ids that count toward the GEO subtotal — signals that drive whether AI
 * assistants can find, parse and cite the page. Drives the GEO-tilted total
 * (see `aggregate`) and the card's GEO tags.
 *
 * GEO and SEO are independent tags, not strict opposites — a metric may sit in
 * both sets. Every metric must appear in at least one of the two.
 */
const GEO_METRICS = new Set<string>([
  "llms_txt",
  "json_ld",
  "faq",
  "ai_crawlers",
  "semantic_html",
  "heading_hierarchy",
  "word_count",
  "open_graph",
  "twitter_card",
]);

/** Metric ids that count toward the SEO subtotal. May overlap `GEO_METRICS`. */
const SEO_METRICS = new Set<string>([
  "h1_count",
  "https",
  "sitemap",
  "viewport",
  "ttfb",
  "canonical",
]);

function metric(
  id: string,
  label: string,
  category: MetricCategory,
  score: number,
  detail: string,
  weight = 1,
): MetricResult {
  const s = Math.max(0, Math.min(100, Math.round(score)));
  return {
    id,
    label,
    category,
    score: s,
    detail,
    why: METRIC_WHY[id],
    status: statusFromScore(s),
    weight,
    geo: GEO_METRICS.has(id),
    seo: SEO_METRICS.has(id),
  };
}

/* ---------------------------------------------------------------------- */
/* robots.txt parsing                                                     */
/* ---------------------------------------------------------------------- */

/** Major AI/LLM crawler user-agents whose access we care about for GEO. */
const AI_CRAWLERS = [
  "GPTBot",
  "ClaudeBot",
  "anthropic-ai",
  "PerplexityBot",
  "Google-Extended",
  "CCBot",
];

interface RobotsGroup {
  /** Lower-cased user-agent tokens this group applies to. */
  agents: string[];
  /** Group contains `Disallow: /` (blocks the whole site). */
  disallowRoot: boolean;
  /** Group contains an `Allow: /` (or empty `Disallow:`) that re-opens the root. */
  allowRoot: boolean;
}

/**
 * Tiny robots.txt parser — only resolves enough to answer "is this bot blocked
 * from the site root?". Consecutive `User-agent:` lines share one group.
 */
function parseRobots(robots: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], disallowRoot: false, allowRoot: false };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    // An empty `Disallow:` means "allow everything", same as `Allow: /`.
    if (field === "disallow" && value === "/") current.disallowRoot = true;
    else if (field === "disallow" && value === "") current.allowRoot = true;
    else if (field === "allow" && value === "/") current.allowRoot = true;
  }
  return groups;
}

/**
 * True if `bot` is disallowed from the site root. A bot obeys its own named
 * group if one exists, otherwise the `*` group; absence of any rule = allowed.
 */
function isBotBlocked(groups: RobotsGroup[], bot: string): boolean {
  const b = bot.toLowerCase();
  const named = groups.filter((g) => g.agents.includes(b));
  const relevant = named.length > 0 ? named : groups.filter((g) => g.agents.includes("*"));
  if (relevant.length === 0) return false;
  const disallow = relevant.some((g) => g.disallowRoot);
  const allow = relevant.some((g) => g.allowRoot);
  return disallow && !allow;
}

/* ---------------------------------------------------------------------- */
/* Category 1 — Discovery & schema                                        */
/* ---------------------------------------------------------------------- */

async function checkDiscovery(page: FetchedPage, $: cheerio.CheerioAPI): Promise<MetricResult[]> {
  const origin = originOf(page.finalUrl);
  const results: MetricResult[] = [];

  // 1. llms.txt
  const llms = await probeUrl(`${origin}/llms.txt`);
  const llmsFull = await probeUrl(`${origin}/llms-full.txt`);
  let llmsScore = 0;
  let llmsDetail = "Neither /llms.txt nor /llms-full.txt found.";
  if (llms.ok && llmsFull.ok) {
    llmsScore = 100;
    llmsDetail = "Both /llms.txt and /llms-full.txt present.";
  } else if (llms.ok) {
    llmsScore = 70;
    llmsDetail = "/llms.txt present (no llms-full.txt).";
  } else if (llmsFull.ok) {
    llmsScore = 60;
    llmsDetail = "/llms-full.txt present (no llms.txt).";
  }
  results.push(metric("llms_txt", "llms.txt", "discovery", llmsScore, llmsDetail, 1.2));

  // 2. JSON-LD schema
  const jsonLdBlocks = $('script[type="application/ld+json"]')
    .map((_, el) => $(el).html() ?? "")
    .get()
    .filter((s: string) => s.trim().length > 0);
  const types = new Set<string>();
  for (const raw of jsonLdBlocks) {
    try {
      const parsed = JSON.parse(raw);
      const collect = (node: unknown) => {
        if (!node) return;
        if (Array.isArray(node)) return node.forEach(collect);
        if (typeof node === "object") {
          const obj = node as Record<string, unknown>;
          const t = obj["@type"];
          if (typeof t === "string") types.add(t);
          else if (Array.isArray(t)) t.forEach((x) => typeof x === "string" && types.add(x));
          if (Array.isArray(obj["@graph"])) (obj["@graph"] as unknown[]).forEach(collect);
        }
      };
      collect(parsed);
    } catch {
      // ignore invalid blocks
    }
  }
  const valuable = ["Organization", "Article", "BlogPosting", "FAQPage", "Product", "Service", "WebSite", "BreadcrumbList", "HowTo"];
  const hits = valuable.filter((v) => types.has(v));
  const jsonLdScore = Math.min(100, jsonLdBlocks.length === 0 ? 0 : 40 + hits.length * 15);
  const jsonLdDetail =
    jsonLdBlocks.length === 0
      ? "No JSON-LD blocks on the page."
      : `${jsonLdBlocks.length} block(s); recognised types: ${
          hits.length ? hits.join(", ") : "none of the high-value types"
        }.`;
  results.push(metric("json_ld", "JSON-LD schema", "discovery", jsonLdScore, jsonLdDetail, 1.5));

  // 3. Open Graph
  const ogTags = ["og:title", "og:description", "og:image", "og:type", "og:url"];
  const ogPresent = ogTags.filter((t) => $(`meta[property="${t}"]`).attr("content"));
  const ogScore = (ogPresent.length / ogTags.length) * 100;
  results.push(
    metric(
      "open_graph",
      "Open Graph tags",
      "discovery",
      ogScore,
      `${ogPresent.length}/${ogTags.length} OG tags present.`,
      0.8,
    ),
  );

  // 4. Twitter Card
  const twitterTags = ["twitter:card", "twitter:title", "twitter:description", "twitter:image"];
  const twPresent = twitterTags.filter((t) => $(`meta[name="${t}"]`).attr("content"));
  const twScore = (twPresent.length / twitterTags.length) * 100;
  results.push(
    metric(
      "twitter_card",
      "Twitter Card tags",
      "discovery",
      twScore,
      `${twPresent.length}/${twitterTags.length} Twitter tags present.`,
      0.5,
    ),
  );

  return results;
}

/* ---------------------------------------------------------------------- */
/* Category 2 — Content structure                                         */
/* ---------------------------------------------------------------------- */

function checkStructure($: cheerio.CheerioAPI): MetricResult[] {
  const results: MetricResult[] = [];

  // 1. H1 count — exactly one is ideal
  const h1Count = $("h1").length;
  let h1Score = 0;
  let h1Detail = "";
  if (h1Count === 1) {
    h1Score = 100;
    h1Detail = "Exactly one H1.";
  } else if (h1Count === 0) {
    h1Score = 0;
    h1Detail = "No H1 on the page.";
  } else {
    h1Score = Math.max(20, 100 - (h1Count - 1) * 20);
    h1Detail = `${h1Count} H1 tags found (ideal: 1).`;
  }
  results.push(metric("h1_count", "H1 usage", "structure", h1Score, h1Detail, 1));

  // 2. Heading hierarchy — no level skipped (e.g. h1 -> h3)
  const headingLevels: number[] = [];
  $("h1, h2, h3, h4, h5, h6").each((_, el) => {
    // `el` is a domhandler Element with a `tagName` string ("h1" .. "h6").
    const tag = (el as { tagName?: string }).tagName ?? "";
    const lvl = parseInt(tag.slice(1), 10);
    if (!Number.isNaN(lvl)) headingLevels.push(lvl);
  });
  let skips = 0;
  for (let i = 1; i < headingLevels.length; i++) {
    if (headingLevels[i] > headingLevels[i - 1] + 1) skips++;
  }
  const totalHeadings = headingLevels.length;
  const hierarchyScore =
    totalHeadings === 0 ? 20 : Math.max(0, 100 - skips * 20);
  const hierarchyDetail =
    totalHeadings === 0
      ? "No headings on the page."
      : `${totalHeadings} headings, ${skips} level skip(s).`;
  results.push(metric("heading_hierarchy", "Heading hierarchy", "structure", hierarchyScore, hierarchyDetail, 0.8));

  // 3. Word count — aim for 300+ on the homepage
  const text = $("body").text().replace(/\s+/g, " ").trim();
  const words = text ? text.split(" ").length : 0;
  let wcScore = 0;
  if (words >= 800) wcScore = 100;
  else if (words >= 400) wcScore = 80;
  else if (words >= 200) wcScore = 55;
  else if (words >= 80) wcScore = 30;
  results.push(metric("word_count", "Content depth", "structure", wcScore, `${words} words of body text.`, 1));

  // 4. FAQ detection — FAQPage schema OR ≥2 question-shaped headings
  const ldBlocks = $('script[type="application/ld+json"]')
    .map((_, el) => $(el).html() ?? "")
    .get();
  const hasFaqSchema = ldBlocks.some((s: string) => s.includes('"FAQPage"'));
  const questionHeadings = $("h2, h3").filter((_, el) => {
    const t = $(el).text().trim();
    return /\?$/.test(t);
  }).length;
  let faqScore = 0;
  let faqDetail = "No FAQ schema and no question-style headings detected.";
  if (hasFaqSchema) {
    faqScore = 100;
    faqDetail = "FAQPage schema present.";
  } else if (questionHeadings >= 3) {
    faqScore = 75;
    faqDetail = `${questionHeadings} question-style headings (no FAQ schema).`;
  } else if (questionHeadings >= 1) {
    faqScore = 45;
    faqDetail = `${questionHeadings} question-style heading(s) (no FAQ schema).`;
  }
  results.push(metric("faq", "FAQ / Q&A signals", "structure", faqScore, faqDetail, 1.2));

  // 5. Semantic HTML usage
  const semanticTags = ["main", "article", "section", "nav", "header", "footer", "aside"];
  const semanticPresent = semanticTags.filter((t) => $(t).length > 0);
  const semScore = (semanticPresent.length / semanticTags.length) * 100;
  results.push(
    metric(
      "semantic_html",
      "Semantic HTML",
      "structure",
      semScore,
      `${semanticPresent.length}/${semanticTags.length} semantic tags used: ${
        semanticPresent.length ? semanticPresent.join(", ") : "none"
      }.`,
      0.7,
    ),
  );

  return results;
}

/* ---------------------------------------------------------------------- */
/* Category 3 — Technical SEO                                             */
/* ---------------------------------------------------------------------- */

async function checkTechnical(page: FetchedPage, $: cheerio.CheerioAPI): Promise<MetricResult[]> {
  const origin = originOf(page.finalUrl);
  const results: MetricResult[] = [];

  // 1. HTTPS
  const isHttps = page.finalUrl.startsWith("https://");
  results.push(
    metric(
      "https",
      "HTTPS",
      "technical",
      isHttps ? 100 : 0,
      isHttps ? "Served over HTTPS." : "Page is not on HTTPS.",
      1,
    ),
  );

  // 2. sitemap.xml present
  const sitemap = await probeUrl(`${origin}/sitemap.xml`);
  const sitemapIndex = sitemap.ok ? sitemap : await probeUrl(`${origin}/sitemap_index.xml`);
  results.push(
    metric(
      "sitemap",
      "Sitemap",
      "technical",
      sitemapIndex.ok ? 100 : 0,
      sitemapIndex.ok ? "sitemap.xml reachable." : "No sitemap.xml at the root.",
      1,
    ),
  );

  // 3. Viewport meta
  const viewport = $('meta[name="viewport"]').attr("content") || "";
  const hasViewport = viewport.includes("width=");
  results.push(
    metric(
      "viewport",
      "Mobile viewport",
      "technical",
      hasViewport ? 100 : 0,
      hasViewport ? "Viewport meta set." : "No viewport meta tag.",
      0.6,
    ),
  );

  // 4. TTFB
  const ttfb = page.ttfb ?? 99_999;
  let ttfbScore = 0;
  if (ttfb < 300) ttfbScore = 100;
  else if (ttfb < 600) ttfbScore = 80;
  else if (ttfb < 1200) ttfbScore = 55;
  else if (ttfb < 2500) ttfbScore = 30;
  results.push(metric("ttfb", "Time to first byte", "technical", ttfbScore, `~${ttfb} ms TTFB.`, 0.8));

  // 5. Canonical
  const canonical = $('link[rel="canonical"]').attr("href");
  results.push(
    metric(
      "canonical",
      "Canonical tag",
      "technical",
      canonical ? 100 : 0,
      canonical ? `Canonical → ${canonical}` : "No canonical link tag.",
      0.6,
    ),
  );

  // 6. AI crawler access — robots.txt opt-outs for major LLM crawlers.
  // A missing robots.txt is not a failure: it means every crawler is allowed.
  const robots = await fetchRobots(origin);
  let crawlerScore: number;
  let crawlerDetail: string;
  if (robots === null) {
    crawlerScore = 100;
    crawlerDetail = "No robots.txt — all AI crawlers allowed by default.";
  } else {
    const groups = parseRobots(robots);
    const blocked = AI_CRAWLERS.filter((bot) => isBotBlocked(groups, bot));
    crawlerScore = Math.round(((AI_CRAWLERS.length - blocked.length) / AI_CRAWLERS.length) * 100);
    crawlerDetail =
      blocked.length === 0
        ? `robots.txt allows all ${AI_CRAWLERS.length} major AI crawlers.`
        : `robots.txt blocks ${blocked.length}/${AI_CRAWLERS.length}: ${blocked.join(", ")}.`;
  }
  results.push(
    metric("ai_crawlers", "AI crawler access", "technical", crawlerScore, crawlerDetail, 1.4),
  );

  return results;
}

/* ---------------------------------------------------------------------- */
/* Aggregation                                                            */
/* ---------------------------------------------------------------------- */

/** Weighted average of metric scores (0..100), rounded; 0 for an empty set. */
function weightedAverage(rows: MetricResult[]): number {
  const weighted = rows.reduce((s, m) => s + m.score * (m.weight ?? 1), 0);
  const wsum = rows.reduce((s, m) => s + (m.weight ?? 1), 0);
  return wsum > 0 ? Math.round(weighted / wsum) : 0;
}

function aggregate(metrics: MetricResult[]): {
  total: number;
  geoScore: number;
  seoScore: number;
  byCategory: Record<MetricCategory, number>;
} {
  // Per-category subtotals — shown as the card's section breakdown only.
  const byCategory: Record<MetricCategory, number> = {
    discovery: 0,
    structure: 0,
    technical: 0,
  };
  for (const cat of Object.keys(byCategory) as MetricCategory[]) {
    byCategory[cat] = weightedAverage(metrics.filter((m) => m.category === cat));
  }

  // GEO and SEO subtotals — these drive the total score. The tags are
  // independent, so a metric tagged both would contribute to each.
  const geoScore = weightedAverage(metrics.filter((m) => m.geo));
  const seoScore = weightedAverage(metrics.filter((m) => m.seo));
  const total = Math.round(
    geoScore * GEO_SEO_WEIGHTS.geo + seoScore * GEO_SEO_WEIGHTS.seo,
  );
  return { total, geoScore, seoScore, byCategory };
}

/* ---------------------------------------------------------------------- */
/* Entrypoint                                                             */
/* ---------------------------------------------------------------------- */

export async function auditSite(url: string): Promise<SiteAudit> {
  const page = await fetchPage(url);
  if (!page.ok || !page.html) {
    return {
      url,
      finalUrl: page.finalUrl,
      ttfb: page.ttfb,
      fetchOk: false,
      fetchError: page.error || `HTTP ${page.status}`,
      metrics: [],
      totalScore: 0,
      geoScore: 0,
      seoScore: 0,
      categoryScores: { discovery: 0, structure: 0, technical: 0 },
    };
  }
  const $ = cheerio.load(page.html);
  const [discovery, structure, technical] = await Promise.all([
    checkDiscovery(page, $),
    Promise.resolve(checkStructure($)),
    checkTechnical(page, $),
  ]);
  const metrics = [...discovery, ...structure, ...technical];
  const { total, geoScore, seoScore, byCategory } = aggregate(metrics);
  return {
    url,
    finalUrl: page.finalUrl,
    ttfb: page.ttfb,
    fetchOk: true,
    metrics,
    totalScore: total,
    geoScore,
    seoScore,
    categoryScores: byCategory,
  };
}
