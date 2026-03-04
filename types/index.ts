// ─── Brand DNA ───────────────────────────────────────────────────────────────

export interface KeyProduct {
  name: string;
  description: string;
}

export interface BrandDNA {
  brand_name: string;
  category_name: string;
  brand_pov: string;
  product_description: string;
  key_products: KeyProduct[];
  industries_served: string[];
  use_cases: string[];
  likely_competitors: string[];
  differentiators: string[];
  // Anchors query generation — specific competitive contexts the brand should win
  strategic_battlegrounds: string[];
}

// ─── Portfolio Versioning ─────────────────────────────────────────────────────

export type VersionTrigger =
  | 'onboarding_activation'
  | 'manual_regeneration'
  | 'settings_edit'
  | 'calibration_prompt';

export interface PortfolioVersion {
  id: string;
  client_id: string;
  version_number: number;
  created_at: string;
  trigger: VersionTrigger;
  change_summary: {
    queries_added: number;
    queries_removed: number;
    facts_changed: string[];
    competitors_changed: string[];
  } | null;
  query_count: number;
  fact_count: number;
  is_active: boolean;
}

// ─── Database Row Types ───────────────────────────────────────────────────────

export interface Client {
  id: string;
  user_id: string;
  url: string;
  brand_name: string | null;
  brand_dna: BrandDNA | null;
  use_cases: string[] | null;
  industries: string[] | null;
  key_products: KeyProduct[] | null;
  raw_scrape: string | null;
  selected_models: LLMModel[];
  tracking_frequency: "daily" | "weekly" | "monthly";
  status: "onboarding" | "active" | "paused";
  created_at: string;
}

export interface Persona {
  id: string;
  client_id: string;
  name: string;
  role: string;
  pain_points: string[];
  buying_triggers: string[];
  internal_monologue: string;
  skepticisms: string[];
  priority: number;
  created_at: string;
}

export interface Competitor {
  id: string;
  client_id: string;
  name: string;
  url: string | null;
  context_injection: string | null;
  llm_recognized: boolean | null;
  // Recognition per model — gemini and perplexity are checked
  recognition_detail: {
    gemini: boolean;
    perplexity: boolean;
  } | null;
  created_at: string;
}

export type QueryIntent = "problem_aware" | "category" | "comparative" | "validation";
export type QueryStatus = "pending_approval" | "active" | "paused" | "removed" | "inactive";
export type FunnelStage = "awareness" | "consideration" | "decision";
export type PhrasingStyle = "conversational" | "formal";
// false_positive = fabricated claim; leading_negative = sceptical framing on a true feature
export type BaitType = "false_positive" | "leading_negative";
export type BrandPositioning = "budget" | "mid-market" | "premium" | "unclear";

export interface Query {
  id: string;
  client_id: string;
  persona_id: string | null;
  // fact_id links validation intent queries to the specific brand fact they test.
  // null for all other intent types.
  fact_id: string | null;
  // is_bait: true when generated from an is_true=false brand fact (hallucination bait).
  // bait_type distinguishes fabricated claims (false_positive) from sceptical framings (leading_negative).
  is_bait: boolean;
  bait_type: BaitType | null;
  text: string;
  intent: QueryIntent;
  funnel_stage: FunnelStage;
  phrasing_style: PhrasingStyle;
  rationale: string | null;
  strategic_goal: string | null;
  relevance_score: number | null;
  status: QueryStatus;
  // source_persona: name of the persona this query was generated for (denormalised for display).
  source_persona: string | null;
  // manually_added: true when the user added this query by hand rather than via generation.
  manually_added: boolean;
  created_at: string;
  // null for pre-versioning records
  version_id: string | null;
}

// ─── Brand Knowledge ──────────────────────────────────────────────────────────

export type BrandFactCategory = "feature" | "market" | "pricing" | "messaging";

export interface BrandFact {
  id: string;
  client_id: string;
  claim: string;
  category: BrandFactCategory;
  // is_true = false marks hallucination bait: a deliberately false claim used to detect
  // whether LLMs confidently invent things the brand doesn't offer.
  is_true: boolean;
  created_at: string;
  version_id: string | null;
}

export type KnowledgeAccuracy = "correct" | "incorrect" | "uncertain";
export type KnowledgeCompleteness = "full" | "partial" | "vague";

export interface BrandKnowledgeScore {
  id: string;
  tracking_run_id: string;
  fact_id: string | null;
  client_id: string;
  accuracy: KnowledgeAccuracy;
  completeness: KnowledgeCompleteness;
  hallucination: boolean;
  notes: string | null;
  scored_at: string;
  // scorer_model: which Haiku version performed scoring (preserved for historical comparison)
  scorer_model: string | null;
  // bait_triggered: true when a bait query caused the LLM to confirm a false claim (accuracy=incorrect)
  bait_triggered: boolean;
  brand_positioning: BrandPositioning | null;
  version_id: string | null;
}

export type LLMModel = "gpt-4o" | "claude-sonnet-4-6" | "perplexity" | "gemini" | "deepseek";

// Enriched missed-query detail built by finaliseRun and consumed by the recommender.
// Replaces the bare string[] that was in RunSummary — now carries intent, per-model
// coverage gaps, and competitor displacement context for richer prompt generation.
export interface MissedQueryDetail {
  queryId: string;
  text: string;
  intent: QueryIntent;
  modelsMissed: LLMModel[];
  competitorsPresent: string[];
}

export interface CitedSource {
  url: string;
  domain: string;
  snippet: string;
  type: "reddit" | "g2" | "blog" | "news" | "official_docs" | "other";
}

export interface TrackingRun {
  id: string;
  query_id: string;
  client_id: string;
  model: LLMModel;
  ran_at: string;
  raw_response: string | null;
  brand_mentioned: boolean | null;
  mention_position: "first_third" | "middle" | "last_third" | "not_mentioned" | null;
  mention_sentiment: "positive" | "neutral" | "negative" | "not_mentioned" | null;
  competitors_mentioned: string[] | null;
  cited_sources: CitedSource[] | null;
  share_of_model_score: number | null;
  // Denormalised intent: stamped at insert time to avoid joins in downstream aggregations
  query_intent: QueryIntent | null;
  // citation_present: derived at insert time from cited_sources.length > 0
  citation_present: boolean | null;
  // Source Intelligence fields: populated via follow-up enrichment call to same model
  // (validation queries only — self-referential question about knowledge provenance)
  source_attribution: string[] | null;
  content_age_estimate: string | null;
  competitor_mentions_unprompted: { competitor: string; context: string }[] | null;
  // brand_positioning: populated by Haiku scorer for validation queries
  brand_positioning: BrandPositioning | null;
  version_id: string | null;
}

// ─── Gap Clusters ─────────────────────────────────────────────────────────────

export type GapClusterType = "displaced" | "open";

export interface GapCluster {
  id: string;
  client_id: string;
  run_date: string;
  cluster_name: string;
  cluster_type: GapClusterType;
  persona_label: string;
  query_count: number;
  // Array of competitor names that appeared in gap runs for this cluster
  competitors_present: string[];
  created_at: string;
}

export interface GapClusterQuery {
  cluster_id: string;
  query_id: string;
}

export type RecommendationType =
  | "content_directive"
  | "entity_foundation"
  | "placement_strategy";

export interface Recommendation {
  id: string;
  client_id: string;
  query_id: string | null;
  type: RecommendationType;
  priority: number;
  title: string;
  description: string;
  rationale: string;
  status: "open" | "in_progress" | "done" | "dismissed";
  created_at: string;
  // V2 batch fields — null on pre-migration rows
  batch_id: string | null;
  source_query_text: string | null;
  source_cluster_name: string | null;
  mention_rate_at_generation: number | null;
  version_id: string | null;
  generated_from_run_at: string | null;
}

// ─── Aggregated Context (passed to LLM calls) ─────────────────────────────────

export interface ClientContext {
  client: Client;
  personas: Persona[];
  competitors: Competitor[];
  brandDNA: BrandDNA;
}

// ─── API Response Shapes ──────────────────────────────────────────────────────

export interface IngestResponse {
  clientId: string;
  brandDNA: BrandDNA;
}

export interface RefineResponse {
  reply: string;
  updatedField: keyof BrandDNA | "personas" | null;
  updatedValue: unknown;
}

// Recognition badge logic: Green = both, Yellow = one, Red = neither
export type RecognitionStatus = "green" | "yellow" | "red";
export function getRecognitionStatus(detail: Competitor["recognition_detail"]): RecognitionStatus {
  if (!detail) return "red";
  const count = [detail.gemini, detail.perplexity].filter(Boolean).length;
  if (count === 2) return "green";
  if (count === 1) return "yellow";
  return "red";
}
