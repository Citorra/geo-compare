"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Download, Loader2, Search } from "lucide-react";
import ComparisonCard from "@/components/comparison-card";
import type { AuditComparison } from "@/lib/types";

export default function Page() {
  const [clientUrl, setClientUrl] = React.useState("");
  const [competitorUrl, setCompetitorUrl] = React.useState("");
  const [clientLabel, setClientLabel] = React.useState("");
  const [competitorLabel, setCompetitorLabel] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);
  const [showWhy, setShowWhy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [data, setData] = React.useState<AuditComparison | null>(null);
  const cardRef = React.useRef<HTMLDivElement>(null);

  async function runAudit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    setData(null);
    try {
      const res = await fetch("/api/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientUrl, competitorUrl }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Audit failed.");
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function exportPng() {
    if (!cardRef.current) return;
    setExporting(true);
    try {
      const { toPng } = await import("html-to-image");
      const dataUrl = await toPng(cardRef.current, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: "#ffffff",
      });
      const a = document.createElement("a");
      const slug = (s: string) =>
        s
          .toLowerCase()
          .replace(/^https?:\/\//, "")
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 40);
      a.download = `citorra-audit-${slug(clientUrl)}-vs-${slug(competitorUrl)}.png`;
      a.href = dataUrl;
      a.click();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="container max-w-6xl py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Citorra · GEO Compare</h1>
        <p className="text-muted-foreground mt-1">
          Static, no-LLM metrics comparison between a client site and a competitor.
          Exportable as a Citorra-branded PNG.
        </p>
      </header>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Run a snapshot</CardTitle>
          <CardDescription>
            Enter two URLs. We fetch each page server-side and score llms.txt / schema /
            structure / technical signals.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={runAudit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="client-url">Client URL</Label>
              <Input
                id="client-url"
                placeholder="https://your-client.com"
                value={clientUrl}
                onChange={(e) => setClientUrl(e.target.value)}
                required
              />
              <Label htmlFor="client-label" className="pt-2 block">
                Client display name <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input
                id="client-label"
                placeholder="e.g. Acme Inc."
                value={clientLabel}
                onChange={(e) => setClientLabel(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="competitor-url">Competitor URL</Label>
              <Input
                id="competitor-url"
                placeholder="https://competitor.com"
                value={competitorUrl}
                onChange={(e) => setCompetitorUrl(e.target.value)}
                required
              />
              <Label htmlFor="competitor-label" className="pt-2 block">
                Competitor display name <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input
                id="competitor-label"
                placeholder="e.g. Rival Co."
                value={competitorLabel}
                onChange={(e) => setCompetitorLabel(e.target.value)}
              />
            </div>
            <div className="md:col-span-2 flex items-center gap-3 pt-1">
              <Button type="submit" disabled={loading} size="lg">
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Auditing…
                  </>
                ) : (
                  <>
                    <Search className="h-4 w-4" />
                    Run comparison
                  </>
                )}
              </Button>
              {data && (
                <Button type="button" variant="outline" size="lg" onClick={exportPng} disabled={exporting}>
                  {exporting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Exporting…
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4" />
                      Export as PNG
                    </>
                  )}
                </Button>
              )}
              {data && (
                <div className="flex items-center gap-2">
                  <Switch id="show-why" checked={showWhy} onCheckedChange={setShowWhy} />
                  <Label htmlFor="show-why" className="cursor-pointer font-normal">
                    Show &ldquo;why this matters&rdquo; notes
                  </Label>
                </div>
              )}
              {error && <span className="text-sm text-destructive">{error}</span>}
            </div>
          </form>
        </CardContent>
      </Card>

      {data && (
        <div className="flex justify-center">
          <ComparisonCard
            ref={cardRef}
            data={data}
            clientLabel={clientLabel}
            competitorLabel={competitorLabel}
            showWhy={showWhy}
          />
        </div>
      )}
    </div>
  );
}
