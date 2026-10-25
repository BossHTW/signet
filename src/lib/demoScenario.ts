import fs from "node:fs";

export type Scenario = { act1: string; mint: string[]; reused: string };

export function readScenario(): Scenario | null {
  try {
    const parsed = JSON.parse(fs.readFileSync("data/demo-scenario.json", "utf8")) as Scenario;
    if (!parsed.act1 || parsed.mint?.length !== 5 || !parsed.reused) return null;
    return parsed;
  } catch {
    return null;
  }
}

export const DEMO_PATH = "/where-did-the-50-dollars-go";
