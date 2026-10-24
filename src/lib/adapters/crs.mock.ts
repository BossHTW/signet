import type { VendorCheckAdapter } from "./types";
import type { CrsStatus } from "@/db/types";

/** Returns the vendor's seeded status; the FLAGGED vendor carries explanatory risk flags. */
export const crsMock: VendorCheckAdapter = {
  source: "MOCK",
  async verifyVendor({ knownStatus }) {
    const status = (knownStatus as CrsStatus) ?? "UNKNOWN";
    return { status, riskFlags: status === "FLAGGED" ? ["entity registered < 90 days", "address mismatch"] : [], source: "MOCK" };
  },
};
