import { db, schema } from "@/db/client";
import { newRequestAction } from "@/app/actions";
import { CATEGORIES } from "@/db/types";

export default function NewRequestPage() {
  const clients = db.select().from(schema.clients).all();
  const vendors = db.select().from(schema.vendors).all();
  return (
    <div className="grid gap-4 max-w-3xl">
      <div>
        <div className="kicker mb-2">Try it</div>
        <h1 className="display-std text-[28px]">New request.</h1>
        <p className="muted mt-2" style={{ color: "var(--ink-2)" }}>Type one like a case manager would. Paste the receipt text, or upload a photo and let Claude read it. The agent will read, check, and either pay within limits or bring it to the queue.</p>
      </div>
      <form action={newRequestAction} className="card p-7 grid gap-4">
        <div className="grid md:grid-cols-3 gap-3">
          <div><label>Client</label><select name="clientId" required>{clients.map((c) => <option key={c.id} value={c.id}>{c.displayName} · {c.programs.join("/")}</option>)}</select></div>
          <div><label>Category</label><select name="category" required>{CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
          <div><label>Amount requested ($)</label><input name="amount" type="number" step="0.01" min="1" required placeholder="140.00" /></div>
        </div>
        <div><label>Vendor (as the case manager types it)</label><input name="vendor" required list="vendors" placeholder="Metro by T-Mobile" /><datalist id="vendors">{vendors.map((v) => <option key={v.id} value={v.legalName} />)}</datalist></div>
        <div><label>Case note</label><input name="note" placeholder="Phone plan so client can receive job callbacks." /></div>
        <div><label>Document text (paste OCR or type what the bill says)</label><textarea name="rawText" rows={6} placeholder={"Metro by T-Mobile\nStatement 10/20/2026\nMonthly plan            $125.00\nLate payment fee         $15.00\nAmount Due              $140.00"} /></div>
        {process.env.DEMO_PUBLIC === "1" ? null : <div><label>Or a photo of the document (jpg/png)</label><input name="photo" type="file" accept="image/*" /></div>}
        <div className="flex flex-wrap items-center gap-3"><button className="btn btn-primary btn-lg">Submit to the agent</button><span className="text-[13px] muted">Judges: try a late fee, a duplicate, or an amount that doesn&apos;t match the bill.</span></div>
      </form>
    </div>
  );
}
