import { callHaiku } from "@/lib/llm/anthropic";
import { createServiceClient } from "@/lib/supabase/server";
import type { RecommendationType } from "@/types";

export interface RunSummary {
  totalQueries: number;
  queriesWithMention: number;
  byModel: Record<string, { total: number; mentioned: number }>;
  missedQueries: string[]; // query texts where brand was NOT mentioned
  topCompetitorsMentioned: string[];
}

interface RecommendationPayload {
  type: RecommendationType;
  priority: number;
  title: string;
  description: string;
  rationale: string;
}

const SYSTEM_PROMPT = `You are an AEO (Answer Engine Optimization) consultant analyzing LLM tracking results for a brand.

Based on tracking data showing where a brand is and isn't appearing in LLM responses, generate 3–5 specific, actionable recommendations.

Return ONLY a JSON array in this exact format:
[
  {
    "type": "content_directive" | "entity_foundation" | "placement_strategy",
    "priority": 1,
    "title": "Short action title",
    "description": "Specific actionable task the team can execute",
    "rationale": "Which gap or pattern this addresses from the tracking data"
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
  summary: RunSummary
): Promise<void> {
  const supabase = createServiceClient();

  const mentionRate = summary.totalQueries > 0
    ? Math.round((summary.queriesWithMention / summary.totalQueries) * 100)
    : 0;

  const modelBreakdown = Object.entries(summary.byModel)
    .map(([model, stats]) =>
      `${model}: ${stats.mentioned}/${stats.total} queries mentioned the brand`
    )
    .join("\n");

  const prompt = `Brand: ${brandName}

Tracking run summary:
- Overall mention rate: ${mentionRate}% (${summary.queriesWithMention}/${summary.totalQueries} queries)
- By model:
${modelBreakdown}

Top competitors mentioned in responses: ${summary.topCompetitorsMentioned.join(", ") || "none"}

Queries where the brand was NOT mentioned (highest-priority gaps):
${summary.missedQueries.slice(0, 10).map((q, i) => `${i + 1}. "${q}"`).join("\n")}

Generate 3–5 specific recommendations to improve LLM visibility for ${brandName}.`;

  const raw = await callHaiku(prompt, SYSTEM_PROMPT);
  const cleaned = raw.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();

  let recommendations: RecommendationPayload[];
  try {
    recommendations = JSON.parse(cleaned);
    if (!Array.isArray(recommendations)) throw new Error("Not an array");
  } catch {
    // If Claude returns malformed JSON, log and skip — don't fail the whole run
    console.error("[recommender] Failed to parse recommendations JSON:", cleaned.slice(0, 200));
    return;
  }

  // Replace open recommendations with this fresh batch
  await supabase
    .from("recommendations")
    .delete()
    .eq("client_id", clientId)
    .eq("status", "open");

  if (recommendations.length > 0) {
    await supabase.from("recommendations").insert(
      recommendations.map((r) => ({
        client_id: clientId,
        type: r.type,
        priority: r.priority,
        title: r.title,
        description: r.description,
        rationale: r.rationale,
        status: "open",
      }))
    );
  }
}
