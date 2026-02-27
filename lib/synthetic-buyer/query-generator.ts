import { z } from "zod";
import { callHaiku } from "@/lib/llm/anthropic";
import type { ClientContext, Query, QueryIntent, FunnelStage, PhrasingStyle, BrandFact, BaitType } from "@/types";

const QuerySchema = z.object({
  text: z.string(),
  intent: z.enum(["problem_aware", "category", "comparative", "validation"]),
  funnel_stage: z.enum(["awareness", "consideration", "decision"]),
  // Haiku occasionally omits phrasing_style — default to conversational rather than
  // failing the whole batch. The critic prompt enforces phrasing calibration anyway.
  phrasing_style: z.enum(["conversational", "formal"]).optional().default("conversational"),
  persona: z.string().optional(),
  rationale: z.string().optional(),
  strategic_goal: z.string().optional(),
  relevance_score: z.number().min(1).max(10).optional(),
  // fact_id is only present in the generator output when brand facts are provided.
  // It links a validation query to the specific fact it's designed to test.
  fact_id: z.string().optional(),
});

const QueryArraySchema = z.array(QuerySchema);

function buildGenerationPrompt(ctx: ClientContext, brandFacts?: BrandFact[]): string {
  const { brandDNA, personas, competitors } = ctx;

  const competitorList = competitors
    .map((c) => {
      const injection = c.context_injection ? ` (${c.context_injection})` : "";
      return `- ${c.name}${injection}`;
    })
    .join("\n");

  const personaSummaries = personas
    .map(
      (p, i) =>
        `Persona ${i + 1}: ${p.name} (${p.role})\nInternal monologue: "${p.internal_monologue}"\nPain points: ${p.pain_points.join(", ")}`
    )
    .join("\n\n");

  // Cap brand facts at 8 so validation never exceeds its intent slot.
  const cappedFacts = brandFacts ? brandFacts.slice(0, 8) : undefined;

  // When brand facts are provided, the validation layer generates one query per fact
  // so scoring can be anchored to a specific known claim rather than guessing the mapping.
  const validationInstruction = cappedFacts && cappedFacts.length > 0
    ? `VALIDATION (${cappedFacts.length} queries — one per brand fact below) — Late funnel. Generate exactly one query per fact that a buyer would realistically ask to evaluate whether the brand has this capability or attribute.
Map to funnel_stage: decision

Brand facts to test (include the fact_id in each validation query's output):
${cappedFacts.map((f) => `- fact_id: "${f.id}" | claim: "${f.claim}" | category: ${f.category}`).join("\n")}

IMPORTANT: For each validation query, include "fact_id": "<the fact_id from above>" in the JSON object.`
    : `VALIDATION (8 queries) — Late funnel. Buyer is evaluating fit.
Criteria-specific: "Is [Brand] good for [specific use case] if we have [constraint]?"
Map to funnel_stage: decision`;

  const totalQueries = cappedFacts && cappedFacts.length > 0 ? 24 + cappedFacts.length : 32;

  return `You are generating a strategic AEO query portfolio for the brand "${brandDNA.brand_name}".

Your goal is to simulate the exact prompts their buyers send to ChatGPT, Claude, Perplexity, and Gemini at each stage of their purchase journey.

Synthetic Buyer profiles:
${personaSummaries}

Brand context:
- Category: ${brandDNA.category_name}
- Product: ${brandDNA.product_description}
- Use cases: ${brandDNA.use_cases.join(", ")}
- Differentiators: ${brandDNA.differentiators.join(", ")}
- Strategic battlegrounds: ${brandDNA.strategic_battlegrounds.join(", ")}

Competitors:
${competitorList || "None specified"}

Generate queries across 4 intent layers:

PROBLEM_AWARE (8 queries) — Early funnel. Buyer has the pain, no brand awareness yet.
Map to funnel_stage: awareness

CATEGORY (8 queries) — Mid funnel. Buyer is exploring solution categories.
Map to funnel_stage: consideration

COMPARATIVE (8 queries) — Mid-to-late funnel. Named brand comparisons.
Format: "[Brand] vs [Competitor] for [use case]" or direct comparisons.
Use context_injection text for unrecognized competitors.
Map to funnel_stage: consideration or decision

${validationInstruction}

PHRASING CALIBRATION — strictly follow these ratios per intent layer:
- problem_aware: 90% conversational (messy, first-person, problem-led; only 1 in 8 may be formal)
- category: 70% conversational (exploratory, solution-seeking)
- comparative: 20% conversational (structured, named brands; 8 of 10 must be formal/evaluative)
- validation: 40% conversational (criteria-driven; mix of "is X good for Y" and formal evaluation)

Conversational means: first-person, incomplete sentences, messy real language as if typing to ChatGPT.
Formal means: structured, third-person, uses brand names and categories explicitly.
DO NOT write all queries in search-keyword style. The problem_aware queries especially must read like a person typing to a chatbot, not a Google search query.

For each query return:
{
  "text": "the exact query string",
  "intent": "problem_aware | category | comparative | validation",
  "funnel_stage": "awareness | consideration | decision",
  "phrasing_style": "conversational | formal",
  "persona": "which persona name would ask this",
  "fact_id": "only for validation queries when brand facts are provided — omit for all other intents"
}

Return ONLY a valid JSON array of all ${totalQueries} queries. No markdown, no explanation.`;
}

function buildCriticPrompt(queries: unknown[]): string {
  return `You are reviewing an AEO query portfolio. Evaluate the following ${queries.length} queries and:

1. Score each query 1-10 for strategic relevance (10 = highly targeted, reveals real signal; 1 = generic, won't yield useful data)
2. Flag queries that are too generic to yield signal (e.g., "what is good SaaS software")
3. Rewrite any query scoring below 5 to be more specific and actionable
4. Ensure phrasing matches the stated phrasing_style (conversational queries must read conversationally)

Return the FULL array of queries with updated relevance_score values and any rewritten text.
Return ONLY a valid JSON array. No markdown, no explanation.

Queries to review:
${JSON.stringify(queries, null, 2)}`;
}

export async function generateQueries(
  ctx: ClientContext,
  brandFacts?: BrandFact[]
): Promise<Omit<Query, "id" | "client_id" | "created_at" | "status">[]> {
  // Build a fact lookup so we can derive is_bait from the source fact at generation time.
  // This is more reliable than asking the LLM to classify bait — the LLM doesn't know
  // which facts are bait, and keyword inference of bait_type is too fragile.
  const factLookup = new Map<string, BrandFact>();
  brandFacts?.forEach((f) => factLookup.set(f.id, f));

  // Step A: Generate queries
  const generationPrompt = buildGenerationPrompt(ctx, brandFacts);
  const rawGeneration = await callHaiku(generationPrompt);
  const cleanedGeneration = rawGeneration
    .replace(/^```(?:json)?\n?/i, "")
    .replace(/\n?```$/i, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleanedGeneration);
  } catch {
    throw new Error(`Failed to parse queries JSON: ${cleanedGeneration.slice(0, 300)}`);
  }

  const genResult = QueryArraySchema.safeParse(parsed);
  if (!genResult.success) {
    throw new Error(`Query validation failed: ${genResult.error.message}`);
  }

  // Step B: Critic pass
  // Strip fact_id before sending to critic — LLMs reliably corrupt UUIDs when
  // rewriting queries (replacing the UUID with nearby claim text). We restore
  // the original fact_ids from the generation pass by index after critique.
  const queriesForCritic = genResult.data.map(({ fact_id: _stripped, ...rest }) => rest);
  const criticPrompt = buildCriticPrompt(queriesForCritic);
  const rawCritic = await callHaiku(criticPrompt);
  const cleanedCritic = rawCritic
    .replace(/^```(?:json)?\n?/i, "")
    .replace(/\n?```$/i, "")
    .trim();

  // Helper: compute is_bait and bait_type from the fact linked to this query.
  // bait_type defaults to 'false_positive' for all bait queries — keyword inference for
  // 'leading_negative' is unreliable and not worth the label-quality risk.
  function resolveBait(factId?: string): { is_bait: boolean; bait_type: BaitType | null } {
    if (!factId) return { is_bait: false, bait_type: null };
    const fact = factLookup.get(factId);
    if (!fact || fact.is_true) return { is_bait: false, bait_type: null };
    return { is_bait: true, bait_type: "false_positive" };
  }

  let criticParsed: unknown;
  try {
    criticParsed = JSON.parse(cleanedCritic);
  } catch {
    // Critic pass failed — return original generation without scores
    return genResult.data.map((q) => {
      // Validate fact_id against the live factLookup — the LLM can corrupt UUIDs
      // (typos, hallucinated IDs) which would fail the queries_fact_id_fkey constraint.
      const validFactId = q.fact_id && factLookup.has(q.fact_id) ? q.fact_id : null;
      if (q.fact_id && !validFactId) {
        console.warn(
          `[query-generator] fact_id "${q.fact_id}" not in factLookup (${factLookup.size} facts) — nulled out`
        );
      }
      const bait = resolveBait(validFactId ?? undefined);
      return {
        text: q.text,
        intent: q.intent as QueryIntent,
        funnel_stage: q.funnel_stage as FunnelStage,
        phrasing_style: q.phrasing_style as PhrasingStyle,
        rationale: null,
        strategic_goal: null,
        persona_id: null,
        relevance_score: null,
        fact_id: validFactId,
        is_bait: bait.is_bait,
        bait_type: bait.bait_type,
      };
    });
  }

  const criticResult = QueryArraySchema.safeParse(criticParsed);
  // Restore fact_ids from generation pass — critic stripped them and must not set them.
  // Index alignment holds because the critic prompt returns the same queries in order.
  const criticBase = criticResult.success ? criticResult.data : genResult.data;
  const finalQueries = criticBase.map((q, i) => ({
    ...q,
    fact_id: genResult.data[i]?.fact_id,
  }));

  // Cap each intent at 8, keeping the highest-scoring queries.
  // This enforces the 32-query hard limit (8 per intent) while preserving quality.
  const byIntent = new Map<string, typeof finalQueries>();
  for (const q of finalQueries) {
    const bucket = byIntent.get(q.intent) ?? [];
    bucket.push(q);
    byIntent.set(q.intent, bucket);
  }
  const trimmed = Array.from(byIntent.values()).flatMap((bucket) =>
    bucket
      .sort((a, b) => (b.relevance_score ?? 5) - (a.relevance_score ?? 5))
      .slice(0, 8)
  );

  return trimmed.map((q) => {
    // Validate fact_id against the live factLookup — the LLM can corrupt UUIDs
    // (typos, hallucinated IDs) which would fail the queries_fact_id_fkey constraint.
    const validFactId = q.fact_id && factLookup.has(q.fact_id) ? q.fact_id : null;
    if (q.fact_id && !validFactId) {
      console.warn(
        `[query-generator] fact_id "${q.fact_id}" not in factLookup (${factLookup.size} facts) — nulled out`
      );
    }
    const bait = resolveBait(validFactId ?? undefined);
    return {
      text: q.text,
      intent: q.intent as QueryIntent,
      funnel_stage: q.funnel_stage as FunnelStage,
      phrasing_style: q.phrasing_style as PhrasingStyle,
      rationale: null,
      strategic_goal: null,
      persona_id: null,
      relevance_score: q.relevance_score ?? null,
      fact_id: validFactId,
      is_bait: bait.is_bait,
      bait_type: bait.bait_type,
    };
  });
}
