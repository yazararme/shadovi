import { inngest } from "@/inngest/client";
import { fetchRunContext, runModelBatch, finaliseRun } from "@/lib/tracking/runner";
import { clusterGapsForClient } from "@/lib/tracking/gap-clusterer";

export const trackingRunFunction = inngest.createFunction(
  {
    id: "tracking-run",
    // One run per client at a time — prevents two events for the same client from
    // executing in parallel if the deduplication key somehow misses (e.g. events
    // sent > 60 seconds apart). Global limit of 2 keeps total LLM load manageable.
    concurrency: [
      { limit: 1, key: "event.data.clientId" },
      { limit: 2 },
    ],
  },
  { event: "tracking/run.requested" },
  async ({ event, step }) => {
    const { clientId } = event.data as { clientId: string };

    // Step 1: Fetch client context — queries, competitors, facts, active version.
    // Stored as Inngest state so subsequent steps don't need to re-query the DB.
    const ctx = await step.run("setup", () => fetchRunContext(clientId));

    // Steps 2-N: One step per model — each runs independently with its own timeout.
    // Promise.all fans out to parallel Inngest steps; the function suspends and
    // resumes as each completes. Previously all models ran inside a single step
    // ("execute-tracking"), which timed out at 5 minutes for a full portfolio run.
    const modelResults = await Promise.all(
      ctx.selectedModels.map((model) =>
        step.run(`model-${model}`, () => runModelBatch(ctx, model))
      )
    );

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
