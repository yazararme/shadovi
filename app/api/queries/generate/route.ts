import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { generateQueries } from "@/lib/synthetic-buyer/query-generator";
import { createPortfolioVersion } from "@/lib/versioning/create-version";
import { callHaiku } from "@/lib/llm/anthropic";
import type { ClientContext, BrandDNA, BrandFact, BrandFactCategory, VersionTrigger } from "@/types";

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
    let brandFacts = (factsRes.data ?? []) as BrandFact[];

    // Auto-generate false claim tests if none exist — bait queries require is_true=false
    // brand facts for BVI scoring. Without them, ensureMinBaitQueries has nothing to inject.
    const hasFalseClaims = brandFacts.some((f) => !f.is_true);
    if (!hasFalseClaims && clientRes.data.brand_dna) {
      const dna = clientRes.data.brand_dna as BrandDNA;
      const falseClaimPrompt = `You are a brand strategist. Generate exactly 2 false claim tests for the brand "${dna.brand_name}" (${dna.category_name}).

These are plausible-sounding things this brand does NOT offer — competitor features or adjacent-category capabilities that an AI could realistically confuse or hallucinate.

Brand context:
- Product: ${dna.product_description}
- Key products: ${dna.key_products.map((p) => p.name).join(", ")}
- Differentiators: ${dna.differentiators.join(", ")}

Return ONLY a JSON array of exactly 2 objects:
[{ "claim": "specific false claim", "category": "feature" }]

Rules:
- Claims must be specific and testable, not vague
- Claims must be plausible — something an AI might confirm if it hallucinated
- category must be one of: feature, market, pricing, messaging
- Return ONLY valid JSON. No markdown, no explanation.`;

      try {
        const raw = await callHaiku(falseClaimPrompt);
        const cleaned = raw.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
        const parsed = JSON.parse(cleaned) as { claim: string; category: BrandFactCategory }[];
        const validCategories = new Set(["feature", "market", "pricing", "messaging"]);
        const toInsert = parsed
          .filter((f) => f.claim?.trim() && validCategories.has(f.category))
          .slice(0, 2)
          .map((f) => ({
            client_id: clientId,
            claim: f.claim.trim(),
            category: f.category,
            is_true: false,
          }));

        if (toInsert.length > 0) {
          const svcForFacts = createServiceClient();
          const { data: newFacts } = await svcForFacts
            .from("brand_facts")
            .insert(toInsert)
            .select();
          if (newFacts) {
            brandFacts = [...brandFacts, ...(newFacts as BrandFact[])];
            console.log(`[queries/generate] Auto-generated ${newFacts.length} false claim tests for BVI`);
          }
        }
      } catch (err) {
        // Non-fatal — query generation proceeds without bait queries
        console.warn("[queries/generate] Failed to auto-generate false claims:", err instanceof Error ? err.message : err);
      }
    }

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
