// ── Competitive Mention Rate API ───────────────────────────────────────────────
// NOT YET IMPLEMENTED — stub reserved for when the Competitive Gaps page is updated.
//
// When building the UI, use the query pattern below against response_brand_mentions.
// Data is populated by the Haiku extraction call in lib/tracking/runner.ts for
// problem_aware and category runs only.
//
// ── Mention rate query pattern ─────────────────────────────────────────────────
//
// "Of all problem_aware/category queries run for this client on this model,
//  what percentage had at least one mention of each brand?"
//
// Mention rate counts a brand once per run even if it appears multiple times in
// the same response — measures reach (share of conversations), not raw frequency.
//
// WITH total_runs AS (
//   SELECT COUNT(DISTINCT tracking_run_id) AS total
//   FROM response_brand_mentions rbm
//   JOIN tracking_runs tr ON tr.id = rbm.tracking_run_id
//   WHERE rbm.client_id  = :client_id
//     AND rbm.model       = :model
//     AND rbm.query_intent IN ('problem_aware', 'category')
//     AND tr.ran_at       >= :date_from
// ),
// brand_run_counts AS (
//   SELECT
//     brand_name,
//     is_tracked_brand,
//     COUNT(DISTINCT tracking_run_id) AS runs_with_mention
//   FROM response_brand_mentions
//   WHERE client_id    = :client_id
//     AND model        = :model
//     AND query_intent IN ('problem_aware', 'category')
//   GROUP BY brand_name, is_tracked_brand
// )
// SELECT
//   brand_name,
//   is_tracked_brand,
//   runs_with_mention,
//   total,
//   ROUND(runs_with_mention * 100.0 / NULLIF(total, 0), 1) AS mention_rate_pct
// FROM brand_run_counts
// CROSS JOIN total_runs
// ORDER BY mention_rate_pct DESC;
//
// ── Flags to resolve before implementing ──────────────────────────────────────
// - Decide whether to expose per-model rates or aggregate across models
// - Decide date range: rolling 30d, last N runs, or all-time
// - Sentiment breakdown (positive/neutral/negative) per brand is available in
//   response_brand_mentions.mention_sentiment — surface if useful to the UI

export async function GET() {
  return new Response(
    JSON.stringify({ error: "Not yet implemented" }),
    { status: 501, headers: { "Content-Type": "application/json" } }
  );
}
