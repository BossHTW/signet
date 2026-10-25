"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const PRIMARY: [string, string][] = [["/today", "Today"], ["/review", "Review"], ["/queue", "Requests"], ["/batches", "Batches"]];
const MORE: [string, string][] = [["/requests/new", "New request"], ["/rules", "Rules"], ["/audit", "Audit log"], ["/reports", "Funder reports"], ["/metrics", "Metrics"], ["/integrations", "Integrations"]];

export function Nav() {
  const path = usePathname();
  if (!path || path.startsWith("/where-did-the-50-dollars-go")) return null;
  const is = (href: string) => path === href || path.startsWith(`${href}/`);
  return (
    <nav className="nav relative" aria-label="Primary">
      {PRIMARY.map(([href, label]) => <Link key={href} href={href} aria-current={is(href) ? "page" : undefined}>{label}</Link>)}
      <details className="menu relative">
        <summary aria-current={MORE.some(([h]) => is(h)) ? "page" : undefined}>More</summary>
        <div>{MORE.map(([href, label]) => <Link key={href} href={href}>{label}</Link>)}</div>
      </details>
    </nav>
  );
}
