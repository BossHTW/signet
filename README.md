# Signet — Not a rubber stamp. Not a bottleneck.

Built solo at **Cal Hacks 13.0** (Oct 23–25, 2026). Repo created at the event; all work done at the event.

> **Synthetic data.** Bay County Youth & Family Services, its funders, clients, case managers and documents are
> fictional and generated (`scripts/generate.ts`, seed 1309). Funding-rule *shapes* mirror real public grant
> programs (per-instance caps, period limits, prohibited line items, eligibility by age and program).
> No real organization or person appears anywhere.

## What it does (one function, end to end)

A case manager requests money for or on behalf of a young person (rent, deposit, utilities, phone, transit, documents).

`intake → document reading → grant policy check → vendor/bank match → disbursal within limits → escalation → audit → compliance report`

- **One LLM role.** Claude reads documents into fields with per-field confidence and writes one-line summaries. It never approves, denies, allocates or evaluates policy.
- **Two deterministic engines.** `src/lib/engine/policy.ts` (eligibility, caps, prohibited items, period, duplicates, split funding) and `src/lib/engine/match.ts` (vendor identity, bank reconciliation, CRS status).
- **One human queue.** Approvals within per-category limits are automatic. **Denial is never autonomous.** Ten escalation codes, each with a reason.
- **Learning loop.** A human's rationale becomes a proposed rule (tiny JSON predicate), replayed against history, activated only by a human.
- **Append-only, hash-chained audit log.** Every decision ends with a seal: grey for the system, red for a human.

## Run

```bash
npm install
cp .env.example .env.local        # add ANTHROPIC_API_KEY; MODE=OFFLINE needs no keys
npm run seed                      # 62 synthetic requests, 8 planted anomalies → data/signet.db
npm test                          # all 8 anomalies must trigger; nothing may be DENIED by code
npm run demo:replay               # engines over the whole workload, no LLM, no network
npm run dev                       # http://localhost:3000
```

## What's live vs. mocked

| Component | At judging | Fallback |
|---|---|---|
| Claude (Haiku reads, Sonnet writes) | live | committed response cache (`MODE=OFFLINE`) |
| Capital One Nessie (bank feed, transfers) | live | `adapters/nessie.mock.ts` |
| CRS Credit API (vendor identity, test identities only) | live | `adapters/crs.mock.ts` |

The mode badge in the UI always shows `LIVE`, `MOCK` or `OFFLINE`.

## Escalation codes

`POL-HARD` policy fail · `LIMIT-OVER` above auto-approve limit · `SPLIT-REQ` needs two grants · `DUP-HIT` duplicate document or vendor+amount · `AMT-DIFF` document ≠ request · `EXTRACT-LOW` unreadable field · `MATCH-LOW` vendor unclear · `BANK-LOW` no matching posting · `VENDOR-FLAG` CRS flagged · `RULE-ESC` human-approved rule

## Tracks

Hyphenate · Anthropic (Claude for Public Benefit) · Microsoft · Capital One Nessie · CRS · Fetch.ai · Creao · Best People-First · Best Solo · Notability · GoDaddy (notarubberstamp.com)

## Next (not built this weekend)

SSO and roles, real grant-management and bank connectors, funder-specific export formats, retention policy.
