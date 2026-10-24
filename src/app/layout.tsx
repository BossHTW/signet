import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { display, serif, mono } from "./fonts";
import { ModeBadge } from "@/components/ModeBadge";

export const metadata: Metadata = { title: "Signet", description: "Not a rubber stamp. Not a bottleneck." };
export const dynamic = "force-dynamic";

const NAV = [["/queue", "Queue"], ["/requests/new", "New request"], ["/rules", "Rules"], ["/audit", "Audit"], ["/reports", "Reports"], ["/metrics", "Metrics"]];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${serif.variable} ${mono.variable}`}>
      <body className="min-h-screen">
        <header style={{ background: "var(--black)", color: "var(--concrete)" }}>
          <div className="mx-auto max-w-6xl px-6 py-4 flex items-center gap-8">
            <Link href="/queue" className="flex items-center gap-3">
              <span className="inline-grid place-items-center w-9 h-9 rounded-full display text-lg" style={{ background: "var(--yellow)", color: "var(--black)" }}>S</span>
              <span className="display text-2xl" style={{ color: "var(--yellow)" }}>Signet</span>
              <span className="hidden md:inline serif italic text-sm" style={{ color: "var(--clay)" }}>Not a rubber stamp. Not a bottleneck.</span>
            </Link>
            <nav className="ml-auto flex items-center gap-5 ui text-sm font-medium">
              {NAV.map(([href, label]) => <Link key={href} href={href} className="hover:underline underline-offset-4" style={{ color: "var(--concrete)" }}>{label}</Link>)}
              <ModeBadge />
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
        <footer className="mx-auto max-w-6xl px-6 py-10 text-sm" style={{ color: "var(--ink2)" }}>
          <div className="rule mb-4" style={{ width: 48 }} />
          Bay County Youth &amp; Family Services is fictional. All clients, funders and documents are synthetic. Built solo at Cal Hacks 13.0.
        </footer>
      </body>
    </html>
  );
}
