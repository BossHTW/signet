// Runs the seed world through the pure engines in request-date order, with a perfect "truth" extractor.
import { generate, type Seed, type SeedRequest } from "../scripts/generate";
import { runChecks, type RunResult } from "../src/lib/engine/run";
import type { HistoryItem } from "../src/lib/engine/policy";
import { normalizeVendor } from "../src/lib/engine/match";
import { DEFAULT_LIMITS, type Extracted } from "../src/db/types";
import type { GrantStream } from "../src/db/schema";

export function truthExtract(q: SeedRequest, confidence = 0.95): Extracted {
  return {
    vendorName: { value: q.truth.vendorName, confidence },
    amountCents: { value: q.truth.amountCents, confidence },
    date: { value: q.truth.date, confidence },
    lineItems: { value: q.truth.lineItems, confidence },
    ...(q.truth.clientNameOnDoc ? { clientNameOnDoc: { value: q.truth.clientNameOnDoc, confidence } } : {}),
  };
}

export type Outcome = { req: SeedRequest; result: RunResult };

export function runWorld(seed: Seed = generate(), extract = truthExtract): Outcome[] {
  const grants = seed.grants as unknown as GrantStream[];
  const history: HistoryItem[] = [];
  const out: Outcome[] = [];
  for (const q of seed.requests) {
    const client = seed.clients.find((c) => c.id === q.clientId)!;
    const vendor = seed.vendors.find((v) => v.id === q.vendorId);
    const result = runChecks({
      request: q, client, extracted: extract(q), documentHashes: q.documents.map((d) => d.sourceHash),
      grants, vendors: seed.vendors, bank: seed.bank,
      crs: vendor ? { status: vendor.crsStatus, source: "MOCK" } : null,
      history, activeRules: [], limits: DEFAULT_LIMITS, today: seed.today,
    });
    out.push({ req: q, result });
    // history semantics: auto-approved requests count as APPROVED spend; escalated ones are pending (no spend yet)
    history.push({
      requestId: q.id, clientId: q.clientId, clientDisplayName: client.displayName,
      vendorNormalized: normalizeVendor(q.vendorNameRaw), requestedCents: q.requestedCents, requestedAt: q.requestedAt,
      documentHashes: q.documents.map((d) => d.sourceHash), allocation: result.decision.allocation, outcome: result.decision.outcome,
    });
  }
  return out;
}

export const codes = (o: Outcome) => o.result.decision.triggers.map((t) => t.code);
export const byAnomaly = (outs: Outcome[], label: string) => outs.find((o) => o.req.plantedAnomaly === label)!;
