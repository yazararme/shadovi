import { callHaiku } from "@/lib/llm/anthropic";
import type { BrandFact, KnowledgeAccuracy, KnowledgeCompleteness, BrandPositioning } from "@/types";

// Model constant recorded on each score so historical scores aren't mixed when we upgrade
const SCORER_MODEL = "claude-haiku-4-5-20251001";

export interface KnowledgeScoreResult {
  accuracy: KnowledgeAccuracy;
  completeness: KnowledgeCompleteness;
  hallucination: boolean;
  notes: string;
  brand_positioning: BrandPositioning;
  scorer_model: string;
}

// The scoring prompt uses entirely different, explicit accuracy rules depending on is_true.
// This avoids any ambiguity — Haiku must never be asked to reason about "truth value" abstractly,
// because it conflates "aligns with the claim text" with "aligns with reality".
//
// For TRUE facts:   correct = LLM confirmed it | incorrect = LLM denied it
// For BAIT facts:   correct = LLM rejected it  | incorrect = LLM confirmed it (hallucination)
function buildScoringPrompt(
  queryText: string,
  llmResponse: string,
  fact: BrandFact
): string {
  const scoringRules = fact.is_true
    ? `THIS IS A TRUE FACT. The brand really does have this. Score as follows:
- accuracy "correct":   The LLM confirmed or described this feature/attribute exists
- accuracy "incorrect": The LLM said this does NOT exist, or contradicted the claim
- accuracy "uncertain": The LLM gave a vague or non-committal answer without confirming or denying
- hallucination true:   The LLM confidently denied a true fact (rare but possible)`
    : `THIS IS A BAIT FACT — IT IS DELIBERATELY FALSE. The brand does NOT have this.
- accuracy "correct":   The LLM correctly said this does NOT exist / is not offered
- accuracy "incorrect": The LLM said this DOES exist or confirmed the claim — THIS IS WRONG
- accuracy "uncertain": The LLM gave a vague or non-committal answer
- hallucination true:   The LLM confidently stated the false thing exists (accuracy will be "incorrect")

CRITICAL: If the LLM said the brand HAS this or OFFERS this, that is a hallucination. Score accuracy "incorrect" and hallucination true.`;

  return `You are a fact-checker for an AI monitoring platform. Evaluate whether an LLM correctly handled a brand claim.

QUERY ASKED:
"${queryText}"

LLM RESPONSE:
${llmResponse.slice(0, 2000)}

BRAND CLAIM TO EVALUATE:
"${fact.claim}"
Category: ${fact.category}

SCORING INSTRUCTIONS:
${scoringRules}

COMPLETENESS (separate from accuracy):
- "full":    The LLM gave a specific, detailed answer about this claim
- "partial": The LLM touched on it but left out key details
- "vague":   The LLM gave a generic or non-specific response

BRAND POSITIONING — how does this response position the brand overall?
- "budget":     Frames the brand as low-cost, value, or entry-level
- "mid-market": Frames as mainstream, mid-range, solid but not premium
- "premium":    Frames as high-end, best-in-class, aspirational
- "unclear":    Response doesn't give enough context to classify

Return ONLY this JSON object:
{
  "accuracy": "correct" | "incorrect" | "uncertain",
  "completeness": "full" | "partial" | "vague",
  "hallucination": true | false,
  "notes": "one sentence: what did the LLM actually say about this claim?",
  "brand_positioning": "budget" | "mid-market" | "premium" | "unclear"
}

No markdown, no explanation, just the JSON.`;
}

export async function scoreKnowledge(
  queryText: string,
  llmResponse: string,
  fact: BrandFact
): Promise<KnowledgeScoreResult> {
  const prompt = buildScoringPrompt(queryText, llmResponse, fact);

  let raw: string;
  try {
    raw = await callHaiku(prompt);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[knowledge-scorer] Haiku call failed:", msg);
    // Return a safe default rather than crashing the run
    return {
      accuracy: "uncertain",
      completeness: "vague",
      hallucination: false,
      notes: `Scoring failed: ${msg}`,
      brand_positioning: "unclear",
      scorer_model: SCORER_MODEL,
    };
  }

  const cleaned = raw
    .replace(/^```(?:json)?\n?/i, "")
    .replace(/\n?```$/i, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return {
      accuracy: "uncertain",
      completeness: "vague",
      hallucination: false,
      notes: `Could not parse scorer output: ${cleaned.slice(0, 100)}`,
      brand_positioning: "unclear",
      scorer_model: SCORER_MODEL,
    };
  }

  // Validate shape — if fields are missing or wrong type, fall back safely
  const p = parsed as Record<string, unknown>;
  const validAccuracy = ["correct", "incorrect", "uncertain"];
  const validCompleteness = ["full", "partial", "vague"];
  const validPositioning = ["budget", "mid-market", "premium", "unclear"];

  let accuracy = validAccuracy.includes(p.accuracy as string)
    ? (p.accuracy as KnowledgeAccuracy)
    : "uncertain";
  const completeness = validCompleteness.includes(p.completeness as string)
    ? (p.completeness as KnowledgeCompleteness)
    : "vague";
  let hallucination = typeof p.hallucination === "boolean" ? p.hallucination : false;
  const notes = typeof p.notes === "string" ? p.notes : "";
  const brand_positioning = validPositioning.includes(p.brand_positioning as string)
    ? (p.brand_positioning as BrandPositioning)
    : "unclear";

  // Safeguard: for bait facts (is_true=false), hallucination and incorrect are equivalent.
  // If Haiku marked hallucination:true but accuracy:"correct", that's a contradiction — fix it.
  // If Haiku marked accuracy:"incorrect" for a bait fact, ensure hallucination is set true.
  if (!fact.is_true) {
    if (hallucination && accuracy === "correct") {
      // Haiku flagged a hallucination but said correct — the hallucination flag wins
      accuracy = "incorrect";
    }
    if (accuracy === "incorrect") {
      // Confirming a false claim is always a hallucination by definition
      hallucination = true;
    }
  }

  return { accuracy, completeness, hallucination, notes, brand_positioning, scorer_model: SCORER_MODEL };
}
