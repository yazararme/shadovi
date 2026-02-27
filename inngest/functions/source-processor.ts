/**
 * Source Intelligence processor.
 *
 * Triggered by the "source/process.requested" event after a tracking run.
 * For each validation/bait run: resolves source_attribution strings to
 * canonical_domains entries, writes run_sources, then calls the
 * recalc_domain_run_stats Postgres RPC to refresh aggregates.
 *
 * REGISTRATION: add `sourceProcessorFunction` to the functions array in
 * app/api/inngest/route.ts, then add an inngest.send() call at the end of
 * the "cluster-gaps" step in inngest/functions/trackingRun.ts when you're
 * ready to go live.
 *
 * DRY RUN: set DRY_RUN=true in .env.local to log all resolutions without
 * committing writes. Run this first against the 768 existing validation runs:
 *   await inngest.send({ name: "source/process.requested",
 *                        data: { clientId: BEKO_CLIENT_ID } });
 */

import { inngest } from "@/inngest/client";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

// ── Config ────────────────────────────────────────────────────────────────────

// When true: log all resolutions to console, skip all DB writes.
const DRY_RUN = process.env.DRY_RUN === "true";

// Query intents this processor cares about. Validation and bait runs are the
// only ones that include source_attribution data from the enrichment call.
const TARGET_INTENTS = ["validation", "bait"] as const;

// ── Supabase service client ───────────────────────────────────────────────────
// Service role bypasses RLS — this function only runs server-side via Inngest.

function getServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("[source-processor] Missing SUPABASE_URL or SERVICE_ROLE_KEY");
  }
  return createClient(url, key);
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface TrackingRunRow {
  id: string;
  client_id: string;
  model: string;
  ran_at: string;
  query_intent: string | null;
  source_attribution: string[] | null;
  // String[] for new Perplexity runs (native citations); object[] for scorer-extracted sources
  cited_sources: Array<string | { url?: string; domain?: string; snippet?: string }> | null;
  content_age_estimate: string | null;
}

type ResolutionAction =
  | "found_existing"   // domain already in canonical_domains
  | "resolved_url"     // URL extracted from string, found in canonical_domains
  | "resolved_alias"   // matched via domain_aliases exact lookup
  | "created_new";     // new canonical_domains row created (needs manual review)

interface Resolution {
  canonicalId: string;
  domain: string;
  action: ResolutionAction;
}

// ── Domain utilities ──────────────────────────────────────────────────────────

/**
 * Extract a normalised domain from a raw string.
 * Handles: "https://currys.co.uk/path", "www.beko.com", bare "currys.co.uk".
 * Returns null if no domain-like pattern is found.
 */
function extractDomain(raw: string): string | null {
  // Full URL with scheme — stop at the first /, ?, #, or whitespace so the
  // path is never included in the capture (e.g. beko.co.uk/support → beko.co.uk)
  const urlMatch = raw.match(/https?:\/\/([^/?#\s]+)/i);
  if (urlMatch) return normalizeDomain(urlMatch[1]);

  // Bare domain: "currys.co.uk" or "www.beko.com"
  // Require at least one dot and a known-length TLD to avoid false positives on
  // short abbreviations. Also handles two-part TLDs like .co.uk via {2,3} groups.
  const domainMatch = raw.match(
    /\b([a-z0-9][a-z0-9\-]*(?:\.[a-z0-9][a-z0-9\-]*)+\.[a-z]{2,})\b/i
  );
  if (domainMatch) return normalizeDomain(domainMatch[1]);

  return null;
}

function normalizeDomain(d: string): string {
  return d.toLowerCase().replace(/^www\./, "");
}

// ── Core resolution logic ─────────────────────────────────────────────────────

/**
 * Resolve a single source string to a canonical_domains row.
 *
 * Order of operations:
 *  1. Try URL/domain extraction → look up canonical_domains.domain
 *  2. Exact case-insensitive alias match in domain_aliases
 *  3. No match → create a new canonical_domains entry (source_type = 'reference')
 *     so it surfaces for manual classification. Conservative: never merge on
 *     fuzzy guesses to avoid poisoning the graph.
 *
 * Returns null on DRY_RUN (writes skipped) or unrecoverable DB error.
 */
async function resolveSourceString(
  supabase: SupabaseClient,
  raw: string
): Promise<Resolution | null> {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const domain = extractDomain(trimmed);

  if (domain) {
    // ── Path A: domain found in the string ──────────────────────────────────

    const { data: existing } = await supabase
      .from("canonical_domains")
      .select("id, domain")
      .eq("domain", domain)
      .maybeSingle();

    if (existing) {
      return {
        canonicalId: existing.id,
        domain: existing.domain,
        action: "found_existing",
      };
    }

    // Domain not yet known — create it
    if (DRY_RUN) {
      console.log(
        `[DRY_RUN] CREATE canonical_domains: domain="${domain}" (from source: "${trimmed}")`
      );
      return null;
    }

    const { data: created, error } = await supabase
      .from("canonical_domains")
      .insert({ domain, normalized_name: domain, source_type: "reference" })
      .select("id")
      .maybeSingle();

    if (error?.code === "23505") {
      // Race: another processor already inserted this domain concurrently
      const { data: racedExisting } = await supabase
        .from("canonical_domains")
        .select("id, domain")
        .eq("domain", domain)
        .maybeSingle();
      if (racedExisting) {
        return { canonicalId: racedExisting.id, domain, action: "found_existing" };
      }
    }

    if (error || !created) {
      console.error(
        `[source-processor] canonical_domains insert failed domain="${domain}":`,
        error?.message
      );
      return null;
    }

    console.warn(
      `[source-processor] New domain created (needs classification): "${domain}"`
    );
    return { canonicalId: created.id, domain, action: "created_new" };
  }

  // ── Path B: no URL/domain — check domain_aliases (exact, case-insensitive) ─
  // Intentionally conservative: no fuzzy matching to avoid wrong merges.

  const { data: alias } = await supabase
    .from("domain_aliases")
    .select("canonical_domain_id")
    .ilike("alias", trimmed)
    .limit(1)
    .maybeSingle();

  if (alias) {
    const { data: canonical } = await supabase
      .from("canonical_domains")
      .select("id, domain")
      .eq("id", alias.canonical_domain_id)
      .maybeSingle();

    if (canonical) {
      return {
        canonicalId: canonical.id,
        domain: canonical.domain,
        action: "resolved_alias",
      };
    }
  }

  // ── Path C: completely unresolved — create a new canonical entry ────────────
  // Use a slug of the raw string as the domain key so it's human-readable in
  // the DB and surfaced for manual review. source_type = 'reference' marks it
  // as unclassified. The normalized_name stores the original string verbatim.

  const slugDomain = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9\-\.]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);

  if (DRY_RUN) {
    console.log(
      `[DRY_RUN] CREATE unresolved canonical: domain="${slugDomain}" normalized_name="${trimmed}" → needs manual review`
    );
    return null;
  }

  // Check if this slug already exists (handles repeated identical strings)
  const { data: slugExisting } = await supabase
    .from("canonical_domains")
    .select("id, domain")
    .eq("domain", slugDomain)
    .maybeSingle();

  if (slugExisting) {
    return { canonicalId: slugExisting.id, domain: slugDomain, action: "found_existing" };
  }

  const { data: createdSlug, error: slugError } = await supabase
    .from("canonical_domains")
    .insert({
      domain: slugDomain,
      normalized_name: trimmed.slice(0, 255),
      source_type: "reference",
    })
    .select("id")
    .maybeSingle();

  if (slugError?.code === "23505") {
    // Concurrent insert race
    const { data: racedSlug } = await supabase
      .from("canonical_domains")
      .select("id, domain")
      .eq("domain", slugDomain)
      .maybeSingle();
    if (racedSlug) {
      return { canonicalId: racedSlug.id, domain: slugDomain, action: "found_existing" };
    }
  }

  if (slugError || !createdSlug) {
    console.error(
      `[source-processor] Unresolved canonical insert failed for "${trimmed}":`,
      slugError?.message
    );
    return null;
  }

  console.warn(
    `[source-processor] Unresolved source created for manual review: "${trimmed}" → "${slugDomain}"`
  );
  return { canonicalId: createdSlug.id, domain: slugDomain, action: "created_new" };
}

// ── Per-run processor ─────────────────────────────────────────────────────────

async function processRun(
  supabase: SupabaseClient,
  run: TrackingRunRow
): Promise<{ processed: number; skipped: number; created: number }> {
  const sources: string[] = Array.isArray(run.source_attribution)
    ? run.source_attribution
    : [];
  const cited = Array.isArray(run.cited_sources) ? run.cited_sources : [];

  // Skip only if both are empty — don't skip runs that have cited_sources but
  // no source_attribution (e.g. Perplexity runs when enrichment is disabled).
  if (sources.length === 0 && cited.length === 0) {
    return { processed: 0, skipped: 0, created: 0 };
  }

  // Build a set of cited domains for fast cross-reference.
  // cited_sources can be string[] (new Perplexity native citations) or
  // Array<{url?, domain?, snippet?}> (scorer-extracted, legacy format).
  const citedDomains = new Set<string>();
  for (const c of cited) {
    if (typeof c === "string") {
      const d = extractDomain(c);
      if (d) citedDomains.add(d);
    } else {
      if (c.domain) citedDomains.add(normalizeDomain(c.domain));
      if (c.url) {
        const d = extractDomain(c.url);
        if (d) citedDomains.add(d);
      }
    }
  }

  let processed = 0;
  let skipped = 0;
  let created = 0;

  // Track canonical IDs written in the attribution pass so the cited pass
  // never overwrites is_attributed=true with false for the same domain.
  const writtenCanonicalIds = new Set<string>();

  // ── Pass 1: source_attribution ─────────────────────────────────────────────
  for (const rawSource of sources) {
    try {
      const resolution = await resolveSourceString(supabase, rawSource);

      if (DRY_RUN) {
        // Resolution is null in dry-run; logging already happened inside resolveSourceString
        console.log(
          `[DRY_RUN] run=${run.id} model=${run.model} source="${rawSource}" → ${resolution ? `${resolution.action}: ${resolution.domain}` : "logged above"}`
        );
        skipped++;
        continue;
      }

      if (!resolution) {
        skipped++;
        continue;
      }

      if (resolution.action === "created_new") created++;

      const isCited = citedDomains.has(resolution.domain);

      // Upsert run_sources — idempotent via UNIQUE(run_id, canonical_domain_id)
      const { error: rsError } = await supabase.from("run_sources").upsert(
        {
          run_id: run.id,
          canonical_domain_id: resolution.canonicalId,
          is_attributed: true,
          is_cited: isCited,
        },
        { onConflict: "run_id,canonical_domain_id" }
      );

      if (rsError) {
        console.error(
          `[source-processor] run_sources upsert failed run=${run.id} domain=${resolution.domain}:`,
          rsError.message
        );
        skipped++;
        continue;
      }

      writtenCanonicalIds.add(resolution.canonicalId);
      processed++;
    } catch (err) {
      // Non-critical: log and continue to the next source string
      console.error(
        `[source-processor] Error processing source "${rawSource}" for run ${run.id}:`,
        err instanceof Error ? err.message : String(err)
      );
      skipped++;
    }
  }

  // ── Pass 2: cited_sources ──────────────────────────────────────────────────
  // Inserts rows for domains that appear in cited_sources but NOT in
  // source_attribution. Domains present in both were already handled above
  // (is_cited was set via the citedDomains cross-reference in Pass 1).
  for (const c of cited) {
    const rawUrl = typeof c === "string" ? c : (c.url ?? c.domain ?? "");
    if (!rawUrl) continue;

    try {
      const resolution = await resolveSourceString(supabase, rawUrl);

      if (DRY_RUN) {
        console.log(
          `[DRY_RUN] run=${run.id} model=${run.model} cited="${rawUrl}" → ${resolution ? `${resolution.action}: ${resolution.domain}` : "logged above"}`
        );
        continue;
      }

      if (!resolution) continue;

      // Domain was already written with correct flags in Pass 1 — skip.
      if (writtenCanonicalIds.has(resolution.canonicalId)) continue;

      if (resolution.action === "created_new") created++;

      const { error: rsError } = await supabase.from("run_sources").upsert(
        {
          run_id: run.id,
          canonical_domain_id: resolution.canonicalId,
          is_attributed: false,
          is_cited: true,
        },
        { onConflict: "run_id,canonical_domain_id" }
      );

      if (rsError) {
        console.error(
          `[source-processor] run_sources upsert (cited) failed run=${run.id} domain=${resolution.domain}:`,
          rsError.message
        );
        skipped++;
        continue;
      }

      writtenCanonicalIds.add(resolution.canonicalId);
      processed++;
    } catch (err) {
      console.error(
        `[source-processor] Error processing cited "${rawUrl}" for run ${run.id}:`,
        err instanceof Error ? err.message : String(err)
      );
      skipped++;
    }
  }

  return { processed, skipped, created };
}

// ── Inngest function ──────────────────────────────────────────────────────────

/**
 * Event payload:
 *   { clientId: string, runIds?: string[] }
 *
 * If runIds is provided, process only those runs.
 * If only clientId, process all validation/bait runs for the client that have
 * source_attribution data but no entry in run_sources yet (i.e. unprocessed).
 *
 * Backfill example (dry run first):
 *   DRY_RUN=true → inngest.send({
 *     name: "source/process.requested",
 *     data: { clientId: process.env.BEKO_CLIENT_ID }
 *   })
 */
export const sourceProcessorFunction = inngest.createFunction(
  {
    id: "source-processor",
    // Non-critical enrichment — allow multiple instances but cap total concurrency
    concurrency: [
      { limit: 1, key: "event.data.clientId" }, // one per client at a time
      { limit: 3 },                              // global cap
    ],
    // Retry twice on unexpected failure; third failure is logged but not fatal
    retries: 2,
  },
  { event: "source/process.requested" },
  async ({ event, step }) => {
    const { clientId, runIds } = event.data as {
      clientId: string;
      runIds?: string[];
    };

    // ── Step 1: fetch runs to process ────────────────────────────────────────
    const runs = await step.run("fetch-runs", async () => {
      const supabase = getServiceClient();

      let query = supabase
        .from("tracking_runs")
        .select(
          "id, client_id, model, ran_at, query_intent, source_attribution, cited_sources, content_age_estimate"
        )
        .eq("client_id", clientId)
        .in("query_intent", TARGET_INTENTS as unknown as string[])
        // Fetch runs with either enrichment data (source_attribution) or native
        // Perplexity citations (cited_sources). Runs with both empty are skipped
        // cheaply inside processRun.
        .or("source_attribution.not.is.null,cited_sources.not.is.null");

      if (runIds && runIds.length > 0) {
        query = query.in("id", runIds);
      } else {
        // Skip runs already represented in run_sources (idempotent backfill)
        // We do this by selecting runs whose IDs are NOT in run_sources.
        // For large backfills, this avoids reprocessing 768 runs on retry.
        const { data: alreadyProcessed } = await supabase
          .from("run_sources")
          .select("run_id")
          .eq("run_id", clientId); // placeholder; replaced below

        // Supabase JS doesn't support NOT IN via a subquery directly.
        // Pull processed run IDs first, then exclude them.
        const { data: processedRunIds } = await supabase
          .from("run_sources")
          .select("run_id")
          // Get all run_ids for this client by joining through tracking_runs
          .in(
            "run_id",
            (
              await supabase
                .from("tracking_runs")
                .select("id")
                .eq("client_id", clientId)
            ).data?.map((r) => r.id) ?? []
          );

        const excludeIds = [
          ...new Set(processedRunIds?.map((r) => r.run_id) ?? []),
        ];

        if (excludeIds.length > 0) {
          query = query.not("id", "in", `(${excludeIds.join(",")})`);
        }

        void alreadyProcessed; // suppress unused variable warning
      }

      const { data, error } = await query.order("ran_at", { ascending: true });

      if (error) {
        throw new Error(`[source-processor] fetch-runs failed: ${error.message}`);
      }

      console.log(
        `[source-processor] clientId=${clientId} fetched ${data?.length ?? 0} runs to process` +
          (DRY_RUN ? " [DRY RUN — no writes]" : "")
      );

      return (data ?? []) as TrackingRunRow[];
    });

    if (runs.length === 0) {
      return { clientId, processed: 0, message: "No eligible runs found" };
    }

    // ── Step 2: process each run (batched into chunks to avoid step timeout) ──
    const CHUNK_SIZE = 50;
    let totalProcessed = 0;
    let totalSkipped = 0;
    let totalCreated = 0;

    for (let i = 0; i < runs.length; i += CHUNK_SIZE) {
      const chunk = runs.slice(i, i + CHUNK_SIZE);
      const chunkIndex = Math.floor(i / CHUNK_SIZE);

      const chunkResult = await step.run(`process-chunk-${chunkIndex}`, async () => {
        const supabase = getServiceClient();
        let chunkProcessed = 0;
        let chunkSkipped = 0;
        let chunkCreated = 0;

        for (const run of chunk) {
          try {
            const result = await processRun(supabase, run);
            chunkProcessed += result.processed;
            chunkSkipped += result.skipped;
            chunkCreated += result.created;
          } catch (err) {
            // Per-run failure is non-critical: log with run_id and raw context
            console.error(
              `[source-processor] Run failed run_id=${run.id} client=${clientId}:`,
              err instanceof Error ? err.message : String(err)
            );
          }
        }

        return { chunkProcessed, chunkSkipped, chunkCreated };
      });

      totalProcessed += chunkResult.chunkProcessed;
      totalSkipped += chunkResult.chunkSkipped;
      totalCreated += chunkResult.chunkCreated;
    }

    // ── Step 3: recalculate aggregates ───────────────────────────────────────
    // Calls the Postgres RPC which re-derives all domain_run_stats counts,
    // model_weight, and age percentiles from run_sources in a single pass.
    if (!DRY_RUN) {
      await step.run("recalc-stats", async () => {
        const supabase = getServiceClient();
        const { error } = await supabase.rpc("recalc_domain_run_stats", {
          p_client_id: clientId,
        });
        if (error) {
          // Non-critical: stats will be stale but run_sources data is intact.
          // A subsequent run will recalculate correctly.
          console.error(
            `[source-processor] recalc_domain_run_stats failed client=${clientId}:`,
            error.message
          );
        } else {
          console.log(
            `[source-processor] domain_run_stats recalculated for client=${clientId}`
          );
        }
      });
    } else {
      console.log(
        `[DRY_RUN] Would call recalc_domain_run_stats for client=${clientId}`
      );
    }

    const summary = {
      clientId,
      runsProcessed: runs.length,
      sourcesResolved: totalProcessed,
      sourcesSkipped: totalSkipped,
      newCanonicalDomainsCreated: totalCreated,
      dryRun: DRY_RUN,
    };

    console.log("[source-processor] Completed:", summary);
    return summary;
  }
);
