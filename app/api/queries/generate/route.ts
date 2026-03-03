import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateQueries } from "@/lib/synthetic-buyer/query-generator";
import { createPortfolioVersion } from "@/lib/versioning/create-version";
import type { ClientContext, BrandFact, VersionTrigger } from "@/types";

// Two sequential Claude calls (generate + critic) can take 60-90s on large brand contexts.
// Without this, Vercel defaults to 10s (Hobby) or 60s (Pro) and silently kills the route.
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { clientId, trigger = "manual_regeneration" } = await request.json() as { clientId: string; trigger?: VersionTrigger };
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
    const queries = await generateQueries(ctx, brandFacts.length > 0 ? brandFacts : undefined);

    // Create a new portfolio version — deactivates the previous one and returns a fresh versionId.
    // Must happen before inserting new queries so they can be stamped with the new version.
    const { versionId } = await createPortfolioVersion(clientId, trigger, supabase);

    // Soft-deactivate existing queries rather than hard-deleting them.
    // Historical tracking_runs still reference these query rows via query_id, so hard
    // deletion would orphan them. Soft-delete preserves the historical data chain.
    const { error: deactivateError } = await supabase
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
    const { data: inserted, error: insertError } = await supabase
      .from("queries")
      .insert(queries.map((q) => ({ ...q, client_id: clientId, status: "active", version_id: versionId })))
      .select();

    // Check insert error before the version count update so we don't stamp a wrong count
    if (insertError) {
      console.error("[queries/generate] Failed to insert new queries:", insertError.message, { clientId, versionId, queryCount: queries.length });
      throw new Error(`DB insert error: ${insertError.message}`);
    }

    // Update the version row with the accurate post-insert query count
    if (inserted?.length) {
      const { error: versionUpdateError } = await supabase
        .from("portfolio_versions")
        .update({ query_count: inserted.length })
        .eq("id", versionId);

      if (versionUpdateError) {
        console.error("[queries/generate] Failed to update portfolio_versions query_count:", versionUpdateError.message, { versionId, count: inserted.length });
      }
    }

    // Activate the client if it was still in onboarding. Makes generate/route the
    // single activation point — no separate /api/versioning/activate step needed.
    if (clientRes.data.status === "onboarding") {
      const { error: activateError } = await supabase
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
