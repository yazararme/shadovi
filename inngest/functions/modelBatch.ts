import { inngest } from "@/inngest/client";
import { runModelBatch, type RunContext, type ModelBatchResult } from "@/lib/tracking/runner";
import type { LLMModel } from "@/types";

/**
 * Per-model batch worker — invoked by trackingRun via step.invoke(), never triggered
 * by an external event. Running as a separate function means each model gets its own
 * independent function run with its own timeout and retry budget, and does not share
 * the parent run's concurrency slot (so all models fan-out truly in parallel).
 */
export const trackingModelBatchFunction = inngest.createFunction(
  {
    id: "tracking-model-batch",
    // No per-client concurrency key here — we WANT multiple model batches for the
    // same client to run in parallel. The parent (tracking-run) enforces the
    // one-run-per-client guarantee via its own concurrency config.
    concurrency: { limit: 15 },
  },
  // Event name is required but this function is only ever invoked via step.invoke()
  { event: "tracking/model-batch.requested" },
  async ({ event }): Promise<ModelBatchResult> => {
    const { ctx, model } = event.data as { ctx: RunContext; model: LLMModel };
    return runModelBatch(ctx, model);
  }
);
