import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateQueries } from "@/lib/synthetic-buyer/query-generator";
import { createPortfolioVersion } from "@/lib/versioning/create-version";
import type { ClientContext, BrandFact, VersionTrigger } from "@/types";

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
    await supabase
      .from("queries")
      .update({
        status:                "inactive",
        deactivated_at:        new Date().toISOString(),
        deactivated_by_version: versionId,
      })
      .eq("client_id", clientId)
      .in("status", ["pending_approval", "active"]);

    const { data: inserted, error: insertError } = await supabase
      .from("queries")
      .insert(queries.map((q) => ({ ...q, client_id: clientId, status: "pending_approval", version_id: versionId })))
      .select();

    // Update the version row with the accurate post-insert query count
    if (inserted?.length) {
      await supabase
        .from("portfolio_versions")
        .update({ query_count: inserted.length })
        .eq("id", versionId);
    }

    if (insertError) throw new Error(`DB insert error: ${insertError.message}`);

    return NextResponse.json({ queries: inserted });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
