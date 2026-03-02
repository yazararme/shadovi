// Pure BVI computation — no DB calls.
// The calling page fetches data; this function crunches it.
// BVI = Brand Vulnerability Index: how easily LLMs confirm false claims about a brand.
// Score 0–100 where LOWER IS BETTER (inverted vs accuracy).

export interface BVIScoreInput {
  fact_id: string | null;
  // fact_is_true = false identifies bait facts (deliberately false claims)
  fact_is_true: boolean;
  fact_claim: string;
  bait_triggered: boolean;
  model: string;
}

export interface BVIResult {
  frequency: number | null;       // 0–100, null if no bait runs
  replication: number | null;     // 0–100, null if no bait facts
  severity: null;                 // future — requires client-configurable severity ratings
  persistence: null;              // future — requires two time periods of data
  composite: number | null;       // 0–100, null if no bait data at all
  baitRunsTotal: number;
  baitTriggeredCount: number;
  baitFactsTotal: number;
  perModel: Record<string, {
    baitRuns: number;
    triggered: number;
    triggerRate: number;          // 0–100
    uniqueFactsTriggered: number;
    totalBaitFacts: number;
  }>;
  perFact: Record<string, {
    factClaim: string;
    modelsTriggered: string[];
    totalModels: number;
    replicationRate: number;      // 0.0–1.0
  }>;
}

/**
 * BVI colour coding — INVERTED vs accuracy.
 * 0–15  = low vulnerability  = green
 * 16–40 = moderate           = amber
 * 41+   = high vulnerability = coral
 */
export function bviColor(score: number | null): string {
  if (score === null) return "#9CA3AF";
  if (score <= 15) return "#1A8F5C";
  if (score <= 40) return "#F59E0B";
  return "#FF4B6E";
}

export function computeBVI(
  scores: BVIScoreInput[],
  selectedModels: string[]
): BVIResult {
  // Bait scores: linked to a brand fact that is explicitly false (is_true = false)
  const baitScores = scores.filter((s) => s.fact_id !== null && !s.fact_is_true);

  const baitRunsTotal = baitScores.length;
  const baitTriggeredCount = baitScores.filter((s) => s.bait_triggered).length;

  // Frequency: % of bait runs where LLM confirmed the false claim
  const frequency: number | null =
    baitRunsTotal > 0
      ? Math.round((baitTriggeredCount / baitRunsTotal) * 100)
      : null;

  // Unique bait facts — grouped by fact_id
  const baitFactIds = new Set(baitScores.map((s) => s.fact_id as string));
  const baitFactsTotal = baitFactIds.size;

  // Replication: for each bait fact, how many distinct models triggered it?
  const perFact: BVIResult["perFact"] = {};
  let replicationRateSum = 0;

  for (const factId of baitFactIds) {
    const factScores = baitScores.filter((s) => s.fact_id === factId);
    const factClaim = factScores[0]?.fact_claim ?? "";

    // Models that triggered this false claim at least once
    const triggeredModels = [
      ...new Set(
        factScores.filter((s) => s.bait_triggered).map((s) => s.model)
      ),
    ];

    const totalModels = selectedModels.length;
    // Replication rate: fraction of selected models that confirmed this false claim
    const replicationRate =
      totalModels > 0 ? triggeredModels.length / totalModels : 0;
    replicationRateSum += replicationRate;

    perFact[factId] = {
      factClaim,
      modelsTriggered: triggeredModels,
      totalModels,
      replicationRate,
    };
  }

  const replication: number | null =
    baitFactsTotal > 0
      ? Math.round((replicationRateSum / baitFactsTotal) * 100)
      : null;

  // Composite: F × 0.6 + R × 0.4
  // When S and P are added later: F×0.3 + S×0.3 + R×0.2 + P×0.2
  const composite: number | null =
    frequency !== null
      ? Math.round(frequency * 0.6 + (replication ?? 0) * 0.4)
      : null;

  // Per-model breakdown
  const perModel: BVIResult["perModel"] = {};
  for (const model of selectedModels) {
    const modelBaitScores = baitScores.filter((s) => s.model === model);
    const triggered = modelBaitScores.filter((s) => s.bait_triggered).length;
    const uniqueFactsTriggered = new Set(
      modelBaitScores
        .filter((s) => s.bait_triggered)
        .map((s) => s.fact_id as string)
    ).size;

    perModel[model] = {
      baitRuns: modelBaitScores.length,
      triggered,
      triggerRate:
        modelBaitScores.length > 0
          ? Math.round((triggered / modelBaitScores.length) * 100)
          : 0,
      uniqueFactsTriggered,
      totalBaitFacts: baitFactsTotal,
    };
  }

  return {
    frequency,
    replication,
    severity: null,
    persistence: null,
    composite,
    baitRunsTotal,
    baitTriggeredCount,
    baitFactsTotal,
    perModel,
    perFact,
  };
}
