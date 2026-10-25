// The only place the Anthropic SDK is touched. Spend guard + cache + mode awareness.
import Anthropic from "@anthropic-ai/sdk";
import { cacheGet, cacheKey, cacheSet, llmStats } from "./cache";
import { currentMode } from "@/lib/adapters/types";
import { chargeDemoLive, DEMO_BUSY } from "@/lib/demoLimit";

export const HAIKU = process.env.CLAUDE_HAIKU_MODEL ?? "claude-haiku-4-5";
// Summaries/defenses default to Haiku too: one model that must exist. Set CLAUDE_SONNET_MODEL to upgrade (run `npm run models` to see IDs).
export const SONNET = process.env.CLAUDE_SONNET_MODEL ?? HAIKU;
const MAX_SPEND = Number(process.env.MAX_SPEND_USD ?? 40);
// rough list prices per 1M tokens, for the local spend estimate only
const PRICE: Record<string, { in: number; out: number }> = { [HAIKU]: { in: 1, out: 5 }, [SONNET]: { in: 3, out: 15 } };

let client: Anthropic | null = null;
function sdk() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY missing");
  return (client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }));
}

export type LlmUnavailable = { unavailable: true; reason: string };

/**
 * Runs a Messages API call through the cache. In OFFLINE mode, or past the spend cap, or without a key,
 * returns {unavailable} instead of throwing so the pipeline can degrade (EXTRACT-LOW) rather than crash.
 */
export async function cachedMessage(args: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message | LlmUnavailable> {
  const key = cacheKey(["msg", args.model, args.system, args.messages, args.tools, args.tool_choice]);
  const hit = cacheGet<Anthropic.Message>(key);
  if (hit) { llmStats.hits++; return hit; }
  if (currentMode() === "OFFLINE") return { unavailable: true, reason: "OFFLINE mode and no cached response" };
  if (!process.env.ANTHROPIC_API_KEY) return { unavailable: true, reason: "no API key" };
  if (llmStats.spendUsd >= MAX_SPEND) return { unavailable: true, reason: `spend cap $${MAX_SPEND} reached` };

  let res: Anthropic.Message;
  try {
    await chargeDemoLive();
    res = await sdk().messages.create(args);
  } catch (e) {
    if ((e as Error).message === DEMO_BUSY) throw e;
    // Never crash the pipeline on a model error: degrade (EXTRACT-LOW / fallback summary) and record why.
    const msg = (e as { message?: string }).message ?? String(e);
    console.warn(`[llm] ${args.model} unavailable: ${msg.slice(0, 160)}`);
    return { unavailable: true, reason: `model error: ${msg.slice(0, 120)}` };
  }
  llmStats.calls++;
  const p = PRICE[args.model] ?? PRICE[HAIKU];
  llmStats.inputTokens += res.usage.input_tokens;
  llmStats.outputTokens += res.usage.output_tokens;
  llmStats.spendUsd += (res.usage.input_tokens * p.in + res.usage.output_tokens * p.out) / 1_000_000;
  cacheSet(key, res);
  return res;
}

export function isUnavailable(x: unknown): x is LlmUnavailable {
  return typeof x === "object" && x !== null && (x as LlmUnavailable).unavailable === true;
}
