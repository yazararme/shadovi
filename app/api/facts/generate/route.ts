import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { callHaiku } from "@/lib/llm/anthropic";
import type { BrandDNA, BrandFactCategory } from "@/types";

// Auth: session check → service write

export const maxDuration = 60;

const PROMPT = (dna: BrandDNA, rawScrape?: string) => `You are a brand strategist building a fact verification set for an AEO (Answer Engine Optimization) platform.

Given the following brand context, generate a JSON array of brand facts to be used for testing how well AI models know this brand.

Structured brand summary:
- Name: ${dna.brand_name}
- Category: ${dna.category_name}
- Description: ${dna.product_description}
- Key products: ${dna.key_products.map((p) => p.name).join(", ")}
- Differentiators: ${dna.differentiators.join(", ")}
- Industries: ${dna.industries_served.join(", ")}
- Use cases: ${dna.use_cases.join(", ")}
${rawScrape ? `\nRaw source content (website copy, docs, uploaded files — use this for specific claims like exact pricing, feature names, trial terms):\nIMPORTANT: This content may include supplementary sources (sub-brands, partner sites). Only generate claims that apply to ${dna.brand_name} itself — ignore product details from any other brand mentioned.\n${rawScrape}` : ""}

Generate exactly 12 facts in this JSON array format:
[
  { "claim": "specific verifiable claim", "category": "feature|market|pricing|messaging", "is_true": true }
]

Rules:
- 4 feature facts (is_true: true) — specific product capabilities, integrations, or technical attributes
- 2 market facts (is_true: true) — audience, reach, or competitive positioning claims
- 2 pricing facts (is_true: true) — pricing model, trial, tiers, or cost positioning
- 2 messaging facts (is_true: true) — brand mission, certifications, awards, or named campaigns
- 2 false claim tests (is_true: false) — plausible-sounding things this brand does NOT claim; use competitor features or adjacent-category capabilities that sound believable
- Claims must be specific and testable, not marketing fluff ("UserGuiding lets you create product tours without writing code" not "UserGuiding helps with onboarding")
- False claims must be plausible — something an AI could realistically confuse or hallucinate
- Return ONLY valid JSON array. No markdown, no explanation.`;

interface RawFact {
  claim: string;
  category: BrandFactCategory;
  is_true: boolean;
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { clientId } = await request.json() as { clientId: string };
    if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .select("brand_dna, raw_scrape")
      .eq("id", clientId)
      .single();

    if (clientErr || !client?.brand_dna) {
      return NextResponse.json({ error: "Client or brand DNA not found" }, { status: 404 });
    }

    // Cap raw_scrape at 15k chars — enough detail for specific facts without bloating Haiku's context
    const rawScrape = client.raw_scrape
      ? (client.raw_scrape as string).slice(0, 15000)
      : undefined;

    const raw = await callHaiku(PROMPT(client.brand_dna as BrandDNA, rawScrape));
    const cleaned = raw.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();

    let facts: RawFact[];
    try {
      facts = JSON.parse(cleaned);
    } catch {
      throw new Error(`Failed to parse facts JSON: ${cleaned.slice(0, 200)}`);
    }

    if (!Array.isArray(facts)) throw new Error("Expected JSON array");

    // Validate and sanitise each fact before inserting
    const VALID_CATEGORIES = new Set(["feature", "market", "pricing", "messaging"]);
    const sanitised = facts
      .filter((f) => f.claim?.trim() && VALID_CATEGORIES.has(f.category))
      .map((f) => ({
        client_id: clientId,
        claim: f.claim.trim(),
        category: f.category,
        is_true: Boolean(f.is_true),
      }));

    if (sanitised.length === 0) throw new Error("No valid facts generated");

    const svc = createServiceClient();
    const { data: inserted, error: insertErr } = await svc
      .from("brand_facts")
      .insert(sanitised)
      .select();

    if (insertErr) throw new Error(`DB insert error: ${insertErr.message}`);

    return NextResponse.json({ facts: inserted });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
