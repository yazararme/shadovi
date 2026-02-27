import { inngest } from "@/inngest/client";
import { runTrackingForClient } from "@/lib/tracking/runner";
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

    const result = await step.run("execute-tracking", () =>
      runTrackingForClient(clientId)
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
