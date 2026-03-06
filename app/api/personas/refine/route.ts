import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { callHaiku } from "@/lib/llm/anthropic";
import type { BrandDNA, RefineResponse } from "@/types";

// Auth: session check → service write

const BASE_RULES = `Rules:
- Frame everything in terms of how it affects what their buyers ask AI models
- Be concise. Maximum 3 sentences in the reply field.
- Return ONLY valid JSON. No markdown wrapping.`;

const SYSTEM_PROMPTS: Record<string, string> = {
  brand: `You are a strategic AEO consultant helping a founder refine their brand identity profile.

Only update fields related to brand identity: brand_name, category_name, brand_pov, use_cases, differentiators.

You MUST respond in this exact JSON format:
{
  "reply": "Your conversational explanation here (1-3 sentences)",
  "updatedField": "brand_name" | "category_name" | "brand_pov" | "use_cases" | "differentiators" | null,
  "updatedValue": <the complete new value for that field, or null if no update>
}

${BASE_RULES}`,

  battlegrounds: `You are a strategic AEO consultant helping a founder define their strategic battlegrounds — the competitive contexts where their brand should win AI narrative.

Only update the strategic_battlegrounds field.

You MUST respond in this exact JSON format:
{
  "reply": "Your conversational explanation here (1-3 sentences)",
  "updatedField": "strategic_battlegrounds" | null,
  "updatedValue": <the complete updated array of battleground strings, or null if no update>
}

${BASE_RULES}`,

  personas: `You are a strategic AEO consultant helping a founder refine their synthetic buyer personas.

Only update the personas field.

You MUST respond in this exact JSON format:
{
  "reply": "Your conversational explanation here (1-3 sentences)",
  "updatedField": "personas" | null,
  "updatedValue": <the complete updated personas array, or null if no update>
}

${BASE_RULES}`,
};

// Fallback for callers that don't send a section
const DEFAULT_SYSTEM_PROMPT = `You are a strategic AEO consultant helping a founder refine their brand's Synthetic Buyer profile.

You MUST respond in this exact JSON format:
{
  "reply": "Your conversational explanation here (1-3 sentences)",
  "updatedField": "use_cases" | "personas" | "brand_pov" | "category_name" | "differentiators" | "strategic_battlegrounds" | null,
  "updatedValue": <the complete new value for that field, or null if no update>
}

${BASE_RULES}`;

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { clientId, message, currentProfile, section } = await request.json() as {
      clientId: string;
      message: string;
      currentProfile: { brandDNA: BrandDNA; personas: unknown[] };
      section?: "brand" | "battlegrounds" | "personas";
    };

    if (!clientId || !message) {
      return NextResponse.json({ error: "clientId and message required" }, { status: 400 });
    }

    // Verify client ownership via RLS
    const { data: client } = await supabase
      .from("clients")
      .select("id")
      .eq("id", clientId)
      .single();
    if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

    const systemPrompt = (section && SYSTEM_PROMPTS[section]) ?? DEFAULT_SYSTEM_PROMPT;

    const contextPrompt = `Current profile:
${JSON.stringify(currentProfile, null, 2)}

User message: ${message}`;

    const raw = await callHaiku(contextPrompt, systemPrompt);
    const cleaned = raw.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();

    let response: RefineResponse;
    try {
      response = JSON.parse(cleaned);
    } catch {
      // Claude didn't return valid JSON — return as plain reply with no update
      response = { reply: raw.slice(0, 500), updatedField: null, updatedValue: null };
    }

    // Apply the update to Supabase if a field was changed
    if (response.updatedField && response.updatedValue !== null) {
      const svc = createServiceClient();
      if (response.updatedField === "personas") {
        // Replace personas rows
        await svc.from("personas").delete().eq("client_id", clientId);
        const personas = response.updatedValue as Record<string, unknown>[];
        if (Array.isArray(personas)) {
          await svc
            .from("personas")
            .insert(personas.map((p) => ({ ...p, client_id: clientId })));
        }
      } else {
        // Update brand_dna field
        const { data: existing } = await supabase
          .from("clients")
          .select("brand_dna")
          .eq("id", clientId)
          .single();

        if (existing?.brand_dna) {
          const updatedDNA = {
            ...existing.brand_dna,
            [response.updatedField]: response.updatedValue,
          };
          await svc
            .from("clients")
            .update({ brand_dna: updatedDNA })
            .eq("id", clientId);
        }
      }
    }

    return NextResponse.json(response);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
