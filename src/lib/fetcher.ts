/**
 * Server-side fetch helpers. We always identify as a regular browser so sites
 * don't reject us, and we measure TTFB ourselves.
 */

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 CitorraAudit/0.1";

export interface FetchedPage {
  ok: boolean;
  status: number;
  finalUrl: string;
  html: string;
  ttfb: number | null;
  headers: Record<string, string>;
  error?: string;
}

export async function fetchPage(url: string, timeoutMs = 15_000): Promise<FetchedPage> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      cache: "no-store",
    });
    const ttfb = Date.now() - started;
    const html = await res.text();
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
    return { ok: res.ok, status: res.status, finalUrl: res.url, html, ttfb, headers };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      finalUrl: url,
      html: "",
      ttfb: null,
      headers: {},
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(t);
  }
}

/** Quick HEAD/GET probe used for sitemap/llms.txt — returns true on 2xx. */
export async function probeUrl(url: string, timeoutMs = 8_000): Promise<{ ok: boolean; status: number }> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Some servers don't implement HEAD properly, so do a small GET and discard.
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": UA, Accept: "*/*" },
      cache: "no-store",
    });
    // Drain so the connection closes cleanly.
    try {
      await res.arrayBuffer();
    } catch {}
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  } finally {
    clearTimeout(t);
  }
}

export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function originOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return url;
  }
}
