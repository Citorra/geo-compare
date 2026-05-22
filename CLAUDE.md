# geo-compare — context for Claude Code

This project is a **static GEO metrics comparison tool** for Citorra. It's the lightweight precursor to the bigger `../citorra-audit` project (which does full Playwright-driven citation-rate audits across ChatGPT / Claude / Gemini / Perplexity). Do not conflate the two — `geo-compare` deliberately has no LLM/browser-automation surface.

## What it does

Takes a client URL and a competitor URL → fetches each page server-side → runs 15 static checks → renders side-by-side progress bars and a weighted total score → one-click PNG export of the result card (Citorra-branded).

Stack: Next.js 16 App Router (`pages` not used), React 19, TypeScript strict, Tailwind + shadcn/ui primitives (local copies under `src/components/ui/`), cheerio for HTML parsing, `html-to-image` for the PNG export.

## Run

```bash
npm install
npm run dev          # http://localhost:3000
npm run build        # production build
npm run typecheck    # tsc --noEmit
```

Node 22+.

## Architecture (where to change what)

- `src/lib/types.ts` — `MetricResult`, `SiteAudit`, `AuditComparison`. `CATEGORY_WEIGHTS` controls how the three categories combine into the total score.
- `src/lib/fetcher.ts` — `fetchPage`, `probeUrl`, `fetchRobots`, `normalizeUrl`. All network calls go through here so we can swap in caching / retry without touching metric code.
- `src/lib/metrics.ts` — pure functions per category (`checkDiscovery`, `checkStructure`, `checkTechnical`) and the `auditSite` entrypoint. **Adding a new metric = add one function call in the right category and let the aggregator do the rest.** Each metric returns 0–100 plus a `weight` (relative within its category) and a one-line `detail` string shown under the bar. Static "why this matters" copy lives in the `METRIC_WHY` map (keyed by metric id) and is attached automatically by the `metric()` helper.
- `src/app/api/audit/route.ts` — POST endpoint. Always audits the client; audits the competitor too (`Promise.all`) only when a non-empty `competitorUrl` is supplied. Returns `AuditComparison` with `competitor` omitted in single-site mode.
- `src/app/page.tsx` — input form + result card host + export-to-PNG button (dynamic-imports `html-to-image` so it stays out of the server bundle). A "Compare against a competitor" switch (`compareMode`, default off) shows/hides the competitor inputs and decides whether `competitorUrl` is sent.
- `src/components/comparison-card.tsx` — the branded card that gets captured by the PNG exporter. Fixed at 920px wide so the export is consistent. Derives `isComparison` from `data.competitor`: when absent it renders a single full-width column and switches header copy to "GEO Audit". Takes a `showWhy` prop that toggles the per-metric "why this matters" notes on/off (set per audit via the switch on `page.tsx`; affects both the on-screen view and the PNG export since the same node is captured).

## Scoring model

- Each metric: 0–100. Status (`pass`/`partial`/`fail`) derived from score thresholds (80/40).
- Category score: weighted average of its metrics (per-metric `weight` field).
- Total: weighted average of category scores using `CATEGORY_WEIGHTS` in `types.ts` (discovery 40%, structure 35%, technical 25%).

If you change weights or add/remove metrics, the result card auto-adapts — it iterates over the metrics returned by the API rather than hardcoding the list.

## Known follow-ups (in priority order)

1. **Multi-page audit** — currently scores only the URL given. Worth scoring homepage + one deep page (e.g. a blog post) for a more representative score.
2. **Caching** — every request re-fetches. Cheap in-memory LRU keyed by URL would be enough for the demo phase.

### Done

- **Single-site mode** — the competitor is optional. `AuditComparison.competitor` is `competitor?: SiteAudit`; the API skips the second audit when no `competitorUrl` is sent; `page.tsx` has a `compareMode` switch; `comparison-card.tsx` renders a one-column "GEO Audit" card when `data.competitor` is absent.
- **AI crawler access check** — `ai_crawlers` metric in the `technical` category. `fetchRobots` in `fetcher.ts` + the `parseRobots`/`isBotBlocked` helpers in `metrics.ts` check robots.txt opt-outs for GPTBot, ClaudeBot, anthropic-ai, PerplexityBot, Google-Extended, CCBot. Folded into `technical` (not a new category) because a missing robots.txt still leaves all crawlers free — it's an opt-out signal, not a hard access gate.
- **Per-metric "why this matters" notes** — `METRIC_WHY` copy + `showWhy` toggle on the card (see Architecture above).

## Conventions

- Server-side only for fetching (CORS, and we don't want client IPs hitting target sites).
- All metrics are pure functions of `(FetchedPage, CheerioAPI)` plus a few external probes — no shared mutable state.
- shadcn primitives are local files, not a CLI install. Tweak them directly when needed.
- Citorra brand color is defined in `tailwind.config.ts` as `citorra` (DEFAULT/ink/mute). Use `bg-citorra`, `text-citorra-ink`, `text-citorra-mute`.

## What lives elsewhere

- `../citorra-audit/` — the bigger Playwright + Drizzle + per-engine driver project. Different scope, different lifecycle. Do not import from it.
