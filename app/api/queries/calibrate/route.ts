import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { calibrateQueries } from "@/lib/synthetic-buyer/query-generator";
import type { ClientContext, BrandFact, QueryIntent } from "@/types";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { clientId, instruction, intent } = await request.json() as {
      clientId: string;
      instruction: string;
      intent: QueryIntent | "all";
    };
    if (!clientId || !instruction) {
      return NextResponse.json({ error: "clientId and instruction are required" }, { status: 400 });
    }

    // Fetch full client context — same pattern as generate route
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

    const brandFacts = (factsRes.data ?? []) as BrandFact[];
    const allIntents: QueryIntent[] = ["problem_aware", "category", "comparative", "validation"];
    const affectedIntents: QueryIntent[] = intent === "all" ? allIntents : [intent as QueryIntent];

    const queries = await calibrateQueries(ctx, brandFacts, instruction, affectedIntents);

    // Fetch candidate queries (non-manually-added, matching intents)
    const { data: candidates } = await supabase
      .from("queries")
      .select("id")
      .eq("client_id", clientId)
      .in("intent", affectedIntents)
      .eq("manually_added", false);

    if (candidates && candidates.length > 0) {
      const candidateIds = candidates.map((q) => q.id);

      // Determine which candidates have associated tracking_runs — those must be
      // archived rather than deleted to preserve the historical data chain.
      const { data: runsData } = await supabase
        .from("tracking_runs")
        .select("query_id")
        .in("query_id", candidateIds);

      const idsWithRuns = new Set((runsData ?? []).map((r) => r.query_id));
      const idsToArchive = candidateIds.filter((id) => idsWithRuns.has(id));
      const idsToDelete  = candidateIds.filter((id) => !idsWithRuns.has(id));

      if (idsToArchive.length > 0) {
        await supabase
          .from("queries")
          .update({ status: "archived" })
          .in("id", idsToArchive);
      }
      if (idsToDelete.length > 0) {
        await supabase
          .from("queries")
          .delete()
          .in("id", idsToDelete);
      }
    }

    const { data: inserted, error: insertError } = await supabase
      .from("queries")
      .insert(queries.map((q) => ({ ...q, client_id: clientId, status: "pending_approval" })))
      .select();

    if (insertError) throw new Error(`DB insert error: ${insertError.message}`);

    return NextResponse.json({ queries: inserted });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
