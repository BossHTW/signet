// Capital One Nessie (hackathon sandbox) adapter. Base: https://api.nessieisreal.com  (key as ?key=)
// Setup once: npm run nessie:setup  → creates a customer + checking account and stores the account id in data/nessie.json
import fs from "node:fs";
import dns from "node:dns";
try { dns.setDefaultResultOrder("ipv4first"); } catch { /* older runtimes */ } // flaky-IPv6 Wi-Fi: see scripts/env.ts
import type { BankAdapter, BankPosting } from "./types";
import { nessieMock } from "./nessie.mock";
import { chargeDemoLive } from "@/lib/demoLimit";

// read lazily: scripts load .env.local after importing this module
const BASE = () => process.env.NESSIE_BASE_URL ?? "https://api.nessieisreal.com";
const KEY = () => (process.env.NESSIE_API_KEY ?? "").trim().replace(/^["']|["']$/g, "");
const STATE = "./data/nessie.json";

function state(): { accountId?: string; customerId?: string; merchants?: Record<string, string> } {
  try { return JSON.parse(fs.readFileSync(STATE, "utf8")); } catch { return {}; }
}
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${BASE()}${path}${path.includes("?") ? "&" : "?"}key=${KEY()}`;
  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) }, signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`Nessie ${res.status} ${path}: ${await res.text()}`);
      return res.json() as Promise<T>;
    } catch (e) {
      if ((e as Error).message.startsWith("Nessie ")) throw e; // real HTTP error: do not retry
      const cause = (e as { cause?: { code?: string; message?: string } }).cause;
      lastErr = new Error(`Nessie unreachable at ${BASE()} (${cause?.code ?? cause?.message ?? (e as Error).name}: ${(e as Error).message}). Check the network / NESSIE_BASE_URL.`);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  throw lastErr;
}

export async function nessieSetup() {
  if (state().accountId && !process.argv.includes("--reset")) return state() as { customerId: string; accountId: string };
  if (!KEY()) throw new Error("NESSIE_API_KEY missing");
  const cust = await api<{ objectCreated: { _id: string } }>("/customers", { method: "POST", body: JSON.stringify({ first_name: "BCYFS", last_name: "Operations", address: { street_number: "1", street_name: "Civic Center Plaza", city: "Bay County", state: "CA", zip: "94102" } }) });
  const customerId = cust.objectCreated._id;
  const acct = await api<{ objectCreated: { _id: string } }>(`/customers/${customerId}/accounts`, { method: "POST", body: JSON.stringify({ type: "Checking", nickname: "Client Assistance Operating", rewards: 0, balance: 2_500_000 }) });
  const accountId = acct.objectCreated._id;
  fs.writeFileSync(STATE, JSON.stringify({ customerId, accountId }, null, 2));
  return { customerId, accountId };
}

/** Push the seeded mock postings into Nessie as purchases so LIVE mode reconciles against real API data. */
export async function nessiePushSeed(postings: BankPosting[], onProgress?: (done: number, total: number) => void) {
  const st = state();
  if (!st.accountId) throw new Error("run nessieSetup first");
  const merchants: Record<string, string> = st.merchants ?? {};
  let n = 0;
  const todo = postings.filter((p) => p.amountCents > 0);
  for (const p of todo) {
    const key = p.descriptor.replace(/\s+\d{1,2}\/\d{1,2}$/, "").trim(); // one merchant per counterparty, not per posting
    if (!merchants[key]) {
      const m = await api<{ objectCreated: { _id: string } }>("/merchants", { method: "POST", body: JSON.stringify({ name: key.slice(0, 40), category: "client assistance", address: { street_number: "1", street_name: "Main St", city: "San Francisco", state: "CA", zip: "94102" }, geocode: { lat: 37.77, lng: -122.42 } }) });
      merchants[key] = m.objectCreated._id;
      fs.writeFileSync(STATE, JSON.stringify({ ...st, merchants }, null, 2));
    }
    await api(`/accounts/${st.accountId}/purchases`, { method: "POST", body: JSON.stringify({ merchant_id: merchants[key], medium: "balance", purchase_date: p.postedAt, amount: p.amountCents / 100, status: "completed", description: p.descriptor }) });
    n++; onProgress?.(n, todo.length);
  }
  return n;
}

export const nessieLive: BankAdapter = {
  source: "NESSIE",
  async listPostings(args) {
    const { accountId } = state();
    if (!KEY() || !accountId) return nessieMock.listPostings(args); // graceful: fall back if not set up
    await chargeDemoLive();
    const [purchases, withdrawals] = await Promise.all([
      api<{ _id: string; purchase_date: string; amount: number; description?: string; merchant_id: string }[]>(`/accounts/${accountId}/purchases`),
      api<{ _id: string; transaction_date: string; amount: number; description?: string }[]>(`/accounts/${accountId}/withdrawals`).catch(() => []),
    ]);
    return [
      ...purchases.map((p) => ({ id: p._id, postedAt: p.purchase_date, amountCents: Math.round(p.amount * 100), descriptor: p.description ?? p.merchant_id })),
      ...withdrawals.map((w) => ({ id: w._id, postedAt: w.transaction_date, amountCents: -Math.round(w.amount * 100), descriptor: w.description ?? "SIGNET PAYOUT" })),
    ];
  },
  async transfer({ vendorName, amountCents, memo }) {
    const { accountId } = state();
    if (!KEY() || !accountId) return nessieMock.transfer({ vendorId: "", vendorName, amountCents, memo });
    await chargeDemoLive();
    const w = await api<{ objectCreated: { _id: string; transaction_date: string } }>(`/accounts/${accountId}/withdrawals`, { method: "POST", body: JSON.stringify({ medium: "balance", transaction_date: new Date().toISOString().slice(0, 10), amount: amountCents / 100, status: "completed", description: `${memo} ${vendorName}`.slice(0, 60) }) });
    return { txnId: w.objectCreated._id, postedAt: w.objectCreated.transaction_date, accountId, raw: w };
  },
};
