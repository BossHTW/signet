# Signet — Not a rubber stamp. Not a bottleneck.

Built solo at **Cal Hacks 13.0** (Oct 23–25, 2026). Repo created at the event; all work done at the event.

> **Synthetic data.** Bay County Youth & Family Services, its funders, clients, case managers and documents are
> fictional and generated (`scripts/generate.ts`, seed 1309). Funding-rule *shapes* mirror real public grant
> programs (per-instance caps, period limits, prohibited line items, eligibility by age and program).
> No real organization or person appears anywhere.

## What it does (one function, end to end)

A case manager requests money for or on behalf of a young person (rent, deposit, utilities, phone, transit, documents).

`intake → document reading → grant policy check → vendor/bank match → READY or ESCALATED → human certifies (sampled batch or one by one) → a second human releases → audit → compliance report`

- **One LLM role.** Claude reads documents into fields with per-field confidence and writes one-line summaries. It never approves, denies, allocates or evaluates policy.
- **Two deterministic engines.** `src/lib/engine/policy.ts` (eligibility, caps, prohibited items, period, duplicates, split funding) and `src/lib/engine/match.ts` (vendor identity, bank reconciliation, CRS status).
- **No autonomous money.** The system's only outcomes are `READY` (clean on every check, within the batch limit, one grant) and `ESCALATED`. It never approves, denies or pays.
- **Two named humans on every dollar.** A Program Supervisor (Approver) decides escalations and certifies release batches after opening a random sample (10%, min 3, plus every item ≥ $2,000); a different person, the Finance Director (Releaser), releases the money. Segregation of duties per GAO Green Book ¶10.12 and GAO B-302789; sampling per Green Book OV4.14. **Denial is always a person, with a reason.** Twelve escalation codes.
- **Learning loop.** The Approver's rationale becomes a proposed rule (tiny JSON predicate), replayed against history, activated only by the Releaser: a rule is a control change, so it takes a second person.
- **Append-only, hash-chained audit log.** Grey seal: the system verified. Red seal: a named person certified or released. Only red seals move money. Batch sample selection is deterministic (seeded by batch id) so an auditor can reproduce it.

## Run

```bash
npm install
cp .env.example .env.local        # add ANTHROPIC_API_KEY; MODE=OFFLINE needs no keys
npm run seed                      # 62 synthetic requests, 8 planted anomalies → data/signet.db
npm test                          # all 8 anomalies must trigger; the system may only say READY or ESCALATED
npm run flow                      # headless run of the whole control flow: agent → deny → batch → sample → certify → release
npm run demo:replay               # engines over the whole workload, no LLM, no network
npm run check                     # verifies every external key with one tiny call
npm run public:prefetch           # Bright Data: public records for all vendors + rent benchmark → data/cache/public
npm run nessie:setup              # Capital One Nessie: create account, push the seeded bank feed
npm run dev                       # http://localhost:3000
```

## What's live vs. mocked

| Component | At judging | Fallback |
|---|---|---|
| Claude (Haiku reads, Sonnet writes) | live | committed response cache (`MODE=OFFLINE`) |
| Capital One Nessie (bank feed, transfers) | live | `adapters/nessie.mock.ts` |
| CRS Credit API (vendor identity, test identities only) | live | `adapters/crs.mock.ts` |
| Bright Data (SF business registry + web presence per vendor, HUD fair-market-rent benchmark) | live, cached with `fetched_at` | cached records; built-in FMR fallback, labeled |
| Moss (semantic memory: precedents, grant clauses, vendor aliases) | live | local bag-of-words index, same interface |

The mode badge in the UI always shows `LIVE`, `MOCK` or `OFFLINE`.

## Why not auto-approve? (the control design, briefly)

Standards do not forbid automating *verification*; they require that a named, trained person who can override owns every payment and that an auditor can reconstruct why it happened (2 CFR 200.302–303, GAO Green Book Principle 10, GAO B‑302789 on electronic certification, NIST AI RMF GOVERN/MANAGE, EU AI Act Art. 14 on automation bias, OMB M‑25‑21 on high‑impact AI). AP automation reaches 70–95% "touchless" *processing* while authorization stays human. Signet copies that shape: touchless verification and batching, human certification over a read sample, release by a different person, and human-only denial with a reason and a review path.

## Escalation codes

`POL-HARD` policy fail · `LIMIT-OVER` above auto-approve limit · `SPLIT-REQ` needs two grants · `DUP-HIT` duplicate document or vendor+amount · `AMT-DIFF` document ≠ request · `EXTRACT-LOW` unreadable field · `MATCH-LOW` vendor unclear · `BANK-LOW` no matching posting · `VENDOR-FLAG` CRS flagged · `PUBLIC-NONE` no SF registration or web presence (Bright Data) · `RENT-HIGH` above 125% of HUD FMR (Bright Data) · `RULE-ESC` human-approved rule

## Tracks

Hyphenate · Anthropic (Claude for Public Benefit) · Microsoft · Capital One Nessie · Bright Data · Moss · CRS · Fetch.ai · Creao · Best People-First · Best Solo · Notability · GoDaddy (notarubberstamp.com)

## Next (not built this weekend)

SSO and roles, real grant-management and bank connectors, funder-specific export formats, retention policy.
