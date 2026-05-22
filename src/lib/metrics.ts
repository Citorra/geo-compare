import * as cheerio from "cheerio";
import { FetchedPage, fetchPage, originOf, probeUrl } from "./fetcher";
import {
  CATEGORY_WEIGHTS,
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

function metric(
  id: string,
  label: string,
  category: MetricCategory,
  score: number,
  detail: string,
  weight = 1,
): MetricResult {
  const s = Math.max(0, Math.min(100, Math.round(score)));
  return { id, label, category, score: s, detail, status: statusFromScore(s), weight };
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

  return results;
}

/* ---------------------------------------------------------------------- */
/* Aggregation                                                            */
/* ---------------------------------------------------------------------- */

function aggregate(metrics: MetricResult[]): {
  total: number;
  byCategory: Record<MetricCategory, number>;
} {
  const byCategory: Record<MetricCategory, number> = {
    discovery: 0,
    structure: 0,
    technical: 0,
  };
  for (const cat of Object.keys(byCategory) as MetricCategory[]) {
    const rows = metrics.filter((m) => m.category === cat);
    const weighted = rows.reduce((s, m) => s + m.score * (m.weight ?? 1), 0);
    const wsum = rows.reduce((s, m) => s + (m.weight ?? 1), 0);
    byCategory[cat] = wsum > 0 ? Math.round(weighted / wsum) : 0;
  }
  const total = Math.round(
    (Object.keys(byCategory) as MetricCategory[])
      .map((c) => byCategory[c] * CATEGORY_WEIGHTS[c])
      .reduce((a, b) => a + b, 0),
  );
  return { total, byCategory };
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
  const { total, byCategory } = aggregate(metrics);
  return {
    url,
    finalUrl: page.finalUrl,
    ttfb: page.ttfb,
    fetchOk: true,
    metrics,
    totalScore: total,
    categoryScores: byCategory,
  };
}
