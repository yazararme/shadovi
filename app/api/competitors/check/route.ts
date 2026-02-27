import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callGemini } from "@/lib/llm/gemini";
import { callPerplexity } from "@/lib/llm/perplexity";
import type { Competitor } from "@/types";

// Module-level cache — lives for the server process session.
// Key = lowercased competitor name.
const recognitionCache = new Map<string, { gemini: boolean; perplexity: boolean }>();

function buildEntityCheckPrompt(name: string): string {
  return `In one sentence, describe the company "${name}" and what product or service they are known for. If you are not familiar with this company, explicitly say "I am not familiar with ${name}".`;
}

function parseRecognition(response: string, name: string): boolean {
  const lower = response.toLowerCase();
  const notFamiliarPhrases = [
    "not familiar",
    "don't have information",
    "no information",
    "i cannot",
    "i don't know",
    "unable to find",
    "no knowledge",
  ];
  const isUnrecognized =
    notFamiliarPhrases.some((p) => lower.includes(p)) || response.length < 40;
  return !isUnrecognized;
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { clientId, competitors } = await request.json() as {
      clientId: string;
      competitors: { name: string; url?: string }[];
    };

    if (!clientId || !Array.isArray(competitors)) {
      return NextResponse.json({ error: "clientId and competitors[] required" }, { status: 400 });
    }

    // Verify client ownership
    const { data: client } = await supabase
      .from("clients")
      .select("id")
      .eq("id", clientId)
      .single();
    if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

    // Check all competitors in parallel — each comp gets its own Gemini + Perplexity pair.
    // Previously serial: N competitors × ~10s per pair = N×10s total.
    // Now parallel: all pairs fire simultaneously → wall-clock time ≈ slowest single check (~10s).
    const results: Partial<Competitor>[] = await Promise.all(
      competitors.map(async (comp) => {
        const cacheKey = comp.name.toLowerCase().trim();

        let detail: { gemini: boolean; perplexity: boolean };

        if (recognitionCache.has(cacheKey)) {
          detail = recognitionCache.get(cacheKey)!;
        } else {
          const prompt = buildEntityCheckPrompt(comp.name);
          const [geminiResponse, perplexityResponse] = await Promise.allSettled([
            callGemini(prompt),
            callPerplexity(prompt),
          ]);

          detail = {
            gemini:
              geminiResponse.status === "fulfilled"
                ? parseRecognition(geminiResponse.value, comp.name)
                : false,
            perplexity:
              perplexityResponse.status === "fulfilled"
                ? parseRecognition(perplexityResponse.value, comp.name)
                : false,
          };

          recognitionCache.set(cacheKey, detail);
        }

        const recognizedCount = [detail.gemini, detail.perplexity].filter(Boolean).length;
        return {
          client_id: clientId,
          name: comp.name,
          url: comp.url ?? null,
          llm_recognized: recognizedCount > 0,
          recognition_detail: detail,
          context_injection: null,
        };
      })
    );

    // Upsert competitors — delete existing and re-insert to handle re-runs
    await supabase.from("competitors").delete().eq("client_id", clientId);

    const { data: inserted, error: insertError } = await supabase
      .from("competitors")
      .insert(results)
      .select();

    if (insertError) throw new Error(`DB error: ${insertError.message}`);

    return NextResponse.json({ competitors: inserted });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
