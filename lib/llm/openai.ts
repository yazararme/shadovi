import OpenAI from "openai";

const MODEL = "gpt-4o";
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

function getClient() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string };
      if (e.status === 429) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
        lastError = new Error(e.message ?? "Rate limited");
      } else if (e.status === 401) {
        throw new Error("OpenAI API key invalid or missing");
      } else {
        throw err;
      }
    }
  }
  throw lastError ?? new Error("Max retries exceeded");
}

export async function callGPT4o(
  prompt: string,
  systemPrompt?: string
): Promise<string> {
  return withRetry(async () => {
    const client = getClient();
    const messages: OpenAI.ChatCompletionMessageParam[] = [];
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }
    messages.push({ role: "user", content: prompt });

    const completion = await client.chat.completions.create({
      model: MODEL,
      messages,
      max_tokens: 2048,
    });

    return completion.choices[0]?.message?.content ?? "";
  });
}
