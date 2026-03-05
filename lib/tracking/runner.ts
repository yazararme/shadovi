// Service-role client bypasses RLS — required because Inngest runs outside
// the HTTP request context and has no session cookies to authenticate with.
import { createServiceClient } from "@/lib/supabase/server";
import { callClaude, callHaiku } from "@/lib/llm/anthropic";
import { callGPT4o } from "@/lib/llm/openai";
import { normaliseBrandName, BRAND_NORMALISATION_MAP } from "@/lib/brand-normaliser";
import { callPerplexity, callPerplexityFull } from "@/lib/llm/perplexity";
import { callGemini } from "@/lib/llm/gemini";
import { callDeepSeek } from "@/lib/llm/deepseek";
import { scoreResponse } from "@/lib/tracking/scorer";
import { scoreKnowledge } from "@/lib/tracking/knowledge-scorer";
import { generateRecommendations, type RunSummary } from "@/lib/tracking/recommender";
import type { LLMModel, Competitor, Query, BrandFact, QueryIntent, MissedQueryDetail } from "@/types";

// Dispatch table — maps model ID to the appropriate LLM wrapper
const LLM_CALLERS: Record<LLMModel, (prompt: string) => Promise<string>> = {
  "gpt-4o": (p) => callGPT4o(p),
  "claude-sonnet-4-6": (p) => callClaude(p),
  "perplexity": (p) => callPerplexity(p),
  "gemini": (p) => callGemini(p),
  "deepseek": (p) => callDeepSeek(p),
};

// Per-model primary call timeout. Perplexity's sonar model does live web search
// and is consistently slower than pure-LLM models — 150s vs 90s for others.
// Without a higher ceiling, ~76% of Perplexity queries time out and are silently
// skipped, producing severely underrepresented Perplexity data.
const PRIMARY_TIMEOUT_MS: Record<LLMModel, number> = {
  "gpt-4o": 60_000,//[KK] was 90, dropped as deepseek was taking too much time
  "claude-sonnet-4-6": 60_000, //[KK] was 90, dropped as deepseek was taking too much time
  "gemini": 60_000, //[KK] was 90, dropped as deepseek was taking too much time
  "deepseek": 20_000, //[KK] was 90, dropped as deepseek was taking too much time
  "perplexity": 60_000,
};

// Hard timeout on any single LLM call. Without this, one hung API connection
// blocks the entire model loop indefinitely — which is what causes 20+ min runs.
// Primary calls: per-model (see PRIMARY_TIMEOUT_MS). Enrichment/scoring: 45s.
function withTimeout<T>(promise: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`[timeout] ${label} exceeded ${ms}ms`)), ms)
    ),
  ]);
}

// Enrichment prompt: sent to the SAME model that generated the primary response.
// Must be same-model because source attribution is a self-referential question about
// the model's own knowledge provenance — a different model cannot answer it accurately.
// We include the original query and response as context since LLM calls are stateless.
function buildEnrichmentPrompt(queryText: string, rawResponse: string, brandName: string): string {
  return `You previously answered the following question:

QUESTION: "${queryText}"

YOUR RESPONSE:
${rawResponse.slice(0, 2000)}

Based on your response above, please answer:
1. List only the specific domain names or URLs that informed your answer (e.g. mckinsey.com, reuters.com, beko.co.uk). No company names, no descriptions, no explanations. If you cannot identify a specific domain with confidence, omit it entirely.
2. Roughly what time period or date range does the information you relied on come from? (e.g. "primarily 2022–2023", "recent within the last year", "unclear")
3. Did your response mention any competitor brands to ${brandName}? If so, list each one and briefly describe the context in which you mentioned them.

Return as JSON only:
{
  "sources": ["string"],
  "content_age": "string",
  "competitor_mentions": [{ "competitor": "string", "context": "string" }]
}

No markdown, no explanation, just the JSON.`;
}

interface EnrichmentResult {
  sources: string[];
  content_age: string;
  competitor_mentions: { competitor: string; context: string }[];
}

// Returns null on parse failure so the caller can retry — never silently returns defaults.
// GPT-4o frequently wraps JSON in markdown fences or prepends prose even when the prompt
// says not to. The cleaning below handles: ```json...```, ``` ... ```, preamble text,
// and trailing text after the closing brace.
function parseEnrichmentJson(
  raw: string,
  model: string,
  label: string
): EnrichmentResult | null {
  // Strip all markdown code-fence lines regardless of position in the string
  let cleaned = raw
    .replace(/^```[\w]*$/gm, "")  // opening fence lines: ```json, ```typescript, etc.
    .replace(/^```$/gm, "")        // bare closing fence lines
    .trim();

  // Strip any preamble before the first JSON object
  const firstBrace = cleaned.indexOf("{");
  if (firstBrace === -1) {
    console.error(
      `[runner] enrichment parse: no JSON object found model=${model} label=${label} raw=${JSON.stringify(raw.slice(0, 500))}`
    );
    return null;
  }
  if (firstBrace > 0) cleaned = cleaned.slice(firstBrace);

  // Strip any trailing text after the closing brace of the top-level object
  const lastBrace = cleaned.lastIndexOf("}");
  if (lastBrace !== -1 && lastBrace < cleaned.length - 1) {
    cleaned = cleaned.slice(0, lastBrace + 1);
  }

  try {
    const p = JSON.parse(cleaned) as Record<string, unknown>;

    // Post-process sources: keep only entries that contain a recognisable domain
    // pattern. Discards verbose text strings ("McKinsey research", "product docs")
    // that the LLM returns despite the prompt instruction. Log discards so we can
    // monitor prompt quality over time.
    const rawSources = Array.isArray(p.sources) ? (p.sources as string[]) : [];
    const DOMAIN_RE = /(?:https?:\/\/)?(?:www\.)?([a-z0-9][a-z0-9\-]*(?:\.[a-z0-9][a-z0-9\-]*)*\.[a-z]{2,})/i;
    const sources: string[] = [];
    for (const s of rawSources) {
      const match = typeof s === "string" ? s.match(DOMAIN_RE) : null;
      if (match) {
        // Store the bare domain (strip scheme and www prefix)
        sources.push(match[1].toLowerCase());
      } else {
        console.warn(
          `[runner] enrichment source discarded (no domain found) model=${model} label=${label} raw=${JSON.stringify(s)}`
        );
      }
    }

    return {
      sources,
      content_age: typeof p.content_age === "string" ? p.content_age : "unclear",
      competitor_mentions: Array.isArray(p.competitor_mentions)
        ? (p.competitor_mentions as { competitor: string; context: string }[])
        : [],
    };
  } catch (err) {
    console.error(
      `[runner] enrichment JSON.parse failed model=${model} label=${label} err=${err instanceof Error ? err.message : String(err)} raw=${JSON.stringify(raw.slice(0, 500))}`
    );
    return null;
  }
}

// Brand mention extraction prompt — sent to Haiku after problem_aware/category runs.
// Unlike the BVI enrichment (which is self-referential and must use the same model),
// this is a classification task on text we already have, so Haiku is appropriate.
// The query text is included so the model can apply the "no prompted brand" rule.
function buildExtractionPrompt(queryText: string, rawResponse: string): string {
  return `You are analysing an AI-generated response to identify every brand mentioned.

Original query: "${queryText}"

Response to analyse:
"${rawResponse.slice(0, 3000)}"

Extract every brand, product brand, or company name mentioned anywhere in this response.
For each brand found:
1. The brand name, exactly as written in the response
2. A one-sentence description of the context in which it was mentioned
3. The sentiment of the mention: positive, neutral, negative, or unclear

Rules:
- Include every brand mentioned, even briefly or in passing
- Do not include generic category terms (e.g. "washing machine brand" is not a brand)
- Do not include the brand you were asked about if it was named in the query — only include brands that appeared organically in the response
- If no brands are mentioned, return an empty array

Return JSON only, no explanation, no markdown:
{
  "brands_mentioned": [
    {
      "brand": "string",
      "context": "string",
      "sentiment": "positive" | "neutral" | "negative" | "unclear"
    }
  ]
}`;
}

interface ExtractionBrand {
  brand: string;
  context: string;
  sentiment: string;
}

// Same fence-stripping logic as parseEnrichmentJson — Haiku occasionally wraps output
// in markdown code fences despite the prompt instruction.
function parseExtractionJson(raw: string, queryId: string): ExtractionBrand[] | null {
  let cleaned = raw
    .replace(/^```[\w]*$/gm, "")
    .replace(/^```$/gm, "")
    .trim();

  const firstBrace = cleaned.indexOf("{");
  if (firstBrace === -1) {
    console.error(`[runner] extraction parse: no JSON found query=${queryId} raw=${JSON.stringify(raw.slice(0, 300))}`);
    return null;
  }
  if (firstBrace > 0) cleaned = cleaned.slice(firstBrace);

  const lastBrace = cleaned.lastIndexOf("}");
  if (lastBrace !== -1 && lastBrace < cleaned.length - 1) {
    cleaned = cleaned.slice(0, lastBrace + 1);
  }

  try {
    const p = JSON.parse(cleaned) as Record<string, unknown>;
    return Array.isArray(p.brands_mentioned)
      ? (p.brands_mentioned as ExtractionBrand[])
      : [];
  } catch (err) {
    console.error(
      `[runner] extraction JSON.parse failed query=${queryId} err=${err instanceof Error ? err.message : String(err)} raw=${JSON.stringify(raw.slice(0, 300))}`
    );
    return null;
  }
}

// ── Public types ───────────────────────────────────────────────────────────────

/** Serialisable context fetched once in the setup step and shared across model steps. */
export interface RunContext {
  clientId: string;
  brandName: string;
  selectedModels: LLMModel[];
  queries: Pick<Query, "id" | "text" | "intent" | "fact_id" | "is_bait" | "version_id">[];
  competitorList: Pick<Competitor, "name">[];
  /** Plain array — Maps are not JSON-serialisable across Inngest step boundaries. */
  facts: BrandFact[];
  versionId: string | null;
}

/** Result from processing a single query — returned by each step.run() and aggregated by finaliseRun. */
export interface QueryStepResult {
  model: LLMModel;
  queryId: string;
  queryIntent: QueryIntent;
  runCreated: boolean;
  mentioned: boolean;
  missedQueryText: string | null;
  competitorCounts: Record<string, number>;
}

// Keep ModelBatchResult for backwards compat with runModelBatch / direct testing
export interface ModelBatchResult {
  model: LLMModel;
  runsCreated: number;
  mentioned: number;
  missedQueryTexts: string[];
  competitorCounts: Record<string, number>;
}

// ── Step 1: setup ──────────────────────────────────────────────────────────────

/**
 * Fetch everything the run needs (client, queries, competitors, facts, version)
 * and return a plain JSON-serialisable object for Inngest to checkpoint.
 */
export async function fetchRunContext(clientId: string): Promise<RunContext> {
  const supabase = createServiceClient();
  const DB_TIMEOUT_MS = 10_000;

  console.log(`[fetchRunContext] start clientId=${clientId}`);

  // ── Query 1: clients ──────────────────────────────────────────────────────
  let t = Date.now();
  console.log(`[fetchRunContext] querying clients…`);
  const { data: client } = await withTimeout(
    supabase.from("clients").select("id, status, selected_models, brand_dna").eq("id", clientId).single(),
    DB_TIMEOUT_MS,
    "clients query"
  );
  console.log(`[fetchRunContext] clients done in ${Date.now() - t}ms`);

  if (!client || client.status !== "active") {
    throw new Error(`Client ${clientId} not found or not active`);
  }

  const brandName: string = client.brand_dna?.brand_name ?? "Unknown Brand";

  // Normalise legacy model identifiers stored in the DB before the full model ID
  // was standardised. "claude" was used before "claude-sonnet-4-6" was set as the
  // canonical ID — keep this map updated as model IDs evolve.
  const MODEL_ALIASES: Record<string, LLMModel> = {
    "claude": "claude-sonnet-4-6",
    "claude-3": "claude-sonnet-4-6",
    "claude-3-5": "claude-sonnet-4-6",
  };
  const selectedModels: LLMModel[] = (client.selected_models ?? ["gpt-4o", "perplexity"])
    .map((m: string) => MODEL_ALIASES[m] ?? m) as LLMModel[];

  // ── Query 2: queries ──────────────────────────────────────────────────────
  t = Date.now();
  console.log(`[fetchRunContext] querying queries…`);
  const { data: queries } = await withTimeout(
    supabase.from("queries").select("id, text, intent, fact_id, is_bait, version_id").eq("client_id", clientId).eq("status", "active"),
    DB_TIMEOUT_MS,
    "queries query"
  );
  console.log(`[fetchRunContext] queries done in ${Date.now() - t}ms — count=${queries?.length ?? 0}`);

  if (!queries || queries.length === 0) {
    throw new Error(`No active queries for client ${clientId}`);
  }

  // ── Queries 3–5: competitors, brand_facts, portfolio_versions (parallel) ──
  t = Date.now();
  console.log(`[fetchRunContext] querying competitors, brand_facts, portfolio_versions in parallel…`);
  const [{ data: competitors }, { data: factsData }, { data: activeVersion }] = await Promise.all([
    withTimeout(
      supabase.from("competitors").select("id, name").eq("client_id", clientId),
      DB_TIMEOUT_MS,
      "competitors query"
    ),
    withTimeout(
      supabase.from("brand_facts").select("*").eq("client_id", clientId),
      DB_TIMEOUT_MS,
      "brand_facts query"
    ),
    withTimeout(
      supabase.from("portfolio_versions").select("id").eq("client_id", clientId).eq("is_active", true).limit(1).maybeSingle(),
      DB_TIMEOUT_MS,
      "portfolio_versions query"
    ),
  ]);
  console.log(
    `[fetchRunContext] parallel queries done in ${Date.now() - t}ms — competitors=${competitors?.length ?? 0} facts=${factsData?.length ?? 0} version=${activeVersion?.id ?? "none"}`
  );

  console.log(`[fetchRunContext] complete clientId=${clientId}`);

  return {
    clientId,
    brandName,
    selectedModels,
    queries: queries as RunContext["queries"],
    competitorList: (competitors ?? []) as Pick<Competitor, "name">[],
    facts: (factsData ?? []) as BrandFact[],
    // Using the live is_active flag rather than query.version_id so that a version
    // change between query generation and run time is correctly reflected.
    versionId: activeVersion?.id ?? null,
  };
}

// ── Per-query processing ───────────────────────────────────────────────────────

/**
 * Process a single query against a single model. This is the unit of work for
 * each Inngest step — designed to complete within ~1-2 minutes (well under
 * Vercel's 5-minute timeout).
 *
 * Returns a lightweight result object that gets aggregated in finaliseRun.
 * The function is idempotent: the dedup guard at the top skips queries that
 * already have a tracking_run for today, so retried steps don't create duplicates.
 */
export async function processOneQuery(
  ctx: RunContext,
  model: LLMModel,
  query: RunContext["queries"][number]
): Promise<QueryStepResult> {
  const supabase = createServiceClient();
  const { clientId, brandName, competitorList, facts, versionId } = ctx;

  // Rebuild factMap from the serialised facts array (Maps aren't JSON-serialisable)
  const factMap = new Map<string, BrandFact>();
  facts.forEach((f) => factMap.set(f.id, f));

  const result: QueryStepResult = {
    model,
    queryId: query.id,
    queryIntent: query.intent,
    runCreated: false,
    mentioned: false,
    missedQueryText: null,
    competitorCounts: {},
  };

  // Perplexity sonar-pro has a tight rate limit. A brief pause before the call
  // prevents bursts from exhausting the limit and dropping queries.
  if (model === "perplexity") {
    await new Promise((r) => setTimeout(r, 1_500));
  }

  // Dedup guard: skip if a tracking_run already exists for this query+model today.
  // Inngest retries a step from the top when a transient error; without this check,
  // already-inserted rows get duplicated on every retry.
  const todayUTC = new Date().toISOString().slice(0, 10);
  const tomorrowUTC = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const { count: existingCount } = await supabase
    .from("tracking_runs")
    .select("id", { count: "exact", head: true })
    .eq("query_id", query.id)
    .eq("client_id", clientId)
    .eq("model", model)
    .gte("created_at", `${todayUTC}T00:00:00.000Z`)
    .lt("created_at", `${tomorrowUTC}T00:00:00.000Z`);
  if ((existingCount ?? 0) > 0) {
    console.log(`[runner] dedup skip query=${query.id} model=${model} — row exists for ${todayUTC}`);
    return result;
  }

  // ── Primary LLM call ────────────────────────────────────────────────────
  let rawResponse = "";
  let perplexityCitations: string[] = [];
  try {
    if (model === "perplexity") {
      const { text, citations } = await withTimeout(
        callPerplexityFull(query.text),
        PRIMARY_TIMEOUT_MS[model],
        `${model} primary query=${query.id}`
      );
      rawResponse = text;
      perplexityCitations = citations;
    } else {
      rawResponse = await withTimeout(
        LLM_CALLERS[model](query.text),
        PRIMARY_TIMEOUT_MS[model],
        `${model} primary query=${query.id}`
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[runner] LLM error model=${model} query=${query.id}: ${msg}`);
    result.missedQueryText = query.text;
    return result;
  }

  const scored = scoreResponse(rawResponse, brandName, competitorList);

  // ── Insert tracking_run ─────────────────────────────────────────────────
  const { data: insertedRun, error: insertError } = await supabase
    .from("tracking_runs")
    .insert({
      query_id: query.id,
      client_id: clientId,
      model,
      raw_response: rawResponse,
      brand_mentioned: scored.brand_mentioned,
      mention_position: scored.mention_position,
      mention_sentiment: scored.mention_sentiment,
      competitors_mentioned: scored.competitors_mentioned,
      cited_sources: perplexityCitations.length > 0 ? perplexityCitations : scored.cited_sources,
      share_of_model_score: scored.share_of_model_score,
      query_intent: query.intent,
      citation_present: perplexityCitations.length > 0 || (Array.isArray(scored.cited_sources) && scored.cited_sources.length > 0),
      version_id: versionId,
    })
    .select()
    .single();

  if (insertError) {
    console.error("[runner] Insert error:", insertError.message);
    result.missedQueryText = query.text;
    return result;
  }

  result.runCreated = true;

  // ── Knowledge scoring (Haiku) — validation queries only ─────────────────
  if (query.intent === "validation" && query.fact_id && insertedRun) {
    const fact = factMap.get(query.fact_id);
    if (fact) {
      try {
        const ks = await withTimeout(
          scoreKnowledge(query.text, rawResponse, fact),
          45_000,
          `haiku-scorer query=${query.id}`
        );

        const bait_triggered = (query.is_bait === true) && (ks.accuracy === "incorrect");

        const { error: ksInsertError } = await supabase.from("brand_knowledge_scores").insert({
          tracking_run_id: insertedRun.id,
          fact_id: fact.id,
          client_id: clientId,
          accuracy: ks.accuracy,
          completeness: ks.completeness,
          hallucination: ks.hallucination,
          notes: ks.notes,
          scorer_model: ks.scorer_model,
          bait_triggered,
          brand_positioning: ks.brand_positioning,
          version_id: versionId,
        });
        if (ksInsertError) {
          console.error(
            `[runner] brand_knowledge_scores insert failed model=${model} query=${query.id}: ${ksInsertError.message}`
          );
        }

        const { error: bpUpdateError } = await supabase
          .from("tracking_runs")
          .update({ brand_positioning: ks.brand_positioning })
          .eq("id", insertedRun.id);
        if (bpUpdateError) {
          console.error(
            `[runner] brand_positioning update failed model=${model} query=${query.id}: ${bpUpdateError.message}`
          );
        }
      } catch (err) {
        console.error(
          `[runner] Knowledge scoring failed model=${model} query=${query.id}: ${err instanceof Error ? err.message : String(err)}`
        );
      }

      // ── Source Intelligence enrichment call ──────────────────────────
      if (process.env.ENRICHMENT_ENABLED === "true") {
        try {
          const enrichPrompt = buildEnrichmentPrompt(query.text, rawResponse, brandName);
          const enrichRaw = await withTimeout(
            LLM_CALLERS[model](enrichPrompt),
            45_000,
            `${model} enrichment query=${query.id}`
          );

          let enriched = parseEnrichmentJson(enrichRaw, model, query.id);

          if (!enriched) {
            const retryPrompt =
              enrichPrompt +
              "\n\nReturn raw JSON only. No markdown, no code blocks, no explanation.";
            const retryRaw = await withTimeout(
              LLM_CALLERS[model](retryPrompt),
              45_000,
              `${model} enrichment-retry query=${query.id}`
            );
            enriched = parseEnrichmentJson(retryRaw, model, `${query.id}/retry`);
            if (!enriched) {
              console.error(
                `[runner] enrichment skipped after retry model=${model} query=${query.id}`
              );
            }
          }

          if (enriched) {
            await supabase
              .from("tracking_runs")
              .update({
                source_attribution: enriched.sources,
                content_age_estimate: enriched.content_age,
                competitor_mentions_unprompted: enriched.competitor_mentions,
              })
              .eq("id", insertedRun.id);
          }
        } catch (err) {
          console.error(
            `[runner] Enrichment call failed model=${model} query=${query.id}: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    }
  }

  // ── Competitive mention extraction (Haiku) ────────────────────────────
  if ((query.intent === "problem_aware" || query.intent === "category" || query.intent === "comparative") && insertedRun) {
    try {
      const extractionPrompt = buildExtractionPrompt(query.text, rawResponse);
      const extractionRaw = await withTimeout(
        callHaiku(extractionPrompt),
        10_000,
        `haiku-extraction query=${query.id}`
      );

      const brands = parseExtractionJson(extractionRaw, query.id);
      if (brands && brands.length > 0) {
        const rows = brands.map((b) => ({
          tracking_run_id: insertedRun.id,
          query_id: query.id,
          client_id: clientId,
          model,
          query_intent: query.intent,
          brand_name_raw: b.brand,
          brand_name: normaliseBrandName(b.brand),
          is_tracked_brand:
            normaliseBrandName(b.brand).toLowerCase() === brandName.toLowerCase(),
          mention_context: b.context,
          mention_sentiment: b.sentiment,
          version_id: versionId,
        }));

        const { error: mentionInsertError } = await supabase
          .from("response_brand_mentions")
          .insert(rows);
        if (mentionInsertError) {
          console.error(
            `[runner] response_brand_mentions insert failed model=${model} query=${query.id}: ${mentionInsertError.message}`
          );
        }

        const unmatched = brands
          .map((b) => b.brand)
          .filter((raw) => !BRAND_NORMALISATION_MAP[raw.toLowerCase().trim()]);
        if (unmatched.length > 0) {
          console.log("[brand-normaliser] Unmatched brands (add to map):", unmatched);
        }
      }
    } catch (err) {
      console.error(
        `[runner] Brand extraction failed model=${model} query=${query.id}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // ── Brand mention fallback scan ────────────────────────────────────────
  if (!scored.brand_mentioned && insertedRun) {
    const foundByFallback = rawResponse
      .toLowerCase()
      .includes(brandName.toLowerCase().trim());

    if (foundByFallback) {
      const { error: updateErr } = await supabase
        .from("tracking_runs")
        .update({ brand_mentioned: true })
        .eq("id", insertedRun.id);
      if (updateErr) {
        console.error(
          `[runner] fallback brand_mentioned update failed model=${model} query=${query.id}: ${updateErr.message}`
        );
      } else {
        scored.brand_mentioned = true;

        const { count: existingMentionCount } = await supabase
          .from("response_brand_mentions")
          .select("id", { count: "exact", head: true })
          .eq("tracking_run_id", insertedRun.id)
          .eq("is_tracked_brand", true);

        if ((existingMentionCount ?? 0) === 0) {
          const { error: rbmErr } = await supabase
            .from("response_brand_mentions")
            .insert({
              tracking_run_id: insertedRun.id,
              query_id: query.id,
              client_id: clientId,
              model,
              query_intent: query.intent,
              brand_name_raw: brandName,
              brand_name: normaliseBrandName(brandName),
              is_tracked_brand: true,
              mention_context: "Detected by fallback string scan",
              mention_sentiment: "unclear",
              version_id: versionId,
            });
          if (rbmErr) {
            console.error(
              `[runner] fallback response_brand_mentions insert failed model=${model} query=${query.id}: ${rbmErr.message}`
            );
          }
        }
      }
    }
  }

  // ── Populate result ───────────────────────────────────────────────────
  if (scored.brand_mentioned && scored.mention_sentiment !== "negative") {
    result.mentioned = true;
  } else {
    result.missedQueryText = query.text;
  }

  scored.competitors_mentioned.forEach((name) => {
    result.competitorCounts[name] = (result.competitorCounts[name] ?? 0) + 1;
  });

  return result;
}

// ── Finalise: aggregate per-query results ──────────────────────────────────────

/**
 * Merge per-query step results into a RunSummary and generate AI recommendations.
 * Accepts the flat array of QueryStepResult from all (model, query) steps.
 *
 * versionId: the active portfolio version at run time — stamped on generated recs.
 */
export async function finaliseRun(
  clientId: string,
  brandName: string,
  queryCount: number,
  models: LLMModel[],
  queryResults: QueryStepResult[],
  versionId: string | null = null
): Promise<{ runsCreated: number }> {
  const byModel: Record<string, { mentioned: number }> = {};
  // Keyed by queryId — accumulates per-query miss detail across models
  const missedMap = new Map<string, MissedQueryDetail>();
  const competitorCounts: Record<string, number> = {};
  let runsCreated = 0;

  for (const r of queryResults) {
    if (!byModel[r.model]) byModel[r.model] = { mentioned: 0 };
    if (r.runCreated) runsCreated++;
    if (r.mentioned) byModel[r.model].mentioned++;

    if (r.missedQueryText && r.queryId) {
      // Accumulate: one MissedQueryDetail per unique queryId, listing all models that missed it
      const existing = missedMap.get(r.queryId);
      if (existing) {
        existing.modelsMissed.push(r.model);
        for (const c of Object.keys(r.competitorCounts)) {
          if (!existing.competitorsPresent.includes(c)) existing.competitorsPresent.push(c);
        }
      } else {
        missedMap.set(r.queryId, {
          queryId: r.queryId,
          text: r.missedQueryText,
          intent: r.queryIntent,
          modelsMissed: [r.model],
          competitorsPresent: Object.keys(r.competitorCounts),
        });
      }
    }

    Object.entries(r.competitorCounts).forEach(([name, count]) => {
      competitorCounts[name] = (competitorCounts[name] ?? 0) + count;
    });
  }

  const queriesWithMention = Object.values(byModel).reduce((sum, m) => sum + m.mentioned, 0);
  const totalQueries = queryCount * models.length;
  const mentionRate = totalQueries > 0 ? Math.round((queriesWithMention / totalQueries) * 100) : 0;

  // Count unique missed queries per intent layer for prompt context
  const missedByIntent: Record<string, number> = {};
  for (const detail of missedMap.values()) {
    missedByIntent[detail.intent] = (missedByIntent[detail.intent] ?? 0) + 1;
  }

  const runSummary: RunSummary = {
    totalQueries,
    queriesWithMention,
    mentionRate,
    byModel: Object.fromEntries(
      models.map((m) => [m, { total: queryCount, mentioned: byModel[m]?.mentioned ?? 0 }])
    ),
    missedQueries: Array.from(missedMap.values()),
    topCompetitorsMentioned: Object.entries(competitorCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([name]) => name),
    missedByIntent,
  };

  try {
    await generateRecommendations(clientId, brandName, runSummary, versionId);
  } catch (err) {
    console.error("[runner] Recommendation generation failed:", err);
  }

  return { runsCreated };
}

// ── Legacy: runModelBatch (kept for backwards-compat / direct testing) ─────────

/**
 * Process all queries for a single model in one call. This is the original
 * monolithic approach — kept for direct testing and the thin orchestrator below.
 * The Inngest function no longer calls this; it uses processOneQuery per step.
 */
export async function runModelBatch(ctx: RunContext, model: LLMModel): Promise<ModelBatchResult> {
  let runsCreated = 0;
  let mentioned = 0;
  const missedQueryTexts: string[] = [];
  const competitorCounts: Record<string, number> = {};

  for (const query of ctx.queries) {
    const r = await processOneQuery(ctx, model, query);
    if (r.runCreated) runsCreated++;
    if (r.mentioned) mentioned++;
    if (r.missedQueryText) missedQueryTexts.push(r.missedQueryText);
    Object.entries(r.competitorCounts).forEach(([name, count]) => {
      competitorCounts[name] = (competitorCounts[name] ?? 0) + count;
    });
  }

  return { model, runsCreated, mentioned, missedQueryTexts, competitorCounts };
}

// ── Thin orchestrator (kept for backwards-compat / direct testing) ─────────────

export async function runTrackingForClient(
  clientId: string
): Promise<{ runsCreated: number }> {
  const ctx = await fetchRunContext(clientId);
  const modelResults = await Promise.all(
    ctx.selectedModels.map((model) => runModelBatch(ctx, model))
  );

  // Convert ModelBatchResult[] to QueryStepResult[] for finaliseRun
  const queryResults: QueryStepResult[] = [];
  for (const mr of modelResults) {
    // Approximate: we don't have per-query granularity from the batch, but
    // finaliseRun only needs aggregate counts which we can synthesise
    for (let i = 0; i < mr.runsCreated; i++) {
      queryResults.push({
        model: mr.model,
        queryId: "",            // batch result has no per-query breakdown
        queryIntent: "problem_aware",
        runCreated: true,
        mentioned: i < mr.mentioned,
        missedQueryText: null,
        competitorCounts: i === 0 ? mr.competitorCounts : {},
      });
    }
    for (const text of mr.missedQueryTexts) {
      queryResults.push({
        model: mr.model,
        queryId: "",
        queryIntent: "problem_aware",
        runCreated: false,
        mentioned: false,
        missedQueryText: text,
        competitorCounts: {},
      });
    }
  }

  return finaliseRun(clientId, ctx.brandName, ctx.queries.length, ctx.selectedModels as LLMModel[], queryResults);
}
