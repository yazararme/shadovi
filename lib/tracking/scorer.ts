import type { CitedSource } from "@/types";

export interface ScoredResult {
  brand_mentioned: boolean;
  mention_position: "first_third" | "middle" | "last_third" | "not_mentioned";
  // KNOWN LIMITATION: sentiment is derived from simple keyword heuristics.
  // Negation ("wouldn't recommend") and comparative framing ("Competitor X is better")
  // will produce incorrect results. Upgrade to a per-response Claude sentiment pass
  // in Phase 5 once tracking volume is established.
  mention_sentiment: "positive" | "neutral" | "negative" | "not_mentioned";
  competitors_mentioned: string[];
  cited_sources: CitedSource[];
  share_of_model_score: number; // 0.0–1.0
}

const POSITIVE_SIGNALS = [
  "recommend", "best", "top", "excellent", "great", "leading",
  "trusted", "preferred", "popular", "strong", "ideal",
];

const NEGATIVE_SIGNALS = [
  "avoid", "not recommend", "poor", "issue", "problem",
  "weakness", "downside", "limitation", "struggle", "complaint",
];

const URL_REGEX = /https?:\/\/[^\s)<>"]+/g;

export function scoreResponse(
  text: string,
  brandName: string,
  competitors: { name: string }[]
): ScoredResult {
  const lower = text.toLowerCase();
  const lowerBrand = brandName.toLowerCase();

  // ── Brand mention ──────────────────────────────────────────────────────────
  const brand_mentioned = lower.includes(lowerBrand);

  // ── Mention position ───────────────────────────────────────────────────────
  let mention_position: ScoredResult["mention_position"] = "not_mentioned";
  if (brand_mentioned) {
    const pos = lower.indexOf(lowerBrand) / lower.length;
    if (pos < 0.33) mention_position = "first_third";
    else if (pos < 0.67) mention_position = "middle";
    else mention_position = "last_third";
  }

  // ── Sentiment (heuristic — see KNOWN LIMITATION above) ────────────────────
  let mention_sentiment: ScoredResult["mention_sentiment"] = "not_mentioned";
  if (brand_mentioned) {
    // Search within a 200-char window around the brand mention for context
    const idx = lower.indexOf(lowerBrand);
    const window = lower.slice(Math.max(0, idx - 100), idx + lowerBrand.length + 100);

    const hasPositive = POSITIVE_SIGNALS.some((s) => window.includes(s));
    const hasNegative = NEGATIVE_SIGNALS.some((s) => window.includes(s));

    if (hasPositive && !hasNegative) mention_sentiment = "positive";
    else if (hasNegative) mention_sentiment = "negative";
    else mention_sentiment = "neutral";
  }

  // ── Competitors mentioned ──────────────────────────────────────────────────
  const competitors_mentioned = competitors
    .filter((c) => lower.includes(c.name.toLowerCase()))
    .map((c) => c.name);

  // ── Cited sources (URL extraction) ────────────────────────────────────────
  const rawUrls = text.match(URL_REGEX) ?? [];
  const cited_sources = rawUrls
    .slice(0, 10) // cap at 10 to avoid bloat
    .map((url) => {
      try {
        const domain = new URL(url).hostname.replace(/^www\./, "");
        return { url, domain, snippet: "", type: "other" as const };
      } catch {
        return null;
      }
    })
    .filter((s) => s !== null) as CitedSource[];

  // ── Share of model score ───────────────────────────────────────────────────
  // Position-weighted: earlier mention = more prominent = higher score
  const POSITION_WEIGHTS: Record<ScoredResult["mention_position"], number> = {
    first_third: 1.0,
    middle: 0.6,
    last_third: 0.3,
    not_mentioned: 0.0,
  };
  const share_of_model_score = POSITION_WEIGHTS[mention_position];

  return {
    brand_mentioned,
    mention_position,
    mention_sentiment,
    competitors_mentioned,
    cited_sources,
    share_of_model_score,
  };
}
