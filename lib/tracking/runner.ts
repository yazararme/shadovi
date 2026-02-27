// Service-role client bypasses RLS — required because Inngest runs outside
// the HTTP request context and has no session cookies to authenticate with.
import { createServiceClient } from "@/lib/supabase/server";
import { callClaude } from "@/lib/llm/anthropic";
import { callGPT4o } from "@/lib/llm/openai";
import { callPerplexity, callPerplexityFull } from "@/lib/llm/perplexity";
import { callGemini } from "@/lib/llm/gemini";
import { callDeepSeek } from "@/lib/llm/deepseek";
import { scoreResponse } from "@/lib/tracking/scorer";
import { scoreKnowledge } from "@/lib/tracking/knowledge-scorer";
import { generateRecommendations, type RunSummary } from "@/lib/tracking/recommender";
import type { LLMModel, Competitor, Query, BrandFact } from "@/types";

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
  "gpt-4o": 90_000,
  "claude-sonnet-4-6": 90_000,
  "gemini": 90_000,
  "deepseek": 90_000,
  "perplexity": 150_000,
};

// Hard timeout on any single LLM call. Without this, one hung API connection
// blocks the entire model loop indefinitely — which is what causes 20+ min runs.
// Primary calls: per-model (see PRIMARY_TIMEOUT_MS). Enrichment/scoring: 45s.
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
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

export async function runTrackingForClient(
  clientId: string
): Promise<{ runsCreated: number }> {
  const supabase = createServiceClient();

  // ── 1. Fetch client ────────────────────────────────────────────────────────
  const { data: client } = await supabase
    .from("clients")
    .select("id, status, selected_models, brand_dna")
    .eq("id", clientId)
    .single();

  if (!client || client.status !== "active") {
    throw new Error(`Client ${clientId} not found or not active`);
  }

  const brandName: string = client.brand_dna?.brand_name ?? "Unknown Brand";
  const selectedModels: LLMModel[] = (client.selected_models ?? ["gpt-4o", "perplexity"]) as LLMModel[];

  // ── 2. Fetch active queries (include fact_id, is_bait for scoring logic) ──
  const { data: queries } = await supabase
    .from("queries")
    .select("id, text, intent, fact_id, is_bait")
    .eq("client_id", clientId)
    .eq("status", "active");

  if (!queries || queries.length === 0) {
    throw new Error(`No active queries for client ${clientId}`);
  }

  // ── 3. Fetch competitors + brand facts ────────────────────────────────────
  const [{ data: competitors }, { data: factsData }] = await Promise.all([
    supabase.from("competitors").select("id, name").eq("client_id", clientId),
    supabase.from("brand_facts").select("*").eq("client_id", clientId),
  ]);

  const competitorList = (competitors ?? []) as Pick<Competitor, "name">[];

  // Build id→fact lookup for knowledge scoring
  const factMap = new Map<string, BrandFact>();
  ((factsData ?? []) as BrandFact[]).forEach((f) => factMap.set(f.id, f));

  // ── 4. Run queries × models ────────────────────────────────────────────────
  // Each model is a different API provider with independent rate limits, so we run them
  // in parallel. Within each model, queries stay serial to respect per-provider limits.
  // This cuts wall-clock time from (4 × model_time) to max(model_time) — roughly 4× faster.

  const runSummary: RunSummary = {
    totalQueries: queries.length * selectedModels.length,
    queriesWithMention: 0,
    byModel: {},
    missedQueries: [],
    topCompetitorsMentioned: [],
  };

  type ModelResult = {
    runsCreated: number;
    mentioned: number;
    missedQueryTexts: string[];
    competitorCounts: Record<string, number>;
  };

  const modelResults = await Promise.all(
    selectedModels.map(async (model): Promise<ModelResult> => {
      let modelRunsCreated = 0;
      let modelMentioned = 0;
      const modelMissed: string[] = [];
      const modelCompetitorCounts: Record<string, number> = {};

      for (const query of queries as Pick<Query, "id" | "text" | "intent" | "fact_id" | "is_bait">[]) {
        // Perplexity sonar-pro has a tight rate limit. A brief pause between serial
        // queries prevents the burst from exhausting the limit and dropping queries.
        if (model === "perplexity") {
          await new Promise((r) => setTimeout(r, 1_500));
        }

        let rawResponse = "";
        // Perplexity returns a native citations array in the API response alongside
        // the message content. Capture it here so cited_sources reflects the
        // authoritative list rather than regex extraction from the response text.
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
          continue;
        }

        const scored = scoreResponse(rawResponse, brandName, competitorList);

        // Insert tracking_run row — select() returns the inserted row so we have its id
        // for the knowledge scoring and enrichment steps below.
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
            // Perplexity returns an authoritative citations array in the API response;
            // prefer that over the scorer's regex extraction from response text.
            cited_sources: perplexityCitations.length > 0 ? perplexityCitations : scored.cited_sources,
            share_of_model_score: scored.share_of_model_score,
            // Denormalised fields stamped at insert time to avoid joins in downstream queries
            query_intent: query.intent,
            citation_present: perplexityCitations.length > 0 || (Array.isArray(scored.cited_sources) && scored.cited_sources.length > 0),
          })
          .select()
          .single();

        if (insertError) {
          console.error("[runner] Insert error:", insertError.message);
        } else {
          modelRunsCreated++;

          // For validation queries anchored to a brand fact, run secondary Haiku scoring.
          // Applied forward only — historical runs are not retroactively scored.
          if (query.intent === "validation" && query.fact_id && insertedRun) {
            const fact = factMap.get(query.fact_id);
            if (fact) {
              // ── Knowledge scoring (Haiku) ──────────────────────────────────
              let ks;
              try {
                ks = await withTimeout(
                  scoreKnowledge(query.text, rawResponse, fact),
                  45_000,
                  `haiku-scorer query=${query.id}`
                );

                // bait_triggered: the bait worked — LLM confirmed a false claim.
                // NOTE: in our scorer, accuracy "incorrect" on a bait query means the LLM
                // confirmed the false claim (NOT "correct"). The doc had this inverted.
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
                });
                if (ksInsertError) {
                  console.error(
                    `[runner] brand_knowledge_scores insert failed model=${model} query=${query.id}: ${ksInsertError.message}`
                  );
                }

                // Write brand_positioning back to tracking_run as well so it's available
                // without joining brand_knowledge_scores in Coverage by Category queries.
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

              // ── Source Intelligence enrichment call ────────────────────────
              // ENRICHMENT_ENABLED=true re-activates this block. Currently disabled:
              // source_attribution / content_age_estimate / competitor_mentions_unprompted
              // are not yet surfaced in the dashboard, so running 36+ extra primary-model
              // calls per tracking run is pure cost/time waste at this stage.
              // When the Source Intelligence dashboard panels are built, flip the flag.
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
        }

        if (scored.brand_mentioned && scored.mention_sentiment !== "negative") {
          modelMentioned++;
        } else {
          modelMissed.push(query.text);
        }

        scored.competitors_mentioned.forEach((name) => {
          modelCompetitorCounts[name] = (modelCompetitorCounts[name] ?? 0) + 1;
        });
      }

      return {
        runsCreated: modelRunsCreated,
        mentioned: modelMentioned,
        missedQueryTexts: modelMissed,
        competitorCounts: modelCompetitorCounts,
      };
    })
  );

  // Merge per-model results into the shared summary
  let runsCreated = 0;
  const competitorCounts: Record<string, number> = {};

  for (const [idx, result] of modelResults.entries()) {
    const model = selectedModels[idx];
    runsCreated += result.runsCreated;
    runSummary.queriesWithMention += result.mentioned;
    runSummary.byModel[model] = { total: queries.length, mentioned: result.mentioned };
    // Deduplicate missed queries across models — only record each query text once
    result.missedQueryTexts.forEach((t) => {
      if (!runSummary.missedQueries.includes(t)) runSummary.missedQueries.push(t);
    });
    Object.entries(result.competitorCounts).forEach(([name, count]) => {
      competitorCounts[name] = (competitorCounts[name] ?? 0) + count;
    });
  }

  // Build top competitors list sorted by frequency
  runSummary.topCompetitorsMentioned = Object.entries(competitorCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([name]) => name);

  // ── 5. Generate recommendations ───────────────────────────────────────────
  try {
    await generateRecommendations(clientId, brandName, runSummary);
  } catch (err) {
    // Recommendations are non-critical — log and continue
    console.error("[runner] Recommendation generation failed:", err);
  }

  return { runsCreated };
}
