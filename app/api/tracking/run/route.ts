import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { inngest } from "@/inngest/client";

// Sends a tracking/run.requested event to Inngest rather than running inline.
// Rationale: 30 queries × 4 models = up to 120 serial LLM calls, which easily
// exceeds Vercel's 60-second function timeout. Inngest executes asynchronously
// outside the request lifecycle.
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { clientId } = await request.json() as { clientId: string };
    if (!clientId) {
      return NextResponse.json({ error: "clientId required" }, { status: 400 });
    }

    const { data: client } = await supabase
      .from("clients")
      .select("id, status")
      .eq("id", clientId)
      .single();

    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    if (client.status !== "active") {
      return NextResponse.json({ error: "Client is not active" }, { status: 400 });
    }

    // Auto-activate any pending_approval queries before queuing the run.
    // Queries can land in pending_approval when they are regenerated post-onboarding
    // (generate/route.ts skips this for active clients, but older rows or calibrate
    // runs may still be pending). The runner only reads status='active' queries, so
    // without this step the run silently fails with "No active queries".
    await supabase
      .from("queries")
      .update({ status: "active" })
      .eq("client_id", clientId)
      .eq("status", "pending_approval");

    // Send event to Inngest — returns immediately, run happens asynchronously.
    // The `id` field is an Inngest deduplication key: two sends with the same id
    // within the deduplication window (default 24h) collapse into one execution.
    // We bucket by 60-second intervals so rapid double-triggers (configure → overview
    // navigate, or accidental double-click) are silently deduplicated server-side.
    const bucketMinute = Math.floor(Date.now() / 60_000);
    await inngest.send({
      id: `tracking-run-${clientId}-${bucketMinute}`,
      name: "tracking/run.requested",
      data: { clientId },
    });

    return NextResponse.json({ queued: true, clientId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
