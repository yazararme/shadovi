import { z } from "zod";
import { callHaiku } from "@/lib/llm/anthropic";
import type { BrandDNA } from "@/types";

const BrandDNASchema = z.object({
  brand_name: z.string(),
  category_name: z.string(),
  brand_pov: z.string(),
  product_description: z.string(),
  key_products: z.array(z.object({ name: z.string(), description: z.string() })),
  industries_served: z.array(z.string()),
  use_cases: z.array(z.string()),
  likely_competitors: z.array(z.string()),
  differentiators: z.array(z.string()),
  strategic_battlegrounds: z.array(z.string()),
});

const EXTRACTION_PROMPT = `You are a brand strategist performing a strategic extraction for an AEO platform.

The content below may contain multiple labelled sections: a PRIMARY WEBSITE and optionally SUPPLEMENTARY sources (sub-brands, product pages, docs, uploaded files).

IMPORTANT: Use the PRIMARY WEBSITE section as the canonical source for brand_name, brand_pov, and product_description. Supplementary sources may be used to enrich use_cases, industries_served, key_products, and differentiators — but must never override the primary brand identity.

Analyze this website content and extract the following as structured JSON:

{
  "brand_name": "company name",
  "category_name": "how customers describe this product category",
  "brand_pov": "the unique point of view or philosophy this brand operates from (1-2 sentences)",
  "product_description": "what the product does and for whom (2-3 sentences, plain language)",
  "key_products": [{"name": "", "description": ""}],
  "industries_served": [],
  "use_cases": [],
  "likely_competitors": [],
  "differentiators": [],
  "strategic_battlegrounds": []
}

Field guidance:
- use_cases: specific problems a buyer would articulate, not product features
- industries_served: specific verticals, not generic ("B2B SaaS" is too broad)
- likely_competitors: brand names only, infer from positioning. IMPORTANT: prioritise direct competitors of similar scale and market position — brands the client is realistically winning or losing deals against. Exclude dominant global category leaders (e.g. Unilever, P&G, Wise, Stripe) unless the website explicitly positions against them. Aim for 4-6 competitors that a buyer would genuinely consider as alternatives to this specific brand.
- differentiators: what makes this brand distinct from category alternatives
- strategic_battlegrounds: 3-5 specific competitive contexts where this brand should be winning
  the AI narrative (e.g. "compliance-first vs flexibility tradeoff", "SMB pricing vs enterprise",
  "ease of onboarding vs feature depth"). These anchor query generation.

Be specific. Avoid marketing language. If you cannot determine something with confidence,
return an empty array or null for that field.

Return ONLY valid JSON. No markdown, no explanation.

Website content:
`;

export async function extractBrandDNA(scrapedContent: string, primaryUrl?: string): Promise<BrandDNA> {
  // Prepend a hard anchor so the LLM can't misidentify the brand even if supplementary
  // content (e.g. a sub-brand like QuantumBlack) is richer than the primary page.
  const domainHint = primaryUrl
    ? `The brand being analysed is the owner of this primary URL: ${primaryUrl}\nSet brand_name to the company that owns this domain, not any subsidiary or partner mentioned in the content.\n\n`
    : "";
  const raw = await callHaiku(domainHint + EXTRACTION_PROMPT + scrapedContent);

  // Strip any markdown code fences Claude might wrap the JSON in
  const cleaned = raw.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Failed to parse brand DNA JSON: ${cleaned.slice(0, 200)}`);
  }

  const result = BrandDNASchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Brand DNA validation failed: ${result.error.message}`);
  }

  return result.data;
}
