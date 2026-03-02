/**
 * One-time backfill: runs Haiku brand mention extraction against all historical
 * comparative tracking runs that have no corresponding response_brand_mentions rows.
 *
 * Usage:
 *   DRY_RUN=true  npx tsx scripts/backfill-comparative-mentions.ts   # verify row count first
 *   DRY_RUN=false npx tsx scripts/backfill-comparative-mentions.ts   # live run
 *
 * Required env (in .env.local or shell):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   ANTHROPIC_API_KEY
 */

// Must be first — loads .env.local before any other code reads process.env
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { callHaiku } from "@/lib/llm/anthropic";
import { normaliseBrandName, BRAND_NORMALISATION_MAP } from "@/lib/brand-normaliser";

// ─── Config ───────────────────────────────────────────────────────────────────

const CLIENT_ID   = "d3114125-7a58-46c9-9af4-4656fe1aba1c";
const DRY_RUN     = process.env.DRY_RUN !== "false"; // default to dry-run for safety
const FIX_EXISTING = process.argv.includes("--fix-existing");

// ─── Supabase (service role — bypasses RLS) ───────────────────────────────────

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ─── Types ────────────────────────────────────────────────────────────────────

interface TrackingRun {
  id: string;
  query_id: string;
  model: string;
  query_intent: string;
  raw_response: string;
  query_text: string; // joined from queries table
}

interface ExtractionBrand {
  brand: string;
  context: string;
  sentiment: string;
}

// ─── Helpers (verbatim copies of the unexported functions in runner.ts) ───────
// buildExtractionPrompt and parseExtractionJson are not exported from runner.ts.
// These are exact copies — do not diverge. If runner.ts changes these, update here too.

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

function parseExtractionJson(raw: string, queryId: string): ExtractionBrand[] | null {
  let cleaned = raw
    .replace(/^```[\w]*$/gm, "")
    .replace(/^```$/gm, "")
    .trim();

  const firstBrace = cleaned.indexOf("{");
  if (firstBrace === -1) {
    console.error(`[backfill] extraction parse: no JSON found query=${queryId} raw=${JSON.stringify(raw.slice(0, 300))}`);
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
      `[backfill] extraction JSON.parse failed query=${queryId} err=${err instanceof Error ? err.message : String(err)} raw=${JSON.stringify(raw.slice(0, 300))}`
    );
    return null;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[backfill] DRY_RUN=${DRY_RUN} FIX_EXISTING=${FIX_EXISTING} client_id=${CLIENT_ID}`);

  // 0. Resolve the actual brand name from the clients table.
  //    The original script hardcoded "beko" which is wrong when tracking a different brand.
  const { data: clientRow, error: clientError } = await supabase
    .from("clients")
    .select("brand_name")
    .eq("id", CLIENT_ID)
    .single();

  if (clientError || !clientRow?.brand_name) {
    console.error("[backfill] Failed to fetch client brand_name:", clientError?.message ?? "no row");
    process.exit(1);
  }
  const brandName = clientRow.brand_name as string;
  console.log(`[backfill] Tracking brand: "${brandName}"`);

  // --fix-existing: repair is_tracked_brand on rows already inserted with the hardcoded "beko" check.
  if (FIX_EXISTING) {
    const lowerBrand = normaliseBrandName(brandName).toLowerCase();
    console.log(`[backfill] --fix-existing: updating is_tracked_brand where normalised brand = "${lowerBrand}" ...`);

    // Set true for rows whose normalised brand_name matches
    const { error: trueErr } = await supabase
      .from("response_brand_mentions")
      .update({ is_tracked_brand: true })
      .eq("client_id", CLIENT_ID)
      .eq("query_intent", "comparative")
      .ilike("brand_name", normaliseBrandName(brandName));

    if (trueErr) { console.error("[backfill] Failed to set is_tracked_brand=true:", trueErr.message); process.exit(1); }

    // Set false for all other comparative rows for this client
    const { error: falseErr } = await supabase
      .from("response_brand_mentions")
      .update({ is_tracked_brand: false })
      .eq("client_id", CLIENT_ID)
      .eq("query_intent", "comparative")
      .not("brand_name", "ilike", normaliseBrandName(brandName));

    if (falseErr) { console.error("[backfill] Failed to set is_tracked_brand=false:", falseErr.message); process.exit(1); }

    console.log("[backfill] --fix-existing complete.");
    return;
  }

  // 1a. Fetch tracking_run_ids that already have response_brand_mentions rows.
  //     PostgREST doesn't support subqueries in .not() — do it in two steps.
  const { data: existingMentions, error: existingError } = await supabase
    .from("response_brand_mentions")
    .select("tracking_run_id")
    .eq("client_id", CLIENT_ID);

  if (existingError) {
    console.error("[backfill] Failed to fetch existing mentions:", existingError.message);
    process.exit(1);
  }

  const alreadyProcessed = new Set((existingMentions ?? []).map((r: { tracking_run_id: string }) => r.tracking_run_id));

  // 1b. Fetch all comparative runs with a raw_response
  const { data: runs, error: fetchError } = await supabase
    .from("tracking_runs")
    .select(`
      id,
      query_id,
      model,
      query_intent,
      raw_response,
      queries!inner(text)
    `)
    .eq("client_id", CLIENT_ID)
    .eq("query_intent", "comparative")
    .not("raw_response", "is", null);

  if (fetchError) {
    console.error("[backfill] Failed to fetch runs:", fetchError.message);
    process.exit(1);
  }

  if (!runs || runs.length === 0) {
    console.log("[backfill] No comparative runs found. Nothing to do.");
    return;
  }

  // Flatten query text from join, then exclude runs already processed
  const enriched: TrackingRun[] = (runs as Record<string, unknown>[])
    .map((r) => ({
      id: r.id as string,
      query_id: r.query_id as string,
      model: r.model as string,
      query_intent: r.query_intent as string,
      raw_response: r.raw_response as string,
      query_text: (r.queries as { text: string }).text,
    }))
    .filter((r) => !alreadyProcessed.has(r.id));

  console.log(`[backfill] Found ${enriched.length} unprocessed comparative runs.`);

  if (DRY_RUN) {
    console.log("[backfill] DRY RUN — no Haiku calls or inserts will be made.");
    for (const run of enriched) {
      console.log(`  run_id=${run.id}  model=${run.model}  query="${run.query_text.slice(0, 60)}..."`);
    }
    console.log(`[backfill] DRY RUN complete. ${enriched.length} runs would be processed.`);
    return;
  }

  // 2. Process sequentially to respect Haiku rate limits
  let inserted = 0;
  let failed   = 0;

  for (let i = 0; i < enriched.length; i++) {
    const run = enriched[i];
    console.log(`[backfill] Processing run ${i + 1} of ${enriched.length} — ${run.id}`);

    try {
      const extractionPrompt = buildExtractionPrompt(run.query_text, run.raw_response);
      const extractionRaw    = await callHaiku(extractionPrompt);
      const brands           = parseExtractionJson(extractionRaw, run.id);

      if (!brands || brands.length === 0) {
        console.log(`  → No brands extracted for run ${run.id}`);
        continue;
      }

      // Same insert shape as runner.ts lines 480–492
      const rows = brands.map((b) => ({
        tracking_run_id:  run.id,
        query_id:         run.query_id,
        client_id:        CLIENT_ID,
        model:            run.model,
        query_intent:     run.query_intent,
        brand_name_raw:   b.brand,
        brand_name:       normaliseBrandName(b.brand),
        is_tracked_brand: normaliseBrandName(b.brand).toLowerCase() === brandName.toLowerCase(),
        mention_context:  b.context,
        mention_sentiment: b.sentiment,
      }));

      const { error: insertError } = await supabase
        .from("response_brand_mentions")
        .insert(rows);

      if (insertError) {
        console.error(`  → Insert failed for run ${run.id}: ${insertError.message}`);
        failed++;
      } else {
        console.log(`  → Inserted ${rows.length} mention row(s)`);
        inserted += rows.length;
      }

      // Log brand names that aren't in the normalisation map
      const unmatched = brands
        .map((b) => b.brand)
        .filter((raw) => !BRAND_NORMALISATION_MAP[raw.toLowerCase().trim()]);
      if (unmatched.length > 0) {
        console.log(`  → Unmatched brand names (consider adding to normaliser):`, unmatched);
      }
    } catch (err) {
      console.error(`  → Failed for run ${run.id}: ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  }

  console.log(`\n[backfill] Done. ${inserted} rows inserted, ${failed} run(s) failed.`);
}

main().catch((err) => {
  console.error("[backfill] Unhandled error:", err);
  process.exit(1);
});
