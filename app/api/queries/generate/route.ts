import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { generateQueries } from "@/lib/synthetic-buyer/query-generator";
import { createPortfolioVersion } from "@/lib/versioning/create-version";
import type { ClientContext, BrandFact, VersionTrigger } from "@/types";

// Auth: session check → service write

// Two sequential Claude calls (generate + critic) can take 60-90s on large brand contexts.
// Without this, Vercel defaults to 10s (Hobby) or 60s (Pro) and silently kills the route.
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { clientId, trigger = "manual_regeneration", versionName, countsPerIntent } = await request.json() as {
      clientId: string;
      trigger?: VersionTrigger;
      versionName?: string;
      countsPerIntent?: Partial<Record<import("@/types").QueryIntent, number>>;
    };
    if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

    // Fetch full client context + brand facts for anchoring validation queries
    const [clientRes, personasRes, competitorsRes, factsRes] = await Promise.all([
      supabase.from("clients").select("*").eq("id", clientId).single(),
      supabase.from("personas").select("*").eq("client_id", clientId).order("priority"),
      supabase.from("competitors").select("*").eq("client_id", clientId),
      supabase.from("brand_facts").select("*").eq("client_id", clientId).order("created_at"),
    ]);

    if (clientRes.error || !clientRes.data) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    // Ownership check — must happen before any writes.
    // The service-role write below bypasses RLS, so we verify access here:
    // user either owns the client directly or has a user_clients junction row.
    const isOwner = clientRes.data.user_id === user.id;
    if (!isOwner) {
      const { count } = await supabase
        .from("user_clients")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("client_id", clientId);
      if (!count || count === 0) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    if (!clientRes.data.brand_dna) {
      return NextResponse.json({ error: "No brand DNA" }, { status: 400 });
    }

    const ctx: ClientContext = {
      client: clientRes.data,
      personas: personasRes.data ?? [],
      competitors: competitorsRes.data ?? [],
      brandDNA: clientRes.data.brand_dna,
    };

    // Pass brand facts if available — validation queries will be anchored to specific claims.
    // If none exist, validation queries fall back to generic criteria-based generation.
    const brandFacts = (factsRes.data ?? []) as BrandFact[];
    const queries = await generateQueries(ctx, brandFacts.length > 0 ? brandFacts : undefined, countsPerIntent);

    // Service client for all writes — session JWT can go stale during the 60-90s
    // LLM work above, so every write below uses svc to bypass RLS.
    const svc = createServiceClient();

    // Create a new portfolio version — deactivates the previous one and returns a fresh versionId.
    // Must happen before inserting new queries so they can be stamped with the new version.
    const { versionId } = await createPortfolioVersion(clientId, trigger, svc);

    // Soft-deactivate existing queries rather than hard-deleting them.
    // Historical tracking_runs still reference these query rows via query_id, so hard
    // deletion would orphan them. Soft-delete preserves the historical data chain.
    const { error: deactivateError } = await svc
      .from("queries")
      .update({
        status:                "inactive",
        deactivated_at:        new Date().toISOString(),
        deactivated_by_version: versionId,
      })
      .eq("client_id", clientId)
      .in("status", ["pending_approval", "active"]);

    if (deactivateError) {
      console.error("[queries/generate] Failed to deactivate existing queries:", deactivateError.message, { clientId, versionId });
    }

    // Always insert as 'active' — queries in pending_approval are invisible to the
    // tracker and silently produce "No active queries" failures. The review/approve
    // step has been removed; generation is now the single activation point.
    const { data: inserted, error: insertError } = await svc
      .from("queries")
      .insert(queries.map((q) => ({ ...q, client_id: clientId, status: "active", version_id: versionId })))
      .select();

    // Check insert error before the version count update so we don't stamp a wrong count
    if (insertError) {
      console.error("[queries/generate] Failed to insert new queries:", insertError.message, { clientId, versionId, queryCount: queries.length });
      throw new Error(`DB insert error: ${insertError.message}`);
    }

    // Update the version row with the accurate post-insert query count (and optional name)
    if (inserted?.length) {
      const versionPatch: Record<string, unknown> = { query_count: inserted.length };
      if (versionName?.trim()) versionPatch.name = versionName.trim();

      const { error: versionUpdateError } = await svc
        .from("portfolio_versions")
        .update(versionPatch)
        .eq("id", versionId);

      if (versionUpdateError) {
        console.error("[queries/generate] Failed to update portfolio_versions query_count:", versionUpdateError.message, { versionId, count: inserted.length });
      }
    }

    // Activate the client if it was still in onboarding. Makes generate/route the
    // single activation point — no separate /api/versioning/activate step needed.
    // Use createServiceClient so RLS cannot silently swallow this write — session
    // clients return error=null with 0 rows updated when the row is filtered by RLS.
    // The user was already authenticated above so service role is safe here.
    if (clientRes.data.status === "onboarding") {
      const { error: activateError } = await svc
        .from("clients")
        .update({ status: "active" })
        .eq("id", clientId);
      if (activateError) {
        console.error("[queries/generate] Failed to activate client:", activateError.message, { clientId });
      }
    }

    return NextResponse.json({ queries: inserted });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[queries/generate] Unhandled error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
