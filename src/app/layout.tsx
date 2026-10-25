import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { display, mono } from "./fonts";
import { ModeBadge } from "@/components/ModeBadge";
import { RoleSwitch } from "@/components/RoleSwitch";
import { Nav } from "@/components/Nav";
import { currentRole } from "@/lib/role";
import { ROLES } from "@/db/types";

export const metadata: Metadata = { title: "Signet", description: "Not a rubber stamp. Not a bottleneck." };
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const role = await currentRole();
  return (
    <html lang="en" className={`${display.variable} ${mono.variable}`}>
      <body className="min-h-screen">
        <header className="topbar">
          <div className="topbar-inner mx-auto max-w-6xl px-6">
            <Link href="/" className="flex items-center gap-2 shrink-0" aria-label="Signet home">
              <span className="seal seal-system" style={{ width: 24, height: 24, fontSize: 11, transform: "none" }} aria-hidden>S</span>
              <span className="font-semibold tracking-tight">Signet</span>
            </Link>
            <Nav />
            <div className="topbar-tools ml-auto flex items-center gap-2">
              <RoleSwitch role={role} />
              <ModeBadge />
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
        <footer className="mx-auto max-w-6xl px-6 py-10 text-xs faint">
          Bay County Youth &amp; Family Services is fictional; all clients, funders and documents are synthetic. Signet verifies and recommends; it never approves, denies or moves money. Signet uses two segregated human roles — a Certifier ({ROLES.supervisor.title}) and a Releaser ({ROLES.finance.title}) — and the releaser is never the certifier. Built solo at Cal Hacks 13.0.
        </footer>
      </body>
    </html>
  );
}
