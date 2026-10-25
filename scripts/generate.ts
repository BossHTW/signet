// Seeded synthetic world for Bay County Youth & Family Services (fictional). Seed 1309.
// Writes data/seed.json. Run: npm run generate
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { addDays, format, parseISO, subDays } from "date-fns";
import type { Category, Eligibility, LineItemFlag, Program } from "../src/db/types";
import { normalizeVendor } from "../src/lib/engine/match";

export const SEED = 1309;
export const TODAY = "2026-10-24"; // the demo's "today"; keep fixed so tests are deterministic

// ---------- deterministic RNG ----------
export function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type Rng = () => number;
const pick = <T,>(r: Rng, xs: T[]) => xs[Math.floor(r() * xs.length)];
const int = (r: Rng, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const id = (r: Rng, p: string) => p + "_" + Math.floor(r() * 1e9).toString(36).padStart(6, "0");
const day = (d: Date) => format(d, "yyyy-MM-dd");

// ---------- types for the seed file ----------
export type SeedGrant = {
  id: string; name: string; funder: string; periodStart: string; periodEnd: string; totalCents: number; spentCents: number;
  allowedCategories: Category[]; prohibitedItems: string[]; perInstanceCapCents: number; perClientPeriodCapCents: number;
  eligibility: Eligibility; priority: number; active: boolean;
};
export type SeedClient = { id: string; displayName: string; dob: string; programs: Program[]; caseManagerId: string };
export type SeedCM = { id: string; name: string; unit: string };
export type SeedVendor = { id: string; legalName: string; normalizedName: string; aliases: string[]; category: Category; crsTestIdentityId: string | null; crsStatus: "VERIFIED" | "FLAGGED" | "UNVERIFIED" | "UNKNOWN"; nessieAccountId: string | null; descriptor: string };
export type SeedBank = { id: string; accountId: string; postedAt: string; amountCents: number; descriptor: string; counterpartyNormalized: string; source: "MOCK" };
export type SeedDoc = { id: string; kind: "receipt" | "lease" | "utility_bill" | "invoice" | "photo"; sourceHash: string; rawText: string | null; imagePath: string | null };
export type SeedRequest = {
  id: string; clientId: string; caseManagerId: string; category: Category; requestedCents: number; vendorId: string | null;
  vendorNameRaw: string; caseNote: string; requestedAt: string; plantedAnomaly: string | null; documents: SeedDoc[];
  // ground truth for tests / the stub extractor (what a perfect reader would see)
  truth: { vendorName: string; amountCents: number; date: string; lineItems: { label: string; cents: number; flag?: LineItemFlag }[]; clientNameOnDoc?: string };
};
export type Seed = { today: string; caseManagers: SeedCM[]; grants: SeedGrant[]; clients: SeedClient[]; vendors: SeedVendor[]; bank: SeedBank[]; requests: SeedRequest[] };

// ---------- fictional funding streams ----------
const P0 = "2026-07-01", P1 = "2027-06-30";
export const GRANTS: SeedGrant[] = [
  { id: "TYHF", name: "Transitional Youth Housing Fund", funder: "Bay County Housing Authority (fictional)", periodStart: P0, periodEnd: P1, totalCents: 2_400_000_00, spentCents: 0, allowedCategories: ["rent", "deposit"], prohibitedItems: ["late_fee", "gift_card"], perInstanceCapCents: 100_000, perClientPeriodCapCents: 300_000, eligibility: { minAge: 18, maxAge: 24 }, priority: 1, active: true },
  { id: "RRDP", name: "Rapid Rehousing Deposit Pool", funder: "Golden State Youth Futures Foundation (fictional)", periodStart: P0, periodEnd: P1, totalCents: 900_000_00, spentCents: 0, allowedCategories: ["deposit", "rent"], prohibitedItems: ["late_fee"], perInstanceCapCents: 150_000, perClientPeriodCapCents: 150_000, eligibility: { minAge: 18, maxAge: 26, programs: ["TAY"] }, priority: 2, active: true },
  { id: "EUSG", name: "Emergency Utility Stabilization Grant", funder: "Pacific Community Energy Trust (fictional)", periodStart: P0, periodEnd: P1, totalCents: 600_000_00, spentCents: 0, allowedCategories: ["utilities"], prohibitedItems: ["late_fee", "reconnection_penalty"], perInstanceCapCents: 40_000, perClientPeriodCapCents: 80_000, eligibility: {}, priority: 1, active: true },
  { id: "ECG", name: "Education Connectivity Grant", funder: "Bridgepoint Learning Fund (fictional)", periodStart: P0, periodEnd: P1, totalCents: 300_000_00, spentCents: 0, allowedCategories: ["phone"], prohibitedItems: ["late_fee", "device_purchase"], perInstanceCapCents: 15_000, perClientPeriodCapCents: 45_000, eligibility: { minAge: 16, maxAge: 24, programs: ["EDU", "TAY"] }, priority: 1, active: true },
  // FRTF period ended Oct 15 2026 → anomaly 5 lands outside it
  { id: "FRTF", name: "Family Reunification Transit Fund", funder: "Bay County Family Services Levy (fictional)", periodStart: "2025-10-16", periodEnd: "2026-10-15", totalCents: 120_000_00, spentCents: 0, allowedCategories: ["transit"], prohibitedItems: [], perInstanceCapCents: 12_000, perClientPeriodCapCents: 36_000, eligibility: { programs: ["FAMILY"] }, priority: 1, active: true },
  { id: "YDIG", name: "Youth Documents & ID Grant", funder: "Northbay Civic Access Fund (fictional)", periodStart: P0, periodEnd: P1, totalCents: 90_000_00, spentCents: 0, allowedCategories: ["documents"], prohibitedItems: [], perInstanceCapCents: 10_000, perClientPeriodCapCents: 20_000, eligibility: { minAge: 16, maxAge: 24 }, priority: 1, active: true },
  { id: "FTSF", name: "Foster Transition Support Fund", funder: "State Foster Youth Bridge Program (fictional)", periodStart: P0, periodEnd: P1, totalCents: 750_000_00, spentCents: 0, allowedCategories: ["rent", "deposit", "phone", "documents"], prohibitedItems: ["late_fee"], perInstanceCapCents: 75_000, perClientPeriodCapCents: 200_000, eligibility: { minAge: 18, maxAge: 21, programs: ["FOSTER"] }, priority: 3, active: true },
  { id: "GCAF", name: "General Client Assistance Fund", funder: "Bay County General Fund (fictional)", periodStart: P0, periodEnd: P1, totalCents: 1_500_000_00, spentCents: 0, allowedCategories: ["rent", "deposit", "utilities", "phone", "transit", "documents"], prohibitedItems: ["gift_card"], perInstanceCapCents: 50_000, perClientPeriodCapCents: 100_000, eligibility: {}, priority: 9, active: true },
];

// ---------- people ----------
const FIRST = ["Jordan", "Maya", "Devon", "Priya", "Luis", "Aaliyah", "Kai", "Sofia", "Marcus", "Elena", "Tyler", "Nia", "Andre", "Hana", "Isaiah", "Camila", "Owen", "Zara", "Mateo", "Leah", "Jamal", "Ruby", "Theo", "Imani", "Noah", "Ava"];
const LAST_INITIAL = ["A.", "B.", "C.", "D.", "F.", "G.", "H.", "J.", "K.", "L.", "M.", "N.", "P.", "R.", "S.", "T.", "V.", "W."];
const CMS: SeedCM[] = [
  { id: "cm_rivera", name: "D. Rivera", unit: "TAY" }, { id: "cm_okafor", name: "C. Okafor", unit: "TAY" }, { id: "cm_nguyen", name: "T. Nguyen", unit: "TAY" },
  { id: "cm_patel", name: "S. Patel", unit: "Family" }, { id: "cm_kim", name: "J. Kim", unit: "Foster" }, { id: "cm_lopez", name: "M. Lopez", unit: "TAY" },
];

function makeClients(r: Rng): SeedClient[] {
  const out: SeedClient[] = [];
  const today = parseISO(TODAY);
  for (let k = 0; k < 24; k++) {
    const age = k < 22 ? int(r, 16, 26) : 27; // two ineligible-age clients
    const dob = day(subDays(today, age * 365 + int(r, 10, 300)));
    const programs: Program[] = [];
    if (age >= 18 && r() < 0.7) programs.push("TAY");
    if (age <= 24 && r() < 0.5) programs.push("EDU");
    if (r() < 0.3) programs.push("FAMILY");
    if (age >= 18 && age <= 21 && r() < 0.4) programs.push("FOSTER");
    if (!programs.length) programs.push(age >= 18 ? "TAY" : "EDU");
    out.push({ id: id(r, "cl"), displayName: `${FIRST[k % FIRST.length]} ${pick(r, LAST_INITIAL)}`, dob, programs, caseManagerId: pick(r, CMS).id });
  }
  return out;
}

// ---------- vendors ----------
function makeVendors(r: Rng): SeedVendor[] {
  const v = (legalName: string, category: Category, descriptor: string, aliases: string[] = [], crsStatus: SeedVendor["crsStatus"] = "VERIFIED"): SeedVendor => ({
    id: id(r, "v"), legalName, normalizedName: normalizeVendor(legalName),
    // finance teams keep the bank's descriptor string on the vendor record; the first landlord deliberately has none (anomaly 1)
    aliases: legalName === "Bay Area Housing LLC" ? aliases : [...aliases, descriptor], category, crsTestIdentityId: null, crsStatus, nessieAccountId: null, descriptor,
  });
  const mark = (vendor: SeedVendor, persona: string): SeedVendor => ({ ...vendor, crsTestIdentityId: persona });
  return [
    // landlords (the first has NO alias so anomaly 1 triggers MATCH-LOW/BANK-LOW)
    v("Bay Area Housing LLC", "rent", "BAY PROP MGMT"),
    mark(v("Mission Terrace Apartments LP", "rent", "MISSION TERRACE APTS", ["Mission Terrace"]), "P01"), // live CRS FraudFinder: prime persona -> VERIFIED
    v("Sunset Residential Partners", "rent", "SUNSET RESIDENTIAL", ["Sunset Residential"]),
    v("Harbor View Housing Co", "deposit", "HARBOR VIEW HOUSING"),
    v("Westside Commons Management", "rent", "WESTSIDE COMMONS MGMT", ["Westside Commons"]),
    // utilities
    v("Pacific Gas & Electric Company", "utilities", "PGE*ONLINE PMT", ["PG&E", "PGE"]),
    v("Bay Water & Sewer District", "utilities", "BAY WATER SEWER", ["Bay Water"]),
    v("Northbay Internet Services", "utilities", "NORTHBAY INTERNET", ["Northbay ISP"]),
    // phone
    v("Metro by T-Mobile", "phone", "METROPCS 800-123", ["MetroPCS", "Metro PCS"]),
    v("Cricket Wireless", "phone", "CRICKET WIRELESS", []),
    // transit
    v("Bay Area Rapid Transit", "transit", "BART CLIPPER", ["BART", "Clipper"]),
    v("Golden Gate Transit", "transit", "GOLDEN GATE TRANSIT", ["GG Transit"]),
    // documents
    v("California DMV", "documents", "CA DMV FEE", ["DMV"]),
    v("Bay County Clerk-Recorder", "documents", "BAY CO CLERK", ["County Clerk"]),
    // the sketchy one (anomaly 7)
    mark(v("Golden Gate Rooms LLC", "deposit", "GG ROOMS", [], "FLAGGED"), "P13"), // live CRS FraudFinder: synthetic-identity persona -> FLAGGED
  ];
}

// ---------- documents ----------
function renderDoc(kind: SeedDoc["kind"], t: SeedRequest["truth"], clientName: string): string {
  const li = t.lineItems.map((l) => `${l.label.padEnd(28)} $${(l.cents / 100).toFixed(2)}`).join("\n");
  switch (kind) {
    case "lease":
      return `RENT RECEIPT / STATEMENT\n${t.vendorName}\nTenant: ${t.clientNameOnDoc ?? clientName}\nPeriod: ${t.date}\n${li}\nTotal Due: $${(t.amountCents / 100).toFixed(2)}\nPlease remit by the 5th.`;
    case "utility_bill":
      return `${t.vendorName}\nACCOUNT STATEMENT\nService address on file\nStatement date: ${t.date}\n${li}\nAmount Due $${(t.amountCents / 100).toFixed(2)}\nDue upon receipt`;
    case "invoice":
      return `INVOICE\n${t.vendorName}\nBill to: ${t.clientNameOnDoc ?? clientName}\nDate: ${t.date}\n${li}\nTOTAL $${(t.amountCents / 100).toFixed(2)}`;
    default:
      return `${t.vendorName}\n${t.date}\n${li}\nTotal ${"$"}${(t.amountCents / 100).toFixed(2)}\nThank you`;
  }
}

export function ocrNoise(r: Rng, s: string, level: 0 | 1 | 2 | 3): string {
  const ops: ((t: string) => string)[] = [
    (t) => t.replace(/0/g, (m) => (r() < 0.12 ? "O" : m)).replace(/1/g, (m) => (r() < 0.08 ? "l" : m)),
    (t) => t.replace(/\$ ?(\d+)\.(\d\d)/g, (m, a, b) => (r() < 0.15 ? `$${a}${b}` : m)),
    (t) => t.split("\n").map((l) => (r() < 0.08 && l.length > 12 ? l.slice(0, Math.floor(l.length * 0.7)) + "…" : l)).join("\n"),
    (t) => t.replace(/(\w)(\w)/g, (m, a, b) => (r() < 0.008 ? b + a : m)),
    (t) => (r() < 0.3 ? t.replace("Total", "TOTAI").replace("Amount Due", "AMOUNT DUE:") : t),
  ];
  let out = s;
  for (let k = 0; k < level; k++) out = pick(r, ops)(out);
  return out;
}

// ---------- requests ----------
const NOTES: Record<Category, string[]> = {
  rent: ["Client at risk of eviction, landlord agreed to accept partial.", "Monthly rent, client started new job last week.", "Rent for October, roommate moved out."],
  deposit: ["Move-in deposit for approved unit, lease starts Monday.", "Deposit needed to hold the room; landlord gave 48 hrs."],
  utilities: ["Electric shutoff notice received, needs payment this week.", "Water bill overdue, client was hospitalized last month.", "Internet needed for online classes."],
  phone: ["Phone plan so client can receive job callbacks.", "Monthly plan, client interviewing this week."],
  transit: ["Clipper reload for work commute.", "Transit to family visitation (court-ordered schedule)."],
  documents: ["State ID replacement so client can start work.", "Birth certificate copy for school enrollment."],
};

export function generate(): Seed {
  const r = mulberry32(SEED);
  const grants = GRANTS;
  const clients = makeClients(r);
  const vendors = makeVendors(r);
  const byCat = (c: Category) => vendors.filter((v) => v.category === c && v.crsStatus === "VERIFIED");
  const today = parseISO(TODAY);
  const bank: SeedBank[] = [];
  const reqs: SeedRequest[] = [];
  const acct = "acct_bcyfs_ops";

  const addBank = (v: SeedVendor, amountCents: number, postedAt: string, lagDays = int(r, 0, 12)) =>
    bank.push({ id: id(r, "tx"), accountId: acct, postedAt: day(addDays(parseISO(postedAt), lagDays)), amountCents, descriptor: `${v.descriptor} ${format(parseISO(postedAt), "MM/dd")}`, counterpartyNormalized: normalizeVendor(v.descriptor), source: "MOCK" });

  const mk = (o: {
    client: SeedClient; category: Category; vendor: SeedVendor | null; vendorNameRaw: string; requestedCents: number; truthAmount?: number;
    daysAgo: number; lineItems?: SeedRequest["truth"]["lineItems"]; kind?: SeedDoc["kind"]; anomaly?: string; note?: string; noise?: 0 | 1 | 2 | 3;
    clientNameOnDoc?: string; docText?: string; docHash?: string; withBank?: boolean; truthVendorName?: string;
  }): SeedRequest => {
    const requestedAt = day(subDays(today, o.daysAgo));
    const amount = o.truthAmount ?? o.requestedCents;
    const lineItems = o.lineItems ?? [{ label: labelFor(o.category), cents: amount }];
    const truth = { vendorName: o.truthVendorName ?? o.vendor?.legalName ?? o.vendorNameRaw, amountCents: amount, date: day(subDays(parseISO(requestedAt), int(r, 0, 6))), lineItems, clientNameOnDoc: o.clientNameOnDoc };
    const kind = o.kind ?? kindFor(o.category);
    const clean = o.docText ?? renderDoc(kind, truth, o.client.displayName);
    const doc: SeedDoc = { id: id(r, "doc"), kind, sourceHash: o.docHash ?? sha(clean), rawText: ocrNoise(r, clean, o.noise ?? (int(r, 0, 2) as 0 | 1 | 2)), imagePath: null };
    if ((o.withBank ?? true) && o.vendor) addBank(o.vendor, amount, truth.date);
    return { id: id(r, "req"), clientId: o.client.id, caseManagerId: o.client.caseManagerId, category: o.category, requestedCents: o.requestedCents, vendorId: o.vendor?.id ?? null, vendorNameRaw: o.vendorNameRaw, caseNote: o.note ?? pick(r, NOTES[o.category]), requestedAt, plantedAnomaly: o.anomaly ?? null, documents: [doc], truth };
  };

  // ---- 52 normal requests (incl. 6 near-misses and 3 legitimate splits) ----
  const eligibleClients = clients.slice(0, 22);
  const amounts: Record<Category, [number, number]> = { rent: [45_000, 79_000], deposit: [40_000, 95_000], utilities: [6_000, 28_000], phone: [4_500, 11_500], transit: [2_000, 9_500], documents: [2_000, 7_000] };
  const catMix: Category[] = ["rent", "rent", "deposit", "utilities", "utilities", "phone", "phone", "transit", "documents"];
  for (let k = 0; k < 43; k++) {
    const client = pick(r, eligibleClients);
    const category = pick(r, catMix);
    const vendor = pick(r, byCat(category));
    const [lo, hi] = amounts[category];
    const amt = Math.round(int(r, lo, hi) / 100) * 100;
    reqs.push(mk({ client, category, vendor, vendorNameRaw: r() < 0.7 ? vendor.legalName : pick(r, [vendor.legalName, ...vendor.aliases]), requestedCents: amt, daysAgo: int(r, 1, 40) }));
  }
  // near-misses: just under the limit
  for (const [category, limit] of [["rent", 80_000], ["utilities", 30_000], ["phone", 12_000], ["deposit", 100_000], ["transit", 10_000], ["documents", 7_500]] as [Category, number][]) {
    const vendor = pick(r, byCat(category));
    reqs.push(mk({ client: pick(r, eligibleClients), category, vendor, vendorNameRaw: vendor.legalName, requestedCents: limit - 500, daysAgo: int(r, 1, 30) }));
  }
  // legitimate splits (rent > TYHF cap, TAY client 18–24 so RRDP picks up the rest) — these escalate on SPLIT-REQ by design
  for (let k = 0; k < 3; k++) {
    const client = eligibleClients.find((c) => c.programs.includes("TAY") && ageOf(c.dob) >= 18 && ageOf(c.dob) <= 24 && !reqs.some((q) => q.clientId === c.id && q.category === "rent")) ?? eligibleClients[k];
    const vendor = byCat("rent")[1 + k];
    reqs.push(mk({ client, category: "rent", vendor, vendorNameRaw: vendor.legalName, requestedCents: 110_000 + k * 5_000, daysAgo: int(r, 2, 25) }));
  }

  // ---- 8 planted anomalies ----
  const tay = (minA = 18, maxA = 24) => eligibleClients.find((c) => c.programs.includes("TAY") && ageOf(c.dob) >= minA && ageOf(c.dob) <= maxA)!;
  const fam = eligibleClients.find((c) => c.programs.includes("FAMILY")) ?? eligibleClients[3];
  const edu = eligibleClients.find((c) => c.programs.includes("EDU") && ageOf(c.dob) <= 24) ?? eligibleClients[4];
  const landlordNoAlias = vendors[0]; // Bay Area Housing LLC → bank says BAY PROP MGMT

  // 1 vendor name mismatch (no alias; bank descriptor differs)
  reqs.push(mk({ client: tay(), category: "rent", vendor: landlordNoAlias, vendorNameRaw: "Bay Area Housing LLC", requestedCents: 72_000, daysAgo: 6, anomaly: "VENDOR_NAME_MISMATCH", kind: "lease", noise: 1, truthVendorName: "Bay Prop Mgmt", note: "Rent receipt is under the landlord's DBA name." }));

  // 2 split funder: $1,200 rent, TYHF cap $1,000 → TYHF + RRDP
  reqs.push(mk({ client: tay(19, 23), category: "rent", vendor: byCat("rent")[2], vendorNameRaw: byCat("rent")[2].legalName, requestedCents: 120_000, daysAgo: 4, anomaly: "SPLIT_FUNDER", kind: "lease", note: "Rent $1,200; landlord will not accept partial payment." }));

  // 3 prohibited late fee on utility bill
  const pge = vendors.find((v) => v.legalName.startsWith("Pacific Gas"))!;
  reqs.push(mk({ client: pick(r, eligibleClients), category: "utilities", vendor: pge, vendorNameRaw: "PG&E", requestedCents: 21_200, daysAgo: 3, anomaly: "PROHIBITED_LATE_FEE", kind: "utility_bill",
    lineItems: [{ label: "Electric service Sep", cents: 17_700 }, { label: "Late Payment Charge", cents: 3_500, flag: "late_fee" }], note: "Shutoff notice; bill includes a late charge." }));

  // 4 duplicate receipt under two names (same document hash, same amount, different clients & CMs, 2 days apart)
  const metro = vendors.find((v) => v.legalName.startsWith("Metro"))!;
  const [cA, cB] = [eligibleClients[5], eligibleClients[9]];
  const dupTruth = { vendorName: metro.legalName, amountCents: 8_999, date: day(subDays(today, 8)), lineItems: [{ label: "Prepaid monthly plan", cents: 8_999 }] };
  const dupText = renderDoc("receipt", dupTruth, "");
  reqs.push(mk({ client: cA, category: "phone", vendor: metro, vendorNameRaw: "Metro by T-Mobile", requestedCents: 8_999, daysAgo: 7, docText: dupText, docHash: sha(dupText), noise: 0, note: "Phone plan for job callbacks.", anomaly: null as unknown as string }));
  reqs.push(mk({ client: cB, category: "phone", vendor: metro, vendorNameRaw: "Metro by T-Mobile", requestedCents: 8_999, daysAgo: 5, docText: dupText, docHash: sha(dupText), noise: 0, anomaly: "DUPLICATE_TWO_NAMES", note: "Client needs phone plan for interviews.", withBank: false }));

  // 5 outside grant period (FRTF ended 2026-10-15; request 4 days later = 9 days ago)
  const bart = vendors.find((v) => v.legalName.startsWith("Bay Area Rapid"))!;
  reqs.push(mk({ client: fam, category: "transit", vendor: bart, vendorNameRaw: "BART", requestedCents: 11_000, daysAgo: 5, anomaly: "OUTSIDE_PERIOD", note: "Transit for court-ordered family visitation." }));

  // 6 ineligible age (27): rent $900, only GCAF ($500 cap) eligible
  const old = clients[22];
  reqs.push(mk({ client: old, category: "rent", vendor: byCat("rent")[3], vendorNameRaw: byCat("rent")[3].legalName, requestedCents: 90_000, daysAgo: 2, anomaly: "INELIGIBLE_AGE", kind: "lease" }));

  // 7 CRS-flagged vendor, deposit $1,100
  const sketchy = vendors.find((v) => v.crsStatus === "FLAGGED")!;
  reqs.push(mk({ client: tay(), category: "deposit", vendor: sketchy, vendorNameRaw: "Golden Gate Rooms", requestedCents: 110_000, daysAgo: 1, anomaly: "CRS_FLAGGED_VENDOR", kind: "invoice", withBank: false, note: "New landlord, wants deposit by Friday to hold the room." }));

  // 8 amount mismatch: CM types $450, bill reads $405.00 (and OCR drops the decimal)
  const water = vendors.find((v) => v.legalName.startsWith("Bay Water"))!;
  reqs.push(mk({ client: pick(r, eligibleClients), category: "utilities", vendor: water, vendorNameRaw: "Bay Water", requestedCents: 45_000, truthAmount: 40_500, daysAgo: 2, anomaly: "AMOUNT_MISMATCH", kind: "utility_bill", noise: 3 }));

  // the EDU client gets a clean phone request too so ECG has history
  reqs.push(mk({ client: edu, category: "phone", vendor: metro, vendorNameRaw: "MetroPCS", requestedCents: 7_500, daysAgo: 12 }));

  // noise postings in the bank feed (unrelated)
  for (let k = 0; k < 14; k++) bank.push({ id: id(r, "tx"), accountId: acct, postedAt: day(subDays(today, int(r, 0, 60))), amountCents: int(r, 1_200, 240_000), descriptor: pick(r, ["AMZN MKTP US", "USPS PO 0944", "OFFICE DEPOT 2210", "UBER TRIP", "COSTCO WHSE #0472", "PAYROLL ADJ"]), counterpartyNormalized: "NOISE", source: "MOCK" });

  // sort oldest → newest so "history" semantics are natural
  reqs.sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
  return { today: TODAY, caseManagers: CMS, grants, clients, vendors, bank, requests: reqs };
}

function ageOf(dob: string) { return Math.floor((parseISO(TODAY).getTime() - parseISO(dob).getTime()) / (365.25 * 86400e3)); }
function labelFor(c: Category) { return ({ rent: "Monthly rent", deposit: "Security deposit", utilities: "Service charges", phone: "Monthly plan", transit: "Transit fare", documents: "Document fee" } as Record<Category, string>)[c]; }
function kindFor(c: Category): SeedDoc["kind"] { return c === "rent" || c === "deposit" ? "lease" : c === "utilities" ? "utility_bill" : "receipt"; }

if (process.argv[1] && process.argv[1].endsWith("generate.ts")) {
  const seed = generate();
  const out = path.join(process.cwd(), "data", "seed.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(seed, null, 2));
  const planted = seed.requests.filter((q) => q.plantedAnomaly);
  console.log(`wrote ${out}: ${seed.requests.length} requests, ${seed.clients.length} clients, ${seed.vendors.length} vendors, ${seed.bank.length} bank postings, ${planted.length} planted anomalies`);
  for (const p of planted) console.log(`  ${(p.plantedAnomaly ?? "").padEnd(24)} ${p.id} ${p.category} $${(p.requestedCents / 100).toFixed(2)} ${p.requestedAt}`);
}
