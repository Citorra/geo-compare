import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Citorra · GEO Compare",
  description: "Static GEO metrics comparison — client vs competitor.",
  // Opt out of Chrome's auto-translation. When mobile Chrome translates the
  // page it rewrites text nodes, which breaks React's DOM reconciliation
  // (removeChild/insertBefore NotFoundError) and blanks the whole app.
  other: { google: "notranslate" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" translate="no">
      <body className="min-h-screen bg-background antialiased">{children}</body>
    </html>
  );
}
