// Sonnet turns a person's written reason into a narrower rule scope. The action stays with proposeRule.
// The model never sees the document or the extracted receipt — only the rationale and the decision's facts.
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { FIELD_PATHS, OPS, type Predicate } from "@/db/types";
import { cachedMessage, SONNET, isUnavailable, type LlmUnavailable } from "./client";

export type DraftRuleInput = {
  rationale: string;
  category: string;
  vendorNameRaw: string;
  requestedCents: number;
  triggers: { code: string; reason: string }[];
};

export type ClaudeRuleDraft = { title: string; predicate: Predicate; model: string };

const predicateSchema: z.ZodType<Predicate> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(predicateSchema).min(1) }),
    z.object({ any: z.array(predicateSchema).min(1) }),
    z.object({ not: predicateSchema }),
    z.object({ field: z.enum(FIELD_PATHS), op: z.enum(OPS), value: z.unknown() }),
  ]),
);

const TOOL: Anthropic.Tool = {
  name: "draft_rule",
  description: "Scope a rule. Do not choose allow, flag, or escalate.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Plain English, 80 characters or fewer." },
      predicate: { type: "object", description: "A predicate using only the given fields and operators." },
    },
    required: ["title", "predicate"],
  },
};

const SYSTEM = `You scope a rule for a county financial-assistance office. You do not choose the action and you do not decide the outcome.
Write a plain-English title of at most 80 characters, and a predicate that narrows when the rule applies (for example request.requestedCents lte 3000).
Use only the fields and operators you are given. The predicate must still be true of the request described. Do not invent facts, and do not refer to document text you were not given.`;

function parseDraft(raw: unknown): { title: string; predicate: Predicate } | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as { title?: unknown; predicate?: unknown };
  const title = typeof o.title === "string" ? o.title.replace(/\s+/g, " ").trim().slice(0, 80) : "";
  const parsed = predicateSchema.safeParse(o.predicate);
  if (!title || !parsed.success) return null;
  return { title, predicate: parsed.data };
}

function fromMessage(res: Anthropic.Message): unknown {
  const tool = res.content.find((b) => b.type === "tool_use");
  if (tool && tool.type === "tool_use") return tool.input;
  const text = res.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") return null;
  const start = text.text.indexOf("{");
  const end = text.text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.text.slice(start, end + 1)); } catch { return null; }
}

/** Null means "use the template". A timeout, a schema miss, or an unavailable model all return null. */
export async function draftRuleWithClaude(input: DraftRuleInput): Promise<ClaudeRuleDraft | null> {
  const pending = cachedMessage({
    model: SONNET,
    max_tokens: 400,
    system: SYSTEM,
    tools: [TOOL],
    tool_choice: { type: "tool", name: "draft_rule" },
    messages: [{ role: "user", content: `The person's reason: ${input.rationale}
Request: ${input.category}, ${input.requestedCents} cents, vendor "${input.vendorNameRaw}".
Triggers:
${input.triggers.map((t) => `${t.code}: ${t.reason}`).join("\n") || "none"}
Fields: ${FIELD_PATHS.join(", ")}
Operators: ${OPS.join(", ")}
Example: {"field":"request.requestedCents","op":"lte","value":3000}` }],
  });
  let res: Anthropic.Message | LlmUnavailable;
  try {
    res = await Promise.race([
      pending,
      new Promise<LlmUnavailable>((resolve) => setTimeout(() => resolve({ unavailable: true, reason: "timeout" }), 10_000)),
    ]);
  } catch {
    return null;
  }
  if (isUnavailable(res)) return null;
  const parsed = parseDraft(fromMessage(res));
  return parsed ? { ...parsed, model: SONNET } : null;
}
