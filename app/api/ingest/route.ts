import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { scrapeUrl } from "@/lib/ingestion/scraper";
import { extractBrandDNA } from "@/lib/ingestion/extractor";

// Require internal lib directly to bypass the test-file read in pdf-parse's index.js
// (a known v1 issue where the top-level entry reads a bundled PDF at import time)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse/lib/pdf-parse") as (buf: Buffer) => Promise<{ text: string }>;

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { url, rawContent, supplementaryUrls, fileContent, fileBase64, clientId } = body as {
      url?: string;
      rawContent?: string;
      supplementaryUrls?: string[];
      fileContent?: string;  // plain text files (.txt, .md)
      fileBase64?: string;   // PDF sent as base64 for server-side parsing
      clientId?: string;
    };

    if (!url && !rawContent) {
      return NextResponse.json(
        { error: "Provide either a URL or rawContent" },
        { status: 400 }
      );
    }

    // Get primary content — either scrape the URL or use provided raw content
    let primaryContent: string;
    if (rawContent && rawContent.trim()) {
      primaryContent = rawContent.slice(0, 40000);
    } else {
      if (!url) {
        return NextResponse.json({ error: "URL is required" }, { status: 400 });
      }
      try {
        new URL(url);
      } catch {
        return NextResponse.json({ error: "Invalid URL format" }, { status: 400 });
      }
      primaryContent = await scrapeUrl(url);
    }

    // Scrape supplementary URLs in parallel. The UI caps input at 2 supplementary URLs,
    // so we stay well within Firecrawl's RPM limits without needing the old 1.5s delay.
    const supplementaryContents: { url: string; content: string }[] = [];
    if (supplementaryUrls && supplementaryUrls.length > 0) {
      const validSupUrls = supplementaryUrls
        .slice(0, MAX_SUPPLEMENTARY_URLS)
        .filter((u) => { try { new URL(u); return true; } catch { return false; } });

      const results = await Promise.all(
        validSupUrls.map(async (u) => {
          try {
            const content = await scrapeUrl(u);
            return { url: u, content };
          } catch {
            // silently skip — one blocked/failed page shouldn't abort the whole run
            return null;
          }
        })
      );
      for (const r of results) {
        if (r) supplementaryContents.push(r);
      }
    }

    // Resolve file text — plain text files arrive as fileContent, PDFs as base64 for server-side parsing
    let resolvedFileContent: string | undefined;
    if (fileBase64) {
      try {
        const buffer = Buffer.from(fileBase64, "base64");
        const result = await pdfParse(buffer);
        const text = result.text?.trim();
        if (!text) {
          return NextResponse.json(
            { error: "Could not extract text from this PDF. Try a text-based PDF rather than a scanned image." },
            { status: 400 }
          );
        }
        resolvedFileContent = text;
      } catch {
        return NextResponse.json(
          { error: "Could not extract text from this PDF. Try a text-based PDF rather than a scanned image." },
          { status: 400 }
        );
      }
    } else if (fileContent?.trim()) {
      resolvedFileContent = fileContent;
    }

    // Combine all content with source labels so the LLM understands provenance.
    // Supplementary and file sources are capped to keep total well within Claude's context
    // without diluting the primary brand signal.
    const contentParts: string[] = [];
    contentParts.push(`--- PRIMARY WEBSITE (${url ?? "manual"}) ---\n${primaryContent}`);
    for (const s of supplementaryContents) {
      // Hostname + pathname so Claude sees "docs.example.com/features" as a provenance signal —
      // a docs subdomain implies product depth, a pricing path implies market positioning, etc.
      const parsed = new URL(s.url);
      const label = parsed.hostname + (parsed.pathname !== "/" ? parsed.pathname : "");
      contentParts.push(`--- SUPPLEMENTARY: ${label} ---\n${s.content.slice(0, 10000)}`);
    }
    if (resolvedFileContent) {
      // File gets more room than scraped URLs — user deliberately assembled it, so it's higher-signal
      contentParts.push(`--- UPLOADED FILE ---\n${resolvedFileContent.slice(0, 20000)}`);
    }

    // Hard cap at 60k chars total to stay within a single Claude context window
    const combinedContent = contentParts.join("\n\n").slice(0, 60000);

    // Extract brand DNA via Claude — pass primary URL so extractor can anchor brand_name
    // to the correct entity even when supplementary content (sub-brands, partner sites) is richer.
    const brandDNA = await extractBrandDNA(combinedContent, url ?? undefined);

    // Service client bypasses RLS — safe because user ownership is confirmed above.
    // Session-scoped client's JWT can go stale during the long scrape+extraction,
    // causing auth.uid() mismatch by the time the DB write runs.
    const svc = createServiceClient();

    // If clientId supplied (user navigated back), update the existing record
    let savedClientId: string;
    if (clientId) {
      const { error: dbError } = await svc
        .from("clients")
        .update({
          url: url ?? "manual",
          brand_name: brandDNA.brand_name,
          brand_dna: brandDNA,
          use_cases: brandDNA.use_cases,
          industries: brandDNA.industries_served,
          key_products: brandDNA.key_products,
          raw_scrape: combinedContent,
        })
        .eq("id", clientId)
        .eq("user_id", user.id); // ownership double-check

      if (dbError) throw new Error(`Database error: ${dbError.message}`);
      savedClientId = clientId;
    } else {
      // New client
      const { data: client, error: dbError } = await svc
        .from("clients")
        .insert({
          user_id: user.id,
          url: url ?? "manual",
          brand_name: brandDNA.brand_name,
          brand_dna: brandDNA,
          use_cases: brandDNA.use_cases,
          industries: brandDNA.industries_served,
          key_products: brandDNA.key_products,
          raw_scrape: combinedContent,
          status: "onboarding",
        })
        .select("id")
        .single();

      if (dbError) throw new Error(`Database error: ${dbError.message}`);
      savedClientId = client.id;
    }

    return NextResponse.json({ clientId: savedClientId, brandDNA });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = message.startsWith("403") ? 403 : message.startsWith("402") ? 402 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

// Cap how many supplementary URLs we'll scrape per request to limit Firecrawl spend
const MAX_SUPPLEMENTARY_URLS = 3;
