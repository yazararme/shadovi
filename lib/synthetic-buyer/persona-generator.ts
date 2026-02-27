import { z } from "zod";
import { callHaiku } from "@/lib/llm/anthropic";
import type { ClientContext, Persona } from "@/types";

const PersonaSchema = z.object({
  name: z.string(),
  role: z.string(),
  pain_points: z.array(z.string()),
  buying_triggers: z.array(z.string()),
  internal_monologue: z.string(),
  skepticisms: z.array(z.string()),
  priority: z.number().int().min(1).max(5),
});

const PersonaArraySchema = z.array(PersonaSchema);

export async function generatePersonas(
  ctx: ClientContext
): Promise<Omit<Persona, "id" | "client_id" | "created_at">[]> {
  const { brandDNA } = ctx;

  const prompt = `You are building a Synthetic Buyer model for an AEO platform. Your job is to construct
precise buyer personas based on this company's profile — not generic marketing personas,
but psychologically accurate profiles of the specific people who evaluate and buy this product.

For each persona, identify:
- name: a memorable archetype name (e.g. "Skeptical CFO", "Overloaded DevOps Lead")
- role: their job title and day-to-day reality (2 sentences)
- pain_points: 3-5 specific frictions that drive them to research solutions
- buying_triggers: 2-4 specific events or pain thresholds that make them start researching NOW
- internal_monologue: how they would phrase their problem to a chatbot (messy, conversational,
  specific — not formal search queries; 2-4 sentences as if typing to ChatGPT)
- skepticisms: 2-3 things that would make them NOT shortlist this brand
- priority: 1=most likely to use a chatbot for research, 5=least likely

Company profile:
- Brand: ${brandDNA.brand_name}
- Category: ${brandDNA.category_name}
- What it does: ${brandDNA.product_description}
- Use cases: ${brandDNA.use_cases.join(", ")}
- Industries: ${brandDNA.industries_served.join(", ")}
- Differentiators: ${brandDNA.differentiators.join(", ")}

Generate 3-5 personas as a JSON array. Make them distinct. Prioritize buyers most likely
to use a chatbot for research rather than Google. Persona 1 should be the highest-priority buyer.

Return ONLY a valid JSON array. No markdown, no explanation.`;

  const raw = await callHaiku(prompt);
  const cleaned = raw.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Failed to parse personas JSON: ${cleaned.slice(0, 200)}`);
  }

  const result = PersonaArraySchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Persona validation failed: ${result.error.message}`);
  }

  return result.data;
}
