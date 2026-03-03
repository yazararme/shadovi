import { inngest } from "@/inngest/client";
import { fetchRunContext, runModelBatch, finaliseRun } from "@/lib/tracking/runner";
import { clusterGapsForClient } from "@/lib/tracking/gap-clusterer";
import type { LLMModel } from "@/types";

export const trackingRunFunction = inngest.createFunction(
  {
    id: "tracking-run",
    // One run per client at a time — prevents two events for the same client from
    // executing in parallel if the deduplication key somehow misses (e.g. events
    // sent > 60 seconds apart).
    concurrency: { limit: 1, key: "event.data.clientId" },
  },
  { event: "tracking/run.requested" },
  async ({ event, step }) => {
    const { clientId } = event.data as { clientId: string };

    // Step 1: Fetch client context — queries, competitors, facts, active version.
    // Stored as Inngest state so subsequent steps don't re-query the DB.
    const ctx = await step.run("setup", () => fetchRunContext(clientId));

    // Steps 2-N: One step.run() per model, running sequentially.
    // Hardcoded per-model steps (not a for loop) because Inngest replays functions
    // from scratch on each checkpoint — a dynamic loop over ctx.selectedModels
    // produces non-deterministic step IDs across replays, causing all model work
    // to collapse into the wrong step. Static if-guards with fixed step IDs are safe.
    const modelsToRun = ctx.selectedModels as LLMModel[];
    const modelResults: Awaited<ReturnType<typeof runModelBatch>>[] = [];

    if (modelsToRun.includes("gpt-4o")) {
      modelResults.push(await step.run("model-gpt-4o", () => runModelBatch(ctx, "gpt-4o")));
    }
    if (modelsToRun.includes("perplexity")) {
      modelResults.push(await step.run("model-perplexity", () => runModelBatch(ctx, "perplexity")));
    }
    if (modelsToRun.includes("claude-sonnet-4-6")) {
      modelResults.push(await step.run("model-claude-sonnet-4-6", () => runModelBatch(ctx, "claude-sonnet-4-6")));
    }
    if (modelsToRun.includes("gemini")) {
      modelResults.push(await step.run("model-gemini", () => runModelBatch(ctx, "gemini")));
    }
    if (modelsToRun.includes("deepseek")) {
      modelResults.push(await step.run("model-deepseek", () => runModelBatch(ctx, "deepseek")));
    }

    // Step N+1: Merge per-model tallies and generate AI recommendations.
    const result = await step.run("finalise", () =>
      finaliseRun(clientId, ctx.brandName, ctx.queries.length, modelResults)
    );

    // Non-critical post-run step: cluster gap queries into named findings.
    // Wrapped so a Haiku failure never blocks the tracking result from returning.
    await step.run("cluster-gaps", async () => {
      try {
        await clusterGapsForClient(clientId);
      } catch (err) {
        console.error("[trackingRun] gap clustering step failed:", err);
      }
    });

    await inngest.send({ name: "source/process.requested", data: { clientId } });

    return { clientId, ...result };
  }
);
