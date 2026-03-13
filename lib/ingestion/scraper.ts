import FirecrawlApp from "@mendable/firecrawl-js";

export async function scrapeUrl(url: string): Promise<string> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY not set");

  const app = new FirecrawlApp({ apiKey });

  let result: Awaited<ReturnType<typeof app.scrapeUrl>>;
  try {
    result = await app.scrapeUrl(url, {
      pageOptions: {
        onlyMainContent: true,
      },
    } as Parameters<typeof app.scrapeUrl>[1]);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Surface 402 (quota exhausted), 403 (blocked), and 408 (timeout) so callers can offer manual fallback
    if (msg.includes("402")) throw new Error(`402: ${msg}`);
    if (msg.includes("403") || msg.toLowerCase().includes("forbidden")) throw new Error(`403: ${msg}`);
    if (msg.includes("408") || msg.toLowerCase().includes("timeout")) throw new Error(`408: ${msg}`);
    throw err;
  }

  if (!result.success) {
    const errorMsg = (result as { error?: string }).error ?? "Scrape failed";
    // Surface 403 explicitly so the Discover page can show the manual fallback
    if (errorMsg.includes("403") || errorMsg.toLowerCase().includes("forbidden")) {
      throw new Error(`403: ${errorMsg}`);
    }
    throw new Error(errorMsg);
  }

  const content = result.data?.markdown ?? result.data?.content ?? "";
  if (!content.trim()) {
    throw new Error("Scraped content is empty");
  }

  // Truncate to ~40k chars to stay within Claude context
  return content.slice(0, 40000);
}
