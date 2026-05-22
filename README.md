# geo-compare

Simple static GEO metrics comparison tool. Takes a client URL and a competitor URL, fetches each (server-side), runs a battery of static checks, and renders side-by-side progress bars + a weighted total score. Exportable as a Citorra-branded PNG.

Scope is intentionally small — this is the precursor to `citorra-audit`, not a replacement.

## Run

```bash
npm install
npm run dev
# open http://localhost:3000
```

## What it checks

- **llms.txt + structured data** — llms.txt, llms-full.txt, JSON-LD schema types, Open Graph, Twitter Card.
- **Content structure** — H1 count, heading hierarchy, word count, FAQ detection, semantic HTML usage.
- **Technical SEO basics** — HTTPS, sitemap.xml, viewport meta, TTFB, canonical tag.

Each check returns 0–100; weighted total per site is shown alongside the comparison bars.
