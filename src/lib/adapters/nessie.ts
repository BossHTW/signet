// Capital One Nessie (hackathon sandbox) adapter. Base: http://api.nessieisreal.com  (key as ?key=)
// Setup once: npm run nessie:setup  → creates a customer + checking account and stores the account id in data/nessie.json
import fs from "node:fs";
import type { BankAdapter, BankPosting } from "./types";
import { nessieMock } from "./nessie.mock";

const BASE = process.env.NESSIE_BASE_URL ?? "http://api.nessieisreal.com";
const KEY = process.env.NESSIE_API_KEY ?? "";
const STATE = "./data/nessie.json";

function state(): { accountId?: string; customerId?: string } {
  try { return JSON.parse(fs.readFileSync(STATE, "utf8")); } catch { return {}; }
}
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${BASE}${path}${path.includes("?") ? "&" : "?"}key=${KEY}`;
  const res = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  if (!res.ok) throw new Error(`Nessie ${res.status} ${path}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export async function nessieSetup() {
  if (!KEY) throw new Error("NESSIE_API_KEY missing");
  const cust = await api<{ objectCreated: { _id: string } }>("/customers", { method: "POST", body: JSON.stringify({ first_name: "BCYFS", last_name: "Operations", address: { street_number: "1", street_name: "Civic Center Plaza", city: "Bay County", state: "CA", zip: "94102" } }) });
  const customerId = cust.objectCreated._id;
  const acct = await api<{ objectCreated: { _id: string } }>(`/customers/${customerId}/accounts`, { method: "POST", body: JSON.stringify({ type: "Checking", nickname: "Client Assistance Operating", rewards: 0, balance: 2_500_000 }) });
  const accountId = acct.objectCreated._id;
  fs.writeFileSync(STATE, JSON.stringify({ customerId, accountId }, null, 2));
  return { customerId, accountId };
}

/** Push the seeded mock postings into Nessie as purchases so LIVE mode reconciles against real API data. */
export async function nessiePushSeed(postings: BankPosting[]) {
  const { accountId } = state();
  if (!accountId) throw new Error("run nessieSetup first");
  let n = 0;
  for (const p of postings) {
    if (p.amountCents <= 0) continue;
    // Nessie purchases need a merchant; create one lazily per descriptor (cheap at this scale)
    const m = await api<{ objectCreated: { _id: string } }>("/merchants", { method: "POST", body: JSON.stringify({ name: p.descriptor.slice(0, 40), category: "assistance", address: { street_number: "1", street_name: "Main", city: "Bay County", state: "CA", zip: "94102" }, geocode: { lat: 37.77, lng: -122.42 } }) });
    await api(`/accounts/${accountId}/purchases`, { method: "POST", body: JSON.stringify({ merchant_id: m.objectCreated._id, medium: "balance", purchase_date: p.postedAt, amount: p.amountCents / 100, status: "completed", description: p.descriptor }) });
    n++;
  }
  return n;
}

export const nessieLive: BankAdapter = {
  source: "NESSIE",
  async listPostings(args) {
    const { accountId } = state();
    if (!KEY || !accountId) return nessieMock.listPostings(args); // graceful: fall back if not set up
    const purchases = await api<{ _id: string; purchase_date: string; amount: number; description?: string; merchant_id: string }[]>(`/accounts/${accountId}/purchases`);
    return purchases.map((p) => ({ id: p._id, postedAt: p.purchase_date, amountCents: Math.round(p.amount * 100), descriptor: p.description ?? p.merchant_id }));
  },
  async transfer({ vendorName, amountCents, memo }) {
    const { accountId } = state();
    if (!KEY || !accountId) return nessieMock.transfer({ vendorId: "", vendorName, amountCents, memo });
    const w = await api<{ objectCreated: { _id: string; transaction_date: string } }>(`/accounts/${accountId}/withdrawals`, { method: "POST", body: JSON.stringify({ medium: "balance", transaction_date: new Date().toISOString().slice(0, 10), amount: amountCents / 100, status: "completed", description: `${memo} ${vendorName}`.slice(0, 60) }) });
    return { txnId: w.objectCreated._id, postedAt: w.objectCreated.transaction_date };
  },
};
