import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callHaiku } from "@/lib/llm/anthropic";
import { z } from "zod";

const QueryUpdateSchema = z.array(
  z.object({
    id: z.string(),
    text: z.string().optional(),
    relevance_score: z.number().min(1).max(10).optional(),
  })
);

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { clientId } = await request.json() as { clientId: string };
    if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

    // Fetch current pending queries
    const { data: queries } = await supabase
      .from("queries")
      .select("*")
      .eq("client_id", clientId)
      .eq("status", "pending_approval");

    if (!queries || queries.length === 0) {
      return NextResponse.json({ error: "No pending queries to critique" }, { status: 400 });
    }

    const prompt = `You are reviewing an AEO query portfolio. Evaluate the following ${queries.length} queries:

1. Score each query 1-10 for strategic relevance (10 = highly targeted; 1 = generic, won't yield signal)
2. Rewrite any query scoring below 5 to be more specific and actionable
3. Ensure conversational queries sound like a real person typing to ChatGPT — not keyword searches

Return a JSON array with ONLY the id, updated text (if changed), and relevance_score for each query.
Return ONLY valid JSON. No markdown.

Queries:
${JSON.stringify(queries.map((q) => ({ id: q.id, text: q.text, intent: q.intent, phrasing_style: q.phrasing_style })), null, 2)}`;

    const raw = await callHaiku(prompt);
    const cleaned = raw.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();

    let updates: unknown;
    try {
      updates = JSON.parse(cleaned);
    } catch {
      return NextResponse.json({ error: "Critic pass returned invalid JSON" }, { status: 500 });
    }

    const parsed = QueryUpdateSchema.safeParse(updates);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid critique response format" }, { status: 500 });
    }

    // Build a set of IDs we actually sent to the LLM — only update those.
    // Guards against a manipulated LLM response referencing query IDs from other clients.
    const validQueryIds = new Set(queries.map((q) => q.id));

    // Apply updates
    for (const update of parsed.data) {
      if (!validQueryIds.has(update.id)) continue; // reject any ID not belonging to this client
      const patch: { relevance_score?: number; text?: string } = {};
      if (update.relevance_score !== undefined) patch.relevance_score = update.relevance_score;
      if (update.text !== undefined) patch.text = update.text;
      if (Object.keys(patch).length > 0) {
        await supabase.from("queries").update(patch).eq("id", update.id);
      }
    }

    // Fetch updated queries
    const { data: updated } = await supabase
      .from("queries")
      .select("*")
      .eq("client_id", clientId)
      .eq("status", "pending_approval")
      .order("relevance_score", { ascending: false });

    return NextResponse.json({ queries: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
