import { inngest } from "@/inngest/client";
import {
  fetchRunContext,
  processOneQuery,
  finaliseRun,
  type QueryStepResult,
} from "@/lib/tracking/runner";
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

    // ── Per-query steps ─────────────────────────────────────────────────────
    //
    // Previous architecture: one step.run() per model, processing all 32 queries
    // inside a single step. With queries taking up to 90s each (plus scoring),
    // a single model step could run 48+ minutes — far beyond Vercel's 5-minute
    // function timeout. Inngest retried the entire step from scratch indefinitely.
    //
    // New architecture: one step.run() per (model, query) pair. Each step
    // processes exactly one query (~1-2 minutes), checkpoints, and if the
    // Vercel function times out between steps, Inngest replays from the last
    // checkpoint — skipping already-completed steps via memoisation.
    //
    // Step IDs are deterministic because they're built from query.id which comes
    // from the checkpointed ctx object. The existing dedup guard in processOneQuery
    // also prevents duplicate DB records if a step itself retries.
    //
    // Models are still guarded with hardcoded if-blocks (not a dynamic loop over
    // ctx.selectedModels) for the same reason as before: selectedModels is part
    // of the serialised ctx, but using static guards with fixed model strings
    // eliminates any risk of step ID drift across replays.

    const modelsToRun = ctx.selectedModels as LLMModel[];
    const allResults: QueryStepResult[] = [];

    if (modelsToRun.includes("gpt-4o")) {
      for (const q of ctx.queries) {
        const r = await step.run(`gpt-4o-${q.id}`, () =>
          processOneQuery(ctx, "gpt-4o", q)
        );
        allResults.push(r);
      }
    }

    if (modelsToRun.includes("perplexity")) {
      for (const q of ctx.queries) {
        const r = await step.run(`perplexity-${q.id}`, () =>
          processOneQuery(ctx, "perplexity", q)
        );
        allResults.push(r);
      }
    }

    if (modelsToRun.includes("claude-sonnet-4-6")) {
      for (const q of ctx.queries) {
        const r = await step.run(`claude-sonnet-4-6-${q.id}`, () =>
          processOneQuery(ctx, "claude-sonnet-4-6", q)
        );
        allResults.push(r);
      }
    }

    if (modelsToRun.includes("gemini")) {
      for (const q of ctx.queries) {
        const r = await step.run(`gemini-${q.id}`, () =>
          processOneQuery(ctx, "gemini", q)
        );
        allResults.push(r);
      }
    }

    if (modelsToRun.includes("deepseek")) {
      for (const q of ctx.queries) {
        const r = await step.run(`deepseek-${q.id}`, () =>
          processOneQuery(ctx, "deepseek", q)
        );
        allResults.push(r);
      }
    }

    // ── Finalise: merge per-query results and generate recommendations ──────
    // Pass versionId so generated recs are stamped with the active portfolio version.
    const result = await step.run("finalise", () =>
      finaliseRun(clientId, ctx.brandName, ctx.queries.length, ctx.selectedModels as LLMModel[], allResults, ctx.versionId)
    );

    // Non-critical post-run step: cluster gap queries into named findings.
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
