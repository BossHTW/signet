import type { CrsResult } from "@/lib/engine/match";
import type { Mode } from "@/db/types";

export type BankPosting = { id: string; postedAt: string; amountCents: number; descriptor: string };

export interface BankAdapter {
  readonly source: "NESSIE" | "MOCK";
  /** Postings in the operating account within the window. */
  listPostings(args: { sinceDays: number; today: string }): Promise<BankPosting[]>;
  /** Pay a vendor. Returns the bank's transaction id. */
  transfer(args: { vendorId: string; vendorName: string; amountCents: number; memo: string }): Promise<{ txnId: string; postedAt: string; accountId?: string; raw?: unknown }>;
}

export interface VendorCheckAdapter {
  readonly source: "LIVE" | "MOCK";
  verifyVendor(args: { vendorId: string; legalName: string; crsTestIdentityId: string | null; knownStatus: string }): Promise<CrsResult>;
}

export function currentMode(): Mode {
  const m = (process.env.MODE ?? "MOCK").toUpperCase();
  return m === "LIVE" || m === "OFFLINE" ? m : "MOCK";
}
