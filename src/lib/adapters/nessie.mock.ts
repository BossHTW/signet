import { db, schema } from "@/db/client";
import type { BankAdapter } from "./types";
import { nanoid } from "nanoid";

/** Reads the seeded bank feed from SQLite; "transfers" are recorded locally. */
export const nessieMock: BankAdapter = {
  source: "MOCK",
  async listPostings() {
    return db.select().from(schema.bankTransactions).all().map((b) => ({ id: b.id, postedAt: b.postedAt, amountCents: b.amountCents, descriptor: b.descriptor }));
  },
  async transfer({ vendorName, amountCents }) {
    const postedAt = new Date().toISOString().slice(0, 10);
    const id = "mocktx_" + nanoid(8);
    db.insert(schema.bankTransactions).values({ id, accountId: "acct_bcyfs_ops", postedAt, amountCents: -amountCents, descriptor: `SIGNET PAYOUT ${vendorName.toUpperCase().slice(0, 18)}`, counterpartyNormalized: vendorName.toUpperCase(), source: "MOCK" }).run();
    return { txnId: id, postedAt };
  },
};
