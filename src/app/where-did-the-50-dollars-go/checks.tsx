import { cookies } from "next/headers";
import { recheckPublicForm } from "@/app/actions";
import { Money, money } from "@/components/Money";
import { TriggerChip } from "@/components/TriggerChip";
import { publicCheckLabel, vendorPublicRecord } from "@/lib/adapters/public";
import { adapters } from "@/lib/adapters";
import { similarity } from "@/lib/engine/match";
import { daysBetween } from "@/lib/engine/util";
import { confidenceWord, FIELD_LABEL } from "@/lib/labels";
import { precedents, TODAY } from "@/lib/pipeline";
import type { Extracted, Field, Trigger } from "@/db/types";

type DecisionBits = {
  requestId: string;
  outcome: string;
  triggers: Trigger[];
  allocation: { grantId: string; cents: number }[];
  caseSummary: string | null;
  policyResult: unknown;
  matchResult: unknown;
  extracted: Extracted | null;
  model: string | null;
};

function fieldLine(key: string, field: Field<unknown>) {
  const word = confidenceWord(field.confidence);
  const value = key === "amountCents"
    ? money(Number(field.value))
    : key === "lineItems"
      ? (field.value as { label: string; cents: number }[]).map((l) => `${l.label} ${money(l.cents)}`).join(", ")
      : String(field.value ?? "");
  return { label: FIELD_LABEL[key] ?? key, value, confidence: field.confidence, word: word.word };
}

export async function Checks({ vendorName, decision, grants }: { vendorName: string; decision: DecisionBits; grants: { id: string; name: string; perInstanceCapCents: number; perClientPeriodCapCents: number }[] }) {
  const { extracted, model } = decision;
  const today = TODAY();
  let postings: { postedAt: string; amountCents: number; descriptor: string }[] = [];
  let bankError = "";
  try {
    const all = await adapters().bank.listPostings({ sinceDays: 60, today });
    postings = all.filter((p) => daysBetween(p.postedAt, today) <= 60);
  } catch (e) { bankError = (e as Error).message; }
  const match = postings.some((p) => Math.abs(p.amountCents - 5000) <= 100 && similarity(p.descriptor, vendorName) >= 0.5);
  const pub = await vendorPublicRecord(vendorName, { allowNetwork: false });
  const label = publicCheckLabel(pub.fetchedAt, (await cookies()).get("signet_public_check")?.value, vendorName);
  const memory = await precedents(decision.requestId);
  const manual = memory.clauses.find((c) => c.id === "man-4.3" || c.metadata?.grant === "§4.3");
  const policy = decision.policyResult as { eligibleGrants?: string[] };
  const crs = decision.matchResult as { crsStatus?: string };
  const bankLow = decision.triggers.some((t) => t.code === "BANK-LOW");

  return (
    <div className="grid gap-6">
      <div>
        <div className="kicker mb-2">Result</div>
        <h2 className="display-std text-[28px]">{decision.outcome} · BANK-LOW</h2>
        {decision.caseSummary && <p className="mt-3 text-[17px]" style={{ maxWidth: "62ch" }}>{decision.caseSummary}</p>}
        {!bankLow && <p className="mt-2 text-[14px]" style={{ color: "var(--seal)" }}>BANK-LOW did not fire. The flags on the record are below.</p>}
        <div className="mt-3 grid gap-2">{decision.triggers.map((t) => <TriggerChip key={t.code} t={t} withReason />)}</div>
      </div>
      <ul className="grid gap-3">
        <li className="card p-5 grid gap-2">
          <div className="kicker">Claude · {model || "model"}</div>
          {(extracted ? (["vendorName", "amountCents", "date", "lineItems"] as const).filter((k) => extracted[k]) : []).map((k) => {
            const line = fieldLine(k, extracted![k] as Field<unknown>);
            return <div key={k} className="flex justify-between gap-4 text-[15px]"><span>{line.label}: {line.value}</span><span className="faint tabular">{Math.round(line.confidence * 100)}% · {line.word}</span></div>;
          })}
        </li>
        <li className="card p-5 grid gap-2">
          <div className="kicker">Policy</div>
          {(policy.eligibleGrants ?? []).map((id) => {
            const g = grants.find((x) => x.id === id);
            const got = decision.allocation.find((a) => a.grantId === id);
            return <div key={id} className="text-[15px]">{g?.name ?? id}{got ? <> · allocated <Money cents={got.cents} /></> : null}{g ? <> · cap <Money cents={g.perInstanceCapCents} /> per instance, <Money cents={g.perClientPeriodCapCents} /> per client</> : null}</div>;
          })}
          {(policy.eligibleGrants ?? []).length === 0 && <div className="text-[15px]">No grant allocated.</div>}
        </li>
        <li className="card p-5 grid gap-2">
          <div className="kicker">Nessie · {adapters().bank.source}</div>
          {bankError && <p style={{ color: "var(--seal)" }}>{bankError}</p>}
          <div className="grid gap-1 overflow-auto" style={{ maxHeight: 220 }}>
            {postings.map((p, i) => <div key={i} className="flex justify-between gap-4 text-[14px]"><span className="truncate">{p.postedAt.slice(0, 10)} · {p.descriptor}</span><span className="tabular">{money(p.amountCents)}</span></div>)}
            {postings.length === 0 && !bankError && <div className="text-[15px]">No postings in the 60-day window.</div>}
          </div>
          {!match && <p className="text-[15px]">No posting matches $50 to PG&E.</p>}
        </li>
        <li className="card p-5 grid gap-1">
          <div className="kicker">CRS · {adapters().vendorCheck.source}</div>
          <div className="text-[15px]">{crs.crsStatus ?? "not checked"}{crs.crsStatus ? ` · ${adapters().vendorCheck.source === "LIVE" ? "live" : "mock"}` : ""}</div>
        </li>
        <li className="card p-5 grid gap-2">
          <div className="kicker">Bright Data · {pub.source}</div>
          <div className="text-[15px]">Registry: {pub.sfBusiness ? (pub.sfBusiness.found ? `registered${pub.sfBusiness.dbaNames[0] ? `, ${pub.sfBusiness.dbaNames[0]}` : ""}` : "not found") : "not checked"}</div>
          <div className="text-[15px]">Web: {pub.web ? (pub.web.found ? pub.web.results[0]?.title ?? "found" : "none") : "not checked"}</div>
          <div className="text-[13px] faint">{label.text} · fetched {pub.fetchedAt.slice(0, 16).replace("T", " ")}</div>
          <form action={recheckPublicForm}><input type="hidden" name="vendor" value={vendorName} /><button className="btn">Re-check live</button></form>
        </li>
        <li className="card p-5 grid gap-2">
          <div className="kicker">Moss · {memory.source}{memory.error ? ` · ${memory.error}` : ""}</div>
          {manual && <p className="text-[15px]">Manual {manual.metadata?.grant} {manual.metadata?.clause}. {manual.text}</p>}
          {!manual && memory.clauses[0] && <p className="text-[15px]">{memory.clauses[0].text}</p>}
          {memory.decisions.slice(0, 2).map((d) => <p key={d.id} className="text-[14px] muted">{d.text}</p>)}
        </li>
      </ul>
    </div>
  );
}
