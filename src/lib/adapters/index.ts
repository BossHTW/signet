import { currentMode } from "./types";
import { nessieLive } from "./nessie";
import { nessieMock } from "./nessie.mock";
import { crsLive } from "./crs";
import { crsMock } from "./crs.mock";

export function adapters() {
  const mode = currentMode();
  return mode === "LIVE" ? { mode, bank: nessieLive, vendorCheck: crsLive } : { mode, bank: nessieMock, vendorCheck: crsMock };
}
export { currentMode };
