import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { trackingRunFunction } from "@/inngest/functions/trackingRun";
import { trackingModelBatchFunction } from "@/inngest/functions/modelBatch";
import { sourceProcessorFunction } from "@/inngest/functions/source-processor";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [trackingRunFunction, trackingModelBatchFunction, sourceProcessorFunction],
});