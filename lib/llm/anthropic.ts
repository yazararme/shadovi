import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-sonnet-4-6";
const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// Exponential backoff helper
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
        throw new Error("Anthropic API key invalid or missing");
      } else {
        throw err;
      }
    }
  }
  throw lastError ?? new Error("Max retries exceeded");
}

export async function callClaude(
  prompt: string,
  systemPrompt?: string
): Promise<string> {
  return withRetry(async () => {
    const client = getClient();
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: systemPrompt,
      messages: [{ role: "user", content: prompt }],
    });

    const block = message.content[0];
    if (block.type !== "text") throw new Error("Unexpected response type from Claude");
    return block.text;
  });
}

// Cost-efficient secondary scoring calls — use Haiku instead of Sonnet
export async function callHaiku(
  prompt: string,
  systemPrompt?: string
): Promise<string> {
  return withRetry(async () => {
    const client = getClient();
    const message = await client.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{ role: "user", content: prompt }],
    });

    const block = message.content[0];
    if (block.type !== "text") throw new Error("Unexpected response type from Haiku");
    return block.text;
  });
}

export async function* streamClaude(
  prompt: string,
  systemPrompt?: string
): AsyncGenerator<string> {
  const client = getClient();
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 2048,
    system: systemPrompt,
    messages: [{ role: "user", content: prompt }],
  });

  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      yield event.delta.text;
    }
  }
}
