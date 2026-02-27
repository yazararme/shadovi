import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callHaiku } from "@/lib/llm/anthropic";
import type { BrandDNA, Query, QueryIntent, FunnelStage, PhrasingStyle } from "@/types";

// Query calibration: client sends a natural language instruction, we generate
// adds/removes and apply them to the DB. Server owns the writes so the client
// never touches Supabase directly for this operation.
const SYSTEM_PROMPT = `You are an AEO (Answer Engine Optimization) strategist calibrating a brand's LLM query portfolio.

Query intent taxonomy — never collapse these, each tracks a distinct buyer moment:
• problem_aware — buyer describes a pain without naming a solution (e.g. "how do I reduce energy waste in hospitals?")
• category — buyer searches for a product type (e.g. "best energy management software for hospitals")
• comparative — buyer explicitly compares vendors (e.g. "AutoDose vs EnergyIQ for hospital HVAC")
• validation — buyer checks a specific brand claim (e.g. "does AutoDose work with Johnson Controls?")

You MUST respond in this exact JSON format:
{
  "reply": "1–3 sentences explaining what you changed and why, grounded in AEO strategy",
  "adds": [
    {
      "text": "natural language query a real buyer types into ChatGPT or Perplexity",
      "intent": "problem_aware" | "category" | "comparative" | "validation",
      "funnel_stage": "awareness" | "consideration" | "decision",
      "phrasing_style": "conversational" | "formal",
      "rationale": "why this query matters for LLM visibility",
      "strategic_goal": "what winning this query achieves for the brand",
      "relevance_score": 8
    }
  ],
  "removes": ["full-uuid-of-query-to-remove"]
}

Rules:
- Return ONLY valid JSON. No markdown fences, no commentary outside the JSON.
- adds and removes can both be empty arrays if no change is needed.
- relevance_score: integer 1–10 (7+ = high strategic value).
- Query text must sound like a real human asking ChatGPT — not a keyword string.
- Never change the intent of an existing query; only add or remove.
- Use the active_intent hint to focus when the user is on a specific tab.
- When removing, only include IDs that appear in the current portfolio.`;

interface AddShape {
  text: string;
  intent: QueryIntent;
  funnel_stage: FunnelStage;
  phrasing_style: PhrasingStyle;
  rationale: string;
  strategic_goal: string;
  relevance_score: number;
}

interface RefineResult {
  reply: string;
  adds: AddShape[];
  removes: string[];
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { clientId, message, currentQueries, activeIntent, brandDNA } =
      (await request.json()) as {
        clientId: string;
        message: string;
        currentQueries: Pick<Query, "id" | "text" | "intent" | "status">[];
        activeIntent?: QueryIntent;
        brandDNA?: BrandDNA;
      };

    if (!clientId || !message) {
      return NextResponse.json({ error: "clientId and message required" }, { status: 400 });
    }

    // RLS: verify this client belongs to the caller
    const { data: client } = await supabase
      .from("clients")
      .select("id")
      .eq("id", clientId)
      .single();
    if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

    // Build a compact portfolio snapshot — IDs are truncated to 8 chars for readability
    // but we keep the full IDs in a lookup so removes can be matched back.
    const active = currentQueries.filter((q) => q.status !== "removed");
    const shortToFull = new Map(active.map((q) => [q.id.slice(0, 8), q.id]));

    const intentBlock = (intent: string) => {
      const rows = active
        .filter((q) => q.intent === intent)
        .map((q) => `  [${q.id}] ${q.text}`)
        .join("\n");
      return rows || "  (none)";
    };

    const contextPrompt = `Brand: ${brandDNA?.brand_name ?? "Unknown"} — ${brandDNA?.category_name ?? ""}
Brand POV: ${brandDNA?.brand_pov ?? ""}
Differentiators: ${(brandDNA?.differentiators ?? []).join(", ")}

Current query portfolio (${active.length} active queries):

PROBLEM_AWARE (${active.filter((q) => q.intent === "problem_aware").length}):
${intentBlock("problem_aware")}

CATEGORY (${active.filter((q) => q.intent === "category").length}):
${intentBlock("category")}

COMPARATIVE (${active.filter((q) => q.intent === "comparative").length}):
${intentBlock("comparative")}

VALIDATION (${active.filter((q) => q.intent === "validation").length}):
${intentBlock("validation")}

${activeIntent ? `User is currently viewing the ${activeIntent.toUpperCase()} tab.` : ""}

User instruction: ${message}`;

    const raw = await callHaiku(contextPrompt, SYSTEM_PROMPT);
    const cleaned = raw.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();

    let parsed: RefineResult;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // Graceful fallback: plain reply, no mutations
      return NextResponse.json({ reply: raw.slice(0, 500), adds: [], removes: [] });
    }

    // Resolve any short IDs the model may have used back to full UUIDs
    const resolvedRemoves = (parsed.removes ?? []).map(
      (id) => shortToFull.get(id.slice(0, 8)) ?? id
    );

    // Insert new queries into the DB — server assigns IDs
    const insertedQueries: Query[] = [];
    if (Array.isArray(parsed.adds) && parsed.adds.length > 0) {
      const rows = parsed.adds.map((a) => ({
        client_id: clientId,
        text: a.text ?? "",
        intent: (["problem_aware", "category", "comparative", "validation"].includes(a.intent)
          ? a.intent
          : "category") as QueryIntent,
        funnel_stage: (["awareness", "consideration", "decision"].includes(a.funnel_stage)
          ? a.funnel_stage
          : "consideration") as FunnelStage,
        phrasing_style: (["conversational", "formal"].includes(a.phrasing_style)
          ? a.phrasing_style
          : "conversational") as PhrasingStyle,
        rationale: a.rationale ?? null,
        strategic_goal: a.strategic_goal ?? null,
        relevance_score: typeof a.relevance_score === "number" ? a.relevance_score : null,
        status: "pending_approval" as const,
        is_bait: false,
        bait_type: null,
        persona_id: null,
        fact_id: null,
      }));

      const { data: inserted } = await supabase.from("queries").insert(rows).select("*");
      if (inserted) insertedQueries.push(...(inserted as Query[]));
    }

    // Mark removes — filter to client's own queries for safety
    if (resolvedRemoves.length > 0) {
      await supabase
        .from("queries")
        .update({ status: "removed" })
        .eq("client_id", clientId)
        .in("id", resolvedRemoves);
    }

    return NextResponse.json({
      reply: parsed.reply,
      adds: insertedQueries,
      removes: resolvedRemoves,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
