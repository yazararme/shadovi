import { createClient } from "@supabase/supabase-js";
import { callHaiku } from "@/lib/llm/anthropic";

// Service-role client used here because this runs server-side inside an Inngest step,
// not in an authenticated request — RLS would block the insert otherwise.
function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key);
}

// ─── Keyword fallback mapping ──────────────────────────────────────────────────
// Fired when the Haiku call fails. Each entry maps a set of trigger words to a
// cluster definition. Queries that match no keyword land in "Other".
const KEYWORD_CLUSTERS: {
  keywords: string[];
  cluster_name: string;
  persona_label: string;
}[] = [
  {
    keywords: ["landlord", "rental", "buy-to-let", "tenant"],
    cluster_name: "Landlord & Rental",
    persona_label: "Landlord",
  },
  {
    keywords: ["eczema", "sensitive skin", "allergy"],
    cluster_name: "Sensitive Skin",
    persona_label: "Sensitive Skin Buyer",
  },
  {
    keywords: ["noise", "quiet", "neighbours", "flat"],
    cluster_name: "Noise & Flat Living",
    persona_label: "Flat Dweller",
  },
  {
    keywords: ["energy", "electricity", "environment", "eco"],
    cluster_name: "Energy & Environment",
    persona_label: "Eco-Conscious Buyer",
  },
  {
    keywords: ["inverter", "motor", "technology"],
    cluster_name: "Motor Technology",
    persona_label: "Tech-Focused Buyer",
  },
];

interface GapQueryInput {
  id: string; // query_id
  text: string;
  competitors_mentioned: string[]; // union across all models for this query
}

interface HaikuCluster {
  cluster_name: string;
  cluster_type: "displaced" | "open";
  persona_label: string;
  query_ids: string[];
  competitors_present: string[];
}

// ─── Haiku clustering call ─────────────────────────────────────────────────────

async function clusterWithHaiku(
  queries: GapQueryInput[]
): Promise<HaikuCluster[]> {
  const queryList = queries.map((q) => ({
    id: q.id,
    text: q.text,
    competitors_mentioned: q.competitors_mentioned,
  }));

  const prompt = `You are analysing search queries where a brand was absent from LLM responses.
Group these queries by shared buyer context.

For each group return:
- cluster_name: 2-4 words in plain buyer language (e.g. "Landlord & Rental", "Noise & Flat Living", "Energy & Environment"). Use what the buyer is trying to do, not product category language.
- cluster_type: "displaced" if any query in the group has competitor mentions, "open" if none do
- persona_label: the type of buyer this cluster represents in 1-3 words (e.g. "Landlord", "Eco-Conscious Buyer", "Flat Dweller")
- query_ids: array of query IDs belonging to this group
- competitors_present: flat array of all competitor names that appear across queries in the group (deduplicated)

Every query_id in the input must appear in exactly one group. If a query does not clearly fit any group, put it in a group called "Other" with persona_label "Unclassified".

Return JSON only, no markdown:
{ "clusters": [{ "cluster_name": string, "cluster_type": "displaced"|"open", "persona_label": string, "query_ids": string[], "competitors_present": string[] }] }

Queries:
${JSON.stringify(queryList, null, 2)}`;

  const raw = await callHaiku(prompt);

  // Strip any accidental markdown code fences before parsing
  const cleaned = raw.replace(/^```[a-z]*\n?/i, "").replace(/```$/i, "").trim();
  const parsed = JSON.parse(cleaned);

  if (!Array.isArray(parsed.clusters)) {
    throw new Error("Haiku response missing clusters array");
  }

  return parsed.clusters as HaikuCluster[];
}

// ─── Keyword fallback ──────────────────────────────────────────────────────────

function clusterWithKeywords(queries: GapQueryInput[]): HaikuCluster[] {
  console.warn("[gap-clusterer] Falling back to keyword matching — Haiku call failed");

  const assigned = new Set<string>();
  const clusterMap = new Map<string, { queries: GapQueryInput[]; def: (typeof KEYWORD_CLUSTERS)[0] }>();

  for (const query of queries) {
    const lower = query.text.toLowerCase();
    const match = KEYWORD_CLUSTERS.find((kc) =>
      kc.keywords.some((kw) => lower.includes(kw))
    );
    if (match) {
      const key = match.cluster_name;
      if (!clusterMap.has(key)) clusterMap.set(key, { queries: [], def: match });
      clusterMap.get(key)!.queries.push(query);
      assigned.add(query.id);
    }
  }

  const clusters: HaikuCluster[] = [];

  for (const [, { queries: qs, def }] of clusterMap) {
    const allCompetitors = Array.from(
      new Set(qs.flatMap((q) => q.competitors_mentioned))
    );
    clusters.push({
      cluster_name: def.cluster_name,
      cluster_type: allCompetitors.length > 0 ? "displaced" : "open",
      persona_label: def.persona_label,
      query_ids: qs.map((q) => q.id),
      competitors_present: allCompetitors,
    });
  }

  // Unmatched queries → Other
  const unmatched = queries.filter((q) => !assigned.has(q.id));
  if (unmatched.length > 0) {
    const allCompetitors = Array.from(
      new Set(unmatched.flatMap((q) => q.competitors_mentioned))
    );
    clusters.push({
      cluster_name: "Other",
      cluster_type: allCompetitors.length > 0 ? "displaced" : "open",
      persona_label: "Unclassified",
      query_ids: unmatched.map((q) => q.id),
      competitors_present: allCompetitors,
    });
  }

  return clusters;
}

// ─── Main export ───────────────────────────────────────────────────────────────

export async function clusterGapsForClient(clientId: string): Promise<void> {
  const supabase = getServiceClient();
  const runDate = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

  // ── 1. Fetch gap runs for this client (problem_aware + category only) ────────
  const { data: runs, error: runsErr } = await supabase
    .from("tracking_runs")
    .select("query_id, competitors_mentioned, query_intent")
    .eq("client_id", clientId)
    .eq("brand_mentioned", false)
    .in("query_intent", ["problem_aware", "category"]);

  if (runsErr) {
    console.error("[gap-clusterer] Failed to fetch gap runs:", runsErr.message);
    return;
  }

  if (!runs || runs.length === 0) {
    console.log("[gap-clusterer] No gap runs found for client", clientId);
    return;
  }

  // ── 2. Fetch query texts ────────────────────────────────────────────────────
  const queryIds = Array.from(new Set(runs.map((r) => r.query_id)));
  const { data: queries, error: queriesErr } = await supabase
    .from("queries")
    .select("id, text")
    .in("id", queryIds);

  if (queriesErr || !queries) {
    console.error("[gap-clusterer] Failed to fetch query texts:", queriesErr?.message);
    return;
  }

  const queryTextMap = Object.fromEntries(queries.map((q) => [q.id, q.text]));

  // ── 3. Deduplicate across models: one entry per query_id ──────────────────
  // If GPT-4o and Gemini both miss the same query, competitors from both runs
  // are unioned so the cluster card shows all displacement sources.
  const gapMap = new Map<string, GapQueryInput>();
  for (const run of runs) {
    const existing = gapMap.get(run.query_id);
    const incoming = (run.competitors_mentioned ?? []) as string[];
    if (existing) {
      // Union competitors across all model runs for this query
      const merged = Array.from(new Set([...existing.competitors_mentioned, ...incoming]));
      existing.competitors_mentioned = merged;
    } else {
      gapMap.set(run.query_id, {
        id: run.query_id,
        text: queryTextMap[run.query_id] ?? run.query_id,
        competitors_mentioned: incoming,
      });
    }
  }

  const gapQueries = Array.from(gapMap.values());

  // ── 4. Cluster (Haiku first, keyword fallback) ─────────────────────────────
  let clusters: HaikuCluster[];
  try {
    clusters = await clusterWithHaiku(gapQueries);
  } catch (err) {
    console.error("[gap-clusterer] Haiku clustering failed, using keyword fallback:", err);
    clusters = clusterWithKeywords(gapQueries);
  }

  // ── 5. Recompute cluster_type and competitors_present from actual data ───────
  // Haiku only needs to get the groupings right — we never trust its classification
  // of displaced vs open because it may ignore the competitors_mentioned field.
  // This is deterministic: displaced iff any query in the group has competitor mentions.
  const gapQueryMap = new Map(gapQueries.map((q) => [q.id, q]));
  for (const cluster of clusters) {
    const allCompetitors = Array.from(
      new Set(
        cluster.query_ids.flatMap((qid) => gapQueryMap.get(qid)?.competitors_mentioned ?? [])
      )
    );
    cluster.competitors_present = allCompetitors;
    cluster.cluster_type = allCompetitors.length > 0 ? "displaced" : "open";
  }

  // ── 6. Ensure every query_id is assigned; unassigned → Other ──────────────
  const assignedIds = new Set(clusters.flatMap((c) => c.query_ids));
  const unassigned = gapQueries.filter((q) => !assignedIds.has(q.id));
  if (unassigned.length > 0) {
    console.warn(
      `[gap-clusterer] ${unassigned.length} query_ids not assigned by Haiku — adding to Other`
    );
    const otherIdx = clusters.findIndex((c) => c.cluster_name === "Other");
    const unassignedCompetitors = Array.from(
      new Set(unassigned.flatMap((q) => q.competitors_mentioned))
    );
    if (otherIdx >= 0) {
      clusters[otherIdx].query_ids.push(...unassigned.map((q) => q.id));
      clusters[otherIdx].competitors_present = Array.from(
        new Set([...clusters[otherIdx].competitors_present, ...unassignedCompetitors])
      );
    } else {
      clusters.push({
        cluster_name: "Other",
        cluster_type: unassignedCompetitors.length > 0 ? "displaced" : "open",
        persona_label: "Unclassified",
        query_ids: unassigned.map((q) => q.id),
        competitors_present: unassignedCompetitors,
      });
    }
  }

  // ── 7. Warn if Other cluster is bloated (> 40% signals poor clustering) ────
  const otherCluster = clusters.find((c) => c.cluster_name === "Other");
  if (otherCluster) {
    const otherPct = (otherCluster.query_ids.length / gapQueries.length) * 100;
    if (otherPct > 40) {
      console.warn(
        `[gap-clusterer] WARNING: Other cluster contains ${otherPct.toFixed(0)}% of gap queries ` +
          `(${otherCluster.query_ids.length}/${gapQueries.length}) — keyword fallback list may need expanding`
      );
    }
  }

  // ── 8. Idempotent write: delete today's clusters for this client, reinsert ──
  const { data: existingClusters } = await supabase
    .from("gap_clusters")
    .select("id")
    .eq("client_id", clientId)
    .eq("run_date", runDate);

  if (existingClusters && existingClusters.length > 0) {
    const existingIds = existingClusters.map((c) => c.id);
    // Delete join rows first (foreign key constraint)
    await supabase.from("gap_cluster_queries").delete().in("cluster_id", existingIds);
    await supabase.from("gap_clusters").delete().eq("client_id", clientId).eq("run_date", runDate);
  }

  // ── 9. Insert new clusters ─────────────────────────────────────────────────
  for (const cluster of clusters) {
    const { data: inserted, error: insertErr } = await supabase
      .from("gap_clusters")
      .insert({
        client_id: clientId,
        run_date: runDate,
        cluster_name: cluster.cluster_name,
        cluster_type: cluster.cluster_type,
        persona_label: cluster.persona_label,
        query_count: cluster.query_ids.length,
        competitors_present: cluster.competitors_present,
      })
      .select("id")
      .single();

    if (insertErr || !inserted) {
      console.error("[gap-clusterer] Failed to insert cluster:", insertErr?.message);
      continue;
    }

    // Insert the cluster → query join rows
    const joinRows = cluster.query_ids.map((qid) => ({
      cluster_id: inserted.id,
      query_id: qid,
    }));

    const { error: joinErr } = await supabase.from("gap_cluster_queries").insert(joinRows);
    if (joinErr) {
      console.error("[gap-clusterer] Failed to insert cluster_queries:", joinErr.message);
    }
  }

  console.log(
    `[gap-clusterer] Wrote ${clusters.length} clusters for client ${clientId} on ${runDate}`
  );
}
