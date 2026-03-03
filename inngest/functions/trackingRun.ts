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
    // step.run() calls inside Promise.all ran sequentially anyway (they compete
    // for the same per-client concurrency slot), so sequential is explicit here.
    // Each step has its own timeout and retry budget within the function run.
    const modelResults: Awaited<ReturnType<typeof runModelBatch>>[] = [];
    for (const model of ctx.selectedModels as LLMModel[]) {
      const result = await step.run(`model-${model}`, () =>
        runModelBatch(ctx, model)
      );
      modelResults.push(result);
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
