// Activation route: transitions a client from onboarding to active state.
// Creates version 1 (trigger='onboarding_activation'), stamps all pending_approval
// queries with the new version_id, sets queries + client to active.
//
// Called by configure/queries page handleActivate() — must complete before the
// first tracking run fires, because the runner reads version_id from queries.

import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { createPortfolioVersion } from "@/lib/versioning/create-version";

// Auth: session check → service write

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { clientId } = await request.json() as { clientId: string };
    if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

    const svc = createServiceClient();

    // 1. Create version 1 (first real version after onboarding)
    const { versionId, versionNumber } = await createPortfolioVersion(
      clientId,
      "onboarding_activation",
      svc
    );

    // 2. Stamp version_id on all pending_approval queries and set them active
    const { error: qError } = await svc
      .from("queries")
      .update({ status: "active", version_id: versionId })
      .eq("client_id", clientId)
      .eq("status", "pending_approval");

    if (qError) return NextResponse.json({ error: qError.message }, { status: 500 });

    // 3. Update version row with accurate query count post-stamp
    const { count: queryCount } = await supabase
      .from("queries")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId)
      .eq("status", "active");

    await svc
      .from("portfolio_versions")
      .update({ query_count: queryCount ?? 0 })
      .eq("id", versionId);

    // 4. Activate the client
    const { error: cError } = await svc
      .from("clients")
      .update({ status: "active" })
      .eq("id", clientId);

    if (cError) return NextResponse.json({ error: cError.message }, { status: 500 });

    return NextResponse.json({ versionId, versionNumber });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
