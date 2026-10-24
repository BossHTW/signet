// CRS Credit API sandbox adapter. Use ONLY CRS-provided test identities (see https://calhacks.crscreditapi.com).
// The exact endpoint shape comes from their docs; CRS_VERIFY_PATH defaults to a generic POST. Falls back to mock if not configured.
import type { VendorCheckAdapter } from "./types";
import { crsMock } from "./crs.mock";

const BASE = process.env.CRS_BASE_URL ?? "";
const KEY = process.env.CRS_API_KEY ?? "";
const PATH = process.env.CRS_VERIFY_PATH ?? "/v1/identity/verify";

export const crsLive: VendorCheckAdapter = {
  source: "LIVE",
  async verifyVendor(args) {
    if (!BASE || !KEY || !args.crsTestIdentityId) return crsMock.verifyVendor(args);
    const res = await fetch(`${BASE}${PATH}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` }, body: JSON.stringify({ identityId: args.crsTestIdentityId, businessName: args.legalName }) });
    if (!res.ok) return { status: "UNKNOWN", riskFlags: [`crs ${res.status}`], source: "LIVE" };
    const j = (await res.json()) as { verified?: boolean; status?: string; flags?: string[]; riskFlags?: string[] };
    const flags = j.riskFlags ?? j.flags ?? [];
    const status = j.verified === true || j.status === "verified" ? (flags.length ? "FLAGGED" : "VERIFIED") : j.verified === false ? "UNVERIFIED" : "UNKNOWN";
    return { status, riskFlags: flags, source: "LIVE" };
  },
};
