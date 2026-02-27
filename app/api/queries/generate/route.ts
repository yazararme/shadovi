import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateQueries } from "@/lib/synthetic-buyer/query-generator";
import type { ClientContext, BrandFact } from "@/types";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { clientId } = await request.json() as { clientId: string };
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

    // Wipe ALL queries for this client on regenerate — any status, no exceptions.
    // Filtering by status left paused/removed rows behind and caused stacking.
    await supabase
      .from("queries")
      .delete()
      .eq("client_id", clientId);

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
