import { callHaiku } from "@/lib/llm/anthropic";
import { createServiceClient } from "@/lib/supabase/server";
import type { RecommendationType, MissedQueryDetail } from "@/types";

export interface RunSummary {
  totalQueries: number;
  queriesWithMention: number;
  // Pre-computed 0–100 integer — saves the recommender from recomputing it
  mentionRate: number;
  byModel: Record<string, { total: number; mentioned: number }>;
  // Enriched miss details replace the bare string[] — each entry carries intent,
  // which models missed the query, and which competitors appeared in their place.
  missedQueries: MissedQueryDetail[];
  topCompetitorsMentioned: string[];
  // Count of missed queries per intent layer — surfaces "validation queries are
  // your weakest layer" type insights directly to the Haiku prompt.
  missedByIntent: Record<string, number>;
}

interface RecommendationPayload {
  type: RecommendationType;
  priority: number;
  title: string;
  description: string;
  rationale: string;
  // Haiku returns the exact query text this rec addresses (null for pattern-level recs)
  source_query_text?: string | null;
}

type SupabaseServiceClient = ReturnType<typeof createServiceClient>;

const SYSTEM_PROMPT = `You are an AEO (Answer Engine Optimization) consultant analyzing LLM tracking results for a brand.

Based on tracking data showing where a brand is and isn't appearing in LLM responses, generate 3–5 specific, actionable recommendations.

Return ONLY a JSON array in this exact format:
[
  {
    "type": "content_directive" | "entity_foundation" | "placement_strategy",
    "priority": 1,
    "title": "Short action title",
    "description": "Specific actionable task the team can execute",
    "rationale": "Which gap or pattern this addresses from the tracking data",
    "source_query_text": "The exact missed query text this rec addresses, or null if addressing a cross-query pattern"
  }
]

Types:
- content_directive: Create or update specific content (pages, articles, case studies)
- entity_foundation: Strengthen structured data, entity definitions, citations, backlinks
- placement_strategy: Target specific publications, communities, or platforms for mentions

Be concrete. Name specific topics, pages, or platforms. No generic advice.
Return ONLY valid JSON. No markdown.`;

export async function generateRecommendations(
  clientId: string,
  brandName: string,
  summary: RunSummary,
  versionId: string | null = null
): Promise<void> {
  const supabase = createServiceClient();
  // One UUID groups all recs from this generation call — enables the 3-section
  // roadmap UI to distinguish "current batch" from historical batches.
  const batchId = crypto.randomUUID();
  const generatedAt = new Date().toISOString();

  const modelBreakdown = Object.entries(summary.byModel)
    .map(([model, stats]) =>
      `${model}: ${stats.mentioned}/${stats.total} queries mentioned the brand`
    )
    .join("\n");

  // Format missed queries with enriched context — up to 15 items, most useful first
  const missedLines = summary.missedQueries.slice(0, 15).map((q, i) => {
    const intentLabel = q.intent.replace(/_/g, " ");
    const modelsStr = q.modelsMissed.join(", ");
    const compsStr = q.competitorsPresent.length > 0
      ? ` (competitors present: ${q.competitorsPresent.join(", ")})`
      : "";
    return `${i + 1}. [${intentLabel}] "${q.text}" — missed by: ${modelsStr}${compsStr}`;
  }).join("\n");

  const intentBreakdown = Object.entries(summary.missedByIntent)
    .map(([intent, count]) => `${intent.replace(/_/g, " ")}: ${count} missed`)
    .join(", ");

  const prompt = `Brand: ${brandName}

Tracking run summary:
- Overall mention rate: ${summary.mentionRate}% (${summary.queriesWithMention}/${summary.totalQueries} queries)
- By model:
${modelBreakdown}

Missed by intent layer: ${intentBreakdown || "n/a"}

Top competitors mentioned in responses: ${summary.topCompetitorsMentioned.join(", ") || "none"}

Queries where the brand was NOT mentioned (highest-priority gaps):
${missedLines || "(none — brand appeared in all queries)"}

Generate 3–5 specific recommendations to improve LLM visibility for ${brandName}.`;

  const raw = await callHaiku(prompt, SYSTEM_PROMPT);
  const cleaned = raw.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();

  let recommendations: RecommendationPayload[];
  try {
    recommendations = JSON.parse(cleaned);
    if (!Array.isArray(recommendations)) throw new Error("Not an array");
  } catch {
    // Malformed JSON from Haiku — log and skip; don't fail the whole run
    console.error("[recommender] Failed to parse recommendations JSON:", cleaned.slice(0, 200));
    return;
  }

  // V2: no DELETE — append a fresh batch. Old recs persist as historical record.
  // The roadmap page separates current from previous by batch_id.
  const { data: inserted, error: insertError } = await supabase
    .from("recommendations")
    .insert(
      recommendations.map((r) => ({
        client_id: clientId,
        type: r.type,
        priority: r.priority,
        title: r.title,
        description: r.description,
        rationale: r.rationale,
        status: "open",
        batch_id: batchId,
        source_query_text: r.source_query_text ?? null,
        mention_rate_at_generation: summary.mentionRate,
        version_id: versionId,
        generated_from_run_at: generatedAt,
      }))
    )
    .select();

  if (insertError) {
    console.error("[recommender] Failed to insert recommendations:", insertError.message);
    return;
  }

  if (!inserted || inserted.length === 0) return;

  // Best-effort cluster label backfill: match source_query_text against the most
  // recent gap clusters. Uses whatever clusters already exist — clusters for this
  // run are created in a later Inngest step, so backfill improves from run 2 onward.
  try {
    await backfillClusterLabels(clientId, inserted as { id: string; source_query_text: string | null }[], supabase);
  } catch (err) {
    console.error("[recommender] cluster label backfill failed:", err);
  }
}

async function backfillClusterLabels(
  clientId: string,
  insertedRecs: { id: string; source_query_text: string | null }[],
  supabase: SupabaseServiceClient
): Promise<void> {
  const recsWithText = insertedRecs.filter((r) => r.source_query_text);
  if (recsWithText.length === 0) return;

  // Latest run's clusters only
  const { data: clusters } = await supabase
    .from("gap_clusters")
    .select("id, cluster_name, run_date")
    .eq("client_id", clientId)
    .order("run_date", { ascending: false })
    .limit(50);

  if (!clusters || clusters.length === 0) return;

  const latestDate = (clusters as { run_date: string }[])[0].run_date;
  const latestClusters = (clusters as { id: string; cluster_name: string; run_date: string }[])
    .filter((c) => c.run_date === latestDate);

  const { data: joinRows } = await supabase
    .from("gap_cluster_queries")
    .select("cluster_id, query_id")
    .in("cluster_id", latestClusters.map((c) => c.id));

  if (!joinRows || joinRows.length === 0) return;

  // query_id → cluster_name
  const queryToCluster = new Map<string, string>();
  for (const row of joinRows as { cluster_id: string; query_id: string }[]) {
    const cluster = latestClusters.find((c) => c.id === row.cluster_id);
    if (cluster) queryToCluster.set(row.query_id, cluster.cluster_name);
  }

  // Fetch query texts so we can match by source_query_text
  const { data: queryRows } = await supabase
    .from("queries")
    .select("id, text")
    .in("id", Array.from(queryToCluster.keys()));

  if (!queryRows || queryRows.length === 0) return;

  // text → cluster_name
  const textToCluster = new Map<string, string>();
  for (const q of queryRows as { id: string; text: string }[]) {
    const name = queryToCluster.get(q.id);
    if (name) textToCluster.set(q.text, name);
  }

  // Update each matching rec — individual updates to avoid over-writing unrelated rows
  for (const rec of recsWithText) {
    const clusterName = textToCluster.get(rec.source_query_text!);
    if (clusterName) {
      await supabase
        .from("recommendations")
        .update({ source_cluster_name: clusterName })
        .eq("id", rec.id);
    }
  }
}
