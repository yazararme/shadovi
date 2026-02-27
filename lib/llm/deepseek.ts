// DeepSeek uses an OpenAI-compatible REST API — same shape as OpenAI's chat completions.
// Model: deepseek-chat (DeepSeek-V3, their flagship general-purpose model).
const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";
const MODEL = "deepseek-chat";
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
        throw new Error("DeepSeek API key invalid or missing");
      } else {
        throw err;
      }
    }
  }
  throw lastError ?? new Error("Max retries exceeded");
}

export async function callDeepSeek(prompt: string): Promise<string> {
  return withRetry(async () => {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) throw new Error("DeepSeek API key missing");

    // AbortController ensures the TCP connection is actually torn down when the
    // timeout fires — without this, fetch hangs indefinitely and the outer
    // withTimeout in runner.ts just abandons the promise, leaking the connection.
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), 85_000);

    let response: Response;
    try {
      response = await fetch(DEEPSEEK_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: "user", content: prompt }],
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
      throw new Error("DeepSeek API key invalid or missing");
    }
    if (!response.ok) {
      throw new Error(`DeepSeek API error: ${response.status}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content ?? "";
  });
}
