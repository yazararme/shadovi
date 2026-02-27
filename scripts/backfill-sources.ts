/**
 * One-time backfill: resolves source_attribution strings from existing
 * validation runs into canonical_domains → run_sources → domain_run_stats.
 *
 * Usage:
 *   npx tsx scripts/backfill-sources.ts              # dry run (DRY_RUN=true)
 *   npx tsx scripts/backfill-sources.ts              # live    (DRY_RUN=false or unset)
 *   npx tsx scripts/backfill-sources.ts --force      # reprocess runs already in run_sources
 *
 * Required env (in .env.local or shell):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   BEKO_CLIENT_ID
 *   APPCUES_CLIENT_ID        ← must be set; script refuses to run otherwise
 *
 * DRY_RUN=true logs all resolutions and prints a top-10 domain report without
 * writing anything. Run this first and confirm the top domains are real domain
 * names (e.g. "currys.co.uk"), not generic strings like "manufacturer website".
 * If generic strings appear, normalization has failed — do not run live.
 */

// Must be first — loads .env.local before any other code reads process.env
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ─── Config & guards ──────────────────────────────────────────────────────────

const BEKO_CLIENT_ID    = process.env.BEKO_CLIENT_ID ?? "2f6ab5b8-50d2-4fff-b638-3ab5c6b3eb87";
const APPCUES_CLIENT_ID = process.env.APPCUES_CLIENT_ID ?? "";

// Guard — prevents accidental runs with an unset or placeholder client ID.
// The Appcues ID is intentionally not hardcoded so this script can't silently
// operate on the wrong client if the env is misconfigured.
if (!APPCUES_CLIENT_ID || APPCUES_CLIENT_ID === "[insert Appcues client_id here]") {
  throw new Error("APPCUES_CLIENT_ID not set — script will not run");
}

const CLIENT_IDS = [BEKO_CLIENT_ID, APPCUES_CLIENT_ID];
const DRY_RUN    = process.env.DRY_RUN === "true";
const FORCE      = process.argv.includes("--force");
const LOG_EVERY  = 50;

const SOURCE_TYPE_LABELS: Record<string, string> = {
  official:    "Official",
  competitor:  "Competitor",
  ugc:         "UGC",
  editorial:   "Editorial",
  marketplace: "Marketplace",
  reference:   "Reference",
};

// ─── Supabase ─────────────────────────────────────────────────────────────────

function getServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("[backfill] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key);
}

// ─── Domain normalisation (mirrors source-processor.ts) ───────────────────────

function normalizeDomain(d: string): string {
  return d.toLowerCase().replace(/^www\./, "");
}

function extractDomain(raw: string): string | null {
  // Full URL with scheme — stop at the first /, ?, #, or whitespace so the
  // path is never included in the capture (e.g. beko.co.uk/support → beko.co.uk)
  const urlMatch = raw.match(/https?:\/\/([^/?#\s]+)/i);
  if (urlMatch) return normalizeDomain(urlMatch[1]);
  const domainMatch = raw.match(
    /\b([a-z0-9][a-z0-9\-]*(?:\.[a-z0-9][a-z0-9\-]*)*\.[a-z]{2,})\b/i
  );
  if (domainMatch) return normalizeDomain(domainMatch[1]);
  return null;
}

type ResolutionAction = "found_existing" | "resolved_alias" | "created_new";

interface Resolution {
  canonicalId: string;
  domain: string;
  action: ResolutionAction;
}

/**
 * Resolve a raw source string to a canonical_domains row.
 *
 * In DRY_RUN mode:
 *   - Existing domains (found_existing / resolved_alias): still returned.
 *   - New domains that would be created: logs the intent, returns null.
 * This means dry-run stats only cover already-known domains, which is enough
 * to validate normalisation quality for the top influencers.
 */
async function resolveSourceString(
  supabase: SupabaseClient,
  raw: string
): Promise<Resolution | null> {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const domain = extractDomain(trimmed);

  if (domain) {
    const { data: existing } = await supabase
      .from("canonical_domains")
      .select("id, domain")
      .eq("domain", domain)
      .maybeSingle();

    if (existing) {
      return { canonicalId: existing.id, domain: existing.domain, action: "found_existing" };
    }

    if (DRY_RUN) {
      console.log(
        `[DRY_RUN] Would CREATE canonical_domains: domain="${domain}" (from source: "${trimmed}")`
      );
      return null;
    }

    const { data: created, error } = await supabase
      .from("canonical_domains")
      .insert({ domain, normalized_name: domain, source_type: "reference" })
      .select("id")
      .maybeSingle();

    if (error?.code === "23505") {
      const { data: raced } = await supabase
        .from("canonical_domains")
        .select("id, domain")
        .eq("domain", domain)
        .maybeSingle();
      if (raced) return { canonicalId: raced.id, domain, action: "found_existing" };
    }
    if (error || !created) {
      console.error(`[backfill] canonical_domains insert failed domain="${domain}":`, error?.message);
      return null;
    }
    console.warn(`[backfill] New domain created (needs classification): "${domain}"`);
    return { canonicalId: created.id, domain, action: "created_new" };
  }

  // No URL/domain pattern — try exact case-insensitive alias match.
  // Conservative: no fuzzy matching to avoid wrong merges.
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
      return { canonicalId: canonical.id, domain: canonical.domain, action: "resolved_alias" };
    }
  }

  // Completely unresolved — create a new entry with a slug domain for manual review.
  const slugDomain = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9\-\.]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);

  if (DRY_RUN) {
    console.log(
      `[DRY_RUN] Would CREATE unresolved canonical: domain="${slugDomain}" (from: "${trimmed}") → needs manual review`
    );
    return null;
  }

  const { data: slugExisting } = await supabase
    .from("canonical_domains")
    .select("id, domain")
    .eq("domain", slugDomain)
    .maybeSingle();
  if (slugExisting) {
    return { canonicalId: slugExisting.id, domain: slugDomain, action: "found_existing" };
  }

  const { data: created, error } = await supabase
    .from("canonical_domains")
    .insert({ domain: slugDomain, normalized_name: trimmed.slice(0, 255), source_type: "reference" })
    .select("id")
    .maybeSingle();

  if (error?.code === "23505") {
    const { data: raced } = await supabase
      .from("canonical_domains")
      .select("id, domain")
      .eq("domain", slugDomain)
      .maybeSingle();
    if (raced) return { canonicalId: raced.id, domain: slugDomain, action: "found_existing" };
  }
  if (error || !created) {
    console.error(`[backfill] Unresolved canonical insert failed for "${trimmed}":`, error?.message);
    return null;
  }
  console.warn(`[backfill] Unresolved source created for review: "${trimmed}" → "${slugDomain}"`);
  return { canonicalId: created.id, domain: slugDomain, action: "created_new" };
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface RunRow {
  id: string;
  client_id: string;
  model: string;
  ran_at: string;
  source_attribution: string[] | null;
  // String[] for new Perplexity runs (native citations); object[] for scorer-extracted
  cited_sources: Array<string | { url?: string; domain?: string; snippet?: string }> | null;
}

// Accumulates domain-level counts during DRY_RUN for the top-10 report
interface DryRunStat {
  canonicalId: string;
  domain: string;
  attributed: number; // times in source_attribution
  cited: number;      // of those, times also in cited_sources
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const supabase = getServiceClient();

  console.log("\n=== Source Intelligence Backfill ===");
  console.log(`Mode   : ${DRY_RUN ? "DRY RUN — no writes" : "LIVE"}`);
  console.log(`Force  : ${FORCE ? "YES — reprocessing already-processed runs" : "NO — skipping runs already in run_sources"}`);
  console.log(`Clients: ${CLIENT_IDS.join(", ")}\n`);

  // ── Step 1: Fetch eligible runs ──────────────────────────────────────────
  console.log("[backfill] Fetching validation runs with source_attribution...");

  const { data: runsData, error: runsError } = await supabase
    .from("tracking_runs")
    .select("id, client_id, model, ran_at, source_attribution, cited_sources")
    .in("client_id", CLIENT_IDS)
    .eq("query_intent", "validation")
    // Include runs with either enrichment data or native Perplexity citations
    .or("source_attribution.not.is.null,cited_sources.not.is.null")
    .order("ran_at", { ascending: true });

  if (runsError) {
    throw new Error(`[backfill] Failed to fetch runs: ${runsError.message}`);
  }

  const allRuns = (runsData ?? []) as RunRow[];
  console.log(`[backfill] Found ${allRuns.length} eligible runs across ${CLIENT_IDS.length} clients.`);

  if (allRuns.length === 0) {
    console.log("[backfill] Nothing to process. Exiting.");
    return;
  }

  // ── Step 2: Idempotency — find already-processed runs ────────────────────
  let runsToProcess = allRuns;

  if (!FORCE) {
    // Pull all run_ids that already have entries in run_sources for these clients
    const allRunIds = allRuns.map((r) => r.id);
    const { data: existing } = await supabase
      .from("run_sources")
      .select("run_id")
      .in("run_id", allRunIds);

    const processedSet = new Set((existing ?? []).map((r: { run_id: string }) => r.run_id));
    runsToProcess = allRuns.filter((r) => !processedSet.has(r.id));

    console.log(
      `[backfill] Skipping ${allRuns.length - runsToProcess.length} already-processed run(s). ` +
        `Processing ${runsToProcess.length} run(s). Use --force to reprocess all.`
    );
  }

  if (runsToProcess.length === 0) {
    console.log("[backfill] All runs already processed. Exiting.");
    return;
  }

  // ── Step 3: Process runs ─────────────────────────────────────────────────
  let processed = 0;
  let skipped   = 0;
  let failed    = 0;
  const total   = runsToProcess.length;

  // Dry-run accumulator — keyed by canonicalId
  const dryRunMap = new Map<string, DryRunStat>();
  let dryRunUnresolved = 0;
  const totalEligibleRuns = runsToProcess.length; // denominator for "% attributed"

  for (let i = 0; i < runsToProcess.length; i++) {
    const run = runsToProcess[i];

    // Progress log every LOG_EVERY runs
    if (i > 0 && i % LOG_EVERY === 0) {
      console.log(
        `[progress] ${i}/${total} | processed: ${processed} | skipped: ${skipped} | failed: ${failed}`
      );
    }

    const sources: string[] = Array.isArray(run.source_attribution) ? run.source_attribution : [];
    const cited = Array.isArray(run.cited_sources) ? run.cited_sources : [];

    // Skip only if both are empty — don't skip runs that have cited_sources
    // but no source_attribution (e.g. Perplexity when enrichment is off).
    if (sources.length === 0 && cited.length === 0) {
      skipped++;
      continue;
    }

    // Build cited-domain set for this run.
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

    let runHadAnySource = false;

    // Track canonical IDs written in the attribution pass so the cited pass
    // never overwrites is_attributed=true with false for the same domain.
    const writtenCanonicalIds = new Set<string>();

    // ── Pass 1: source_attribution ──────────────────────────────────────────
    for (const rawSource of sources) {
      try {
        const resolution = await resolveSourceString(supabase, rawSource);

        if (!resolution) {
          if (!DRY_RUN) skipped++;
          else dryRunUnresolved++;
          continue;
        }

        const isCited = citedDomains.has(resolution.domain);

        if (DRY_RUN) {
          // Accumulate for top-10 report
          const ex = dryRunMap.get(resolution.canonicalId) ?? {
            canonicalId: resolution.canonicalId,
            domain:      resolution.domain,
            attributed:  0,
            cited:       0,
          };
          ex.attributed++;
          if (isCited) ex.cited++;
          dryRunMap.set(resolution.canonicalId, ex);
          runHadAnySource = true;
          continue;
        }

        const { error } = await supabase.from("run_sources").upsert(
          {
            run_id:               run.id,
            canonical_domain_id:  resolution.canonicalId,
            is_attributed:        true,
            is_cited:             isCited,
            is_backfilled:        true,
          },
          { onConflict: "run_id,canonical_domain_id" }
        );

        if (error) {
          console.error(
            `[backfill] run_sources upsert failed run=${run.id} domain=${resolution.domain}:`,
            error.message
          );
          failed++;
        } else {
          processed++;
          runHadAnySource = true;
          writtenCanonicalIds.add(resolution.canonicalId);
        }
      } catch (err) {
        console.error(
          `[backfill] Error on source "${rawSource}" run_id=${run.id}:`,
          err instanceof Error ? err.message : String(err)
        );
        failed++;
      }
    }

    // ── Pass 2: cited_sources ────────────────────────────────────────────────
    // Inserts rows for domains that appear in cited_sources but NOT in
    // source_attribution. Domains in both were already handled above
    // (is_cited set via the citedDomains cross-reference in Pass 1).
    for (const c of cited) {
      const rawUrl = typeof c === "string" ? c : (c.url ?? c.domain ?? "");
      if (!rawUrl) continue;

      try {
        const resolution = await resolveSourceString(supabase, rawUrl);

        if (!resolution) {
          if (!DRY_RUN) skipped++;
          else dryRunUnresolved++;
          continue;
        }

        if (DRY_RUN) {
          // Don't count cited-only rows in the attributed top-10 report
          runHadAnySource = true;
          continue;
        }

        // Domain already written with correct flags in Pass 1 — skip.
        if (writtenCanonicalIds.has(resolution.canonicalId)) continue;

        const { error } = await supabase.from("run_sources").upsert(
          {
            run_id:               run.id,
            canonical_domain_id:  resolution.canonicalId,
            is_attributed:        false,
            is_cited:             true,
            is_backfilled:        true,
          },
          { onConflict: "run_id,canonical_domain_id" }
        );

        if (error) {
          console.error(
            `[backfill] run_sources upsert (cited) failed run=${run.id} domain=${resolution.domain}:`,
            error.message
          );
          failed++;
        } else {
          processed++;
          runHadAnySource = true;
          writtenCanonicalIds.add(resolution.canonicalId);
        }
      } catch (err) {
        console.error(
          `[backfill] Error on cited "${rawUrl}" run_id=${run.id}:`,
          err instanceof Error ? err.message : String(err)
        );
        failed++;
      }
    }

    if (!runHadAnySource) skipped++;
  }

  // ── Final progress line ──────────────────────────────────────────────────
  console.log(
    `\n[progress] ${total}/${total} | processed: ${processed} | skipped: ${skipped} | failed: ${failed}`
  );

  // ── DRY_RUN: top-10 report ───────────────────────────────────────────────
  if (DRY_RUN) {
    console.log(`\n[DRY_RUN] Unresolved source strings (no domain found): ${dryRunUnresolved}`);
    console.log(
      `[DRY_RUN] Resolved ${dryRunMap.size} distinct canonical domains across ${totalEligibleRuns} runs.\n`
    );

    if (dryRunMap.size === 0) {
      console.log("[DRY_RUN] No resolvable domains found — check that enrichment has been run.");
      return;
    }

    // Sort by attributed count descending, take top 10
    const top10 = [...dryRunMap.values()]
      .sort((a, b) => b.attributed - a.attributed)
      .slice(0, 10);

    // Batch-fetch source_type and normalized_name for the top canonical IDs
    const { data: canonicalRows } = await supabase
      .from("canonical_domains")
      .select("id, source_type, normalized_name")
      .in("id", top10.map((s) => s.canonicalId));

    const canonicalMeta = new Map(
      (canonicalRows ?? []).map((c: { id: string; source_type: string; normalized_name: string }) => [c.id, c])
    );

    console.log("Top 10 canonical domains (dry run):");
    top10.forEach((stat, idx) => {
      const meta         = canonicalMeta.get(stat.canonicalId);
      const sourceType   = meta ? (SOURCE_TYPE_LABELS[meta.source_type] ?? meta.source_type) : "Unknown";
      // % of the time this domain appeared in source_attribution (of all eligible runs)
      const attributedPct = totalEligibleRuns > 0
        ? Math.round((stat.attributed / totalEligibleRuns) * 100)
        : 0;
      // % of its attributed appearances that were also in cited_sources
      const citedPct = stat.attributed > 0
        ? Math.round((stat.cited / stat.attributed) * 100)
        : 0;
      console.log(
        `  ${idx + 1}. ${stat.domain} (${sourceType}) - ${stat.attributed} appearances` +
          ` [${citedPct}% cited, ${attributedPct}% attributed]`
      );
    });

    console.log(
      "\n[DRY_RUN] If top domains show real domain names (e.g. currys.co.uk, beko.com)," +
        " normalisation is working. Run live without DRY_RUN=true to commit."
    );
    console.log(
      "[DRY_RUN] If you see generic strings like 'manufacturer-website' or 'official-website'," +
        " normalisation has failed — do NOT run live until fixed.\n"
    );
    return;
  }

  // ── Step 4: Recalc domain_run_stats once per client ──────────────────────
  // Called after all run_sources writes are complete — not inside the run loop.
  for (const clientId of CLIENT_IDS) {
    console.log(`\n[backfill] Recalculating domain_run_stats for client ${clientId}...`);
    const { error } = await supabase.rpc("recalc_domain_run_stats", {
      p_client_id: clientId,
    });
    if (error) {
      console.error(`[backfill] recalc_domain_run_stats failed client=${clientId}:`, error.message);
    } else {
      console.log(`[backfill] ✓ domain_run_stats updated for ${clientId}`);
    }
  }

  // ── Done ─────────────────────────────────────────────────────────────────
  console.log("\n=== Backfill complete ===");
  console.log("\nRun this verification query in the Supabase SQL editor:\n");
  console.log(
    `SELECT
  tr.client_id,
  COUNT(DISTINCT rs.canonical_domain_id) AS unique_domains,
  COUNT(*) AS total_source_mentions,
  COUNT(*) FILTER (WHERE rs.is_backfilled = true) AS backfilled_rows
FROM run_sources rs
JOIN tracking_runs tr ON rs.run_id = tr.id
WHERE tr.client_id IN ('${BEKO_CLIENT_ID}', '${APPCUES_CLIENT_ID}')
GROUP BY tr.client_id;`
  );
  console.log(
    "\nExpected: ~50–100 unique domains and 500–1000 total mentions per client."
  );
}

main().catch((err) => {
  console.error("\n[backfill] Fatal error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
