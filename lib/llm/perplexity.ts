const PERPLEXITY_API_URL = "https://api.perplexity.ai/chat/completions";
const MODEL = "sonar";
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

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
        throw new Error("Perplexity API key invalid or missing");
      } else {
        throw err;
      }
    }
  }
  throw lastError ?? new Error("Max retries exceeded");
}

// Shared fetch implementation — returns text + the citations array Perplexity
// includes as a top-level field alongside message content.
async function fetchPerplexityResponse(
  prompt: string,
  systemPrompt?: string
): Promise<{ text: string; citations: string[] }> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) throw new Error("Perplexity API key missing");

  const messages: { role: string; content: string }[] = [];
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  messages.push({ role: "user", content: prompt });

  // AbortController ensures the TCP connection is actually torn down when the
  // timeout fires — without this, fetch hangs indefinitely and the outer
  // withTimeout in runner.ts just abandons the promise, leaking the connection.
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), 140_000);

  let response: Response;
  try {
    response = await fetch(PERPLEXITY_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        max_tokens: 2048,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(abortTimer);
  }

  if (response.status === 429) {
    const err = new Error("Rate limited") as Error & { status: number };
    err.status = 429;
    throw err;
  }
  if (response.status === 401) {
    throw new Error("Perplexity API key invalid or missing");
  }
  if (!response.ok) {
    throw new Error(`Perplexity API error: ${response.status}`);
  }

  const data = await response.json();
  return {
    text: data.choices?.[0]?.message?.content ?? "",
    citations: Array.isArray(data.citations) ? (data.citations as string[]) : [],
  };
}

export async function callPerplexity(
  prompt: string,
  systemPrompt?: string
): Promise<string> {
  return withRetry(async () => {
    const { text } = await fetchPerplexityResponse(prompt, systemPrompt);
    return text;
  });
}

// Returns both the response text and Perplexity's native citations array.
// Used by runner.ts so cited_sources can be populated from the authoritative
// citations field rather than relying on regex extraction from response text.
export async function callPerplexityFull(
  prompt: string,
  systemPrompt?: string
): Promise<{ text: string; citations: string[] }> {
  return withRetry(async () => fetchPerplexityResponse(prompt, systemPrompt));
}
