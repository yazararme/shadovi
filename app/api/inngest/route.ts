import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { trackingRunFunction } from "@/inngest/functions/trackingRun";
import { sourceProcessorFunction } from "@/inngest/functions/source-processor";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [trackingRunFunction, sourceProcessorFunction],
});