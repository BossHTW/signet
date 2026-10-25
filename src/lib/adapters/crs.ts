// CRS Credit API (StitchCredit sandbox) vendor-identity check.
// Flow: POST /users/login {username,password} -> data.token ; then POST /fraud-finder/fraud-finder with a CRS-provided
// test persona -> a risk disposition we map to VERIFIED / FLAGGED / UNVERIFIED. We ONLY ever send CRS sandbox test
// personas (never real client or landlord PII), and we NEVER call the FCRA credit/criminal/eviction products.
// Any failure (no creds, network, or any CRSxxx error) degrades to crsMock so the demo never breaks.
import type { VendorCheckAdapter } from "./types";
import type { CrsStatus } from "@/db/types";
import { crsMock } from "./crs.mock";
import { chargeDemoLive } from "@/lib/demoLimit";

const base = () => (process.env.CRS_BASE_URL ?? "https://api-sandbox.stitchcredit.com/api").replace(/\/+$/, "");
const username = () => process.env.CRS_API_USERNAME ?? "";
const password = () => process.env.CRS_API_PASSWORD ?? "";

// CRS sandbox test personas (from the Cal Hacks collection). We attach a persona id to a vendor via crsTestIdentityId;
// the persona's phone/email are synthetic. Expected dispositions: P01 APPROVE (prime), P13 DECLINE (synthetic identity/fraud).
type Persona = { firstName: string; lastName: string; email: string; phoneNumber: string; ipAddress: string; address: { addressLine1: string; city: string; state: string; postalCode: string } };
const PERSONAS: Record<string, Persona> = {
  P01: { firstName: "MARGARET", lastName: "OKAFOR", email: "margaret.okafor@example.com", phoneNumber: "5550101001", ipAddress: "203.0.113.11", address: { addressLine1: "1420 WILLOW CREEK DR", city: "SAN JOSE", state: "CA", postalCode: "95125" } },
  P13: { firstName: "KAYLA", lastName: "BRENNAN", email: "kb.9921x@example.com", phoneNumber: "5550101013", ipAddress: "198.51.100.13", address: { addressLine1: "9021 KINGSTON PIKE", city: "KNOXVILLE", state: "TN", postalCode: "37923" } },
};

let tokenCache: { token: string; at: number } | null = null;
async function token(): Promise<string | null> {
  if (tokenCache && Date.now() - tokenCache.at < 25 * 60_000) return tokenCache.token;
  const r = await fetch(`${base()}/users/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: username(), password: password() }), signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`CRS login HTTP ${r.status}`);
  const j = (await r.json()) as { data?: { token?: string }; token?: string };
  const t = j?.data?.token ?? j?.token;
  if (!t) throw new Error("CRS login returned no token");
  tokenCache = { token: t, at: Date.now() };
  return t;
}

// Map FraudFinder's response to our four statuses. The sandbox's shape varies, so we read it tolerantly and fall back to UNKNOWN.
function mapDisposition(j: unknown): { status: CrsStatus; riskFlags: string[] } {
  const text = JSON.stringify(j ?? {}).toUpperCase();
  const flags: string[] = [];
  const errs = (j as { errors?: { code?: string; message?: string }[] })?.errors ?? [];
  for (const e of errs) if (e?.message) flags.push(e.message);
  const pick = (j as Record<string, unknown>) ?? {};
  const reco = String((pick.recommendation ?? pick.decision ?? pick.disposition ?? pick.result ?? pick.status ?? "")).toUpperCase();
  if (/DECLINE|FRAUD|HIGH\s*RISK|DENY/.test(reco) || /"FRAUD"|DECLINE/.test(text)) return { status: "FLAGGED", riskFlags: flags.length ? flags : ["CRS FraudFinder: declined / high risk"] };
  if (/REVIEW|MEDIUM|CAUTION/.test(reco)) return { status: "FLAGGED", riskFlags: flags.length ? flags : ["CRS FraudFinder: manual review"] };
  if (/APPROVE|PASS|LOW\s*RISK|CLEAR|VERIFIED/.test(reco)) return { status: "VERIFIED", riskFlags: [] };
  return { status: "UNKNOWN", riskFlags: flags };
}

export const crsLive: VendorCheckAdapter = {
  source: "LIVE",
  async verifyVendor(args) {
    const persona = args.crsTestIdentityId ? PERSONAS[args.crsTestIdentityId] : null;
    // No creds, or this vendor has no assigned test persona -> fall back to the seeded mock verdict.
    if (!username() || !password() || !persona) return crsMock.verifyVendor(args);
    await chargeDemoLive();
    try {
      const t = await token();
      const r = await fetch(`${base()}/fraud-finder/fraud-finder`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${t}` },
        body: JSON.stringify({ ...persona, userAgent: "Signet/1.0 (public-benefit disbursement; sandbox)" }),
        signal: AbortSignal.timeout(20000),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { const mock = await crsMock.verifyVendor(args); return { ...mock, source: "LIVE", riskFlags: [...(mock.riskFlags ?? []), `CRS HTTP ${r.status}`], raw: j }; }
      const { status, riskFlags } = mapDisposition(j);
      if (status === "UNKNOWN") { const mock = await crsMock.verifyVendor(args); return { ...mock, source: "LIVE", raw: j }; } // couldn't parse: keep the seeded verdict, show raw
      return { status, riskFlags, source: "LIVE", raw: j };
    } catch (e) {
      const mock = await crsMock.verifyVendor(args); // network / CRSxxx / timeout: never break the pipeline
      return { ...mock, source: "LIVE", riskFlags: [...(mock.riskFlags ?? []), `CRS unavailable: ${(e as Error).message.slice(0, 60)}`] };
    }
  },
};
