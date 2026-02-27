"use client";

import { Suspense, useState, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, X, Upload, FileText } from "lucide-react";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_SUPPLEMENTARY = 2;
const ACCEPTED_FILE_TYPES = ".txt,.md,.pdf";

function DiscoverPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const existingClientId = searchParams.get("client");

  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Additional context state
  const [supplementaryUrls, setSupplementaryUrls] = useState<string[]>([""]);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileBase64, setFileBase64] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileSelect(file: File) {
    if (file.size > MAX_FILE_SIZE) {
      setError("File too large — max 5MB.");
      return;
    }
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    const reader = new FileReader();
    if (isPdf) {
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        setFileBase64(dataUrl.split(",")[1]);
        setFileContent(null);
        setUploadedFile(file);
        setError(null);
      };
      reader.onerror = () => setError("Failed to read file.");
      reader.readAsDataURL(file);
    } else {
      reader.onload = (e) => {
        setFileContent(e.target?.result as string);
        setFileBase64(null);
        setUploadedFile(file);
        setError(null);
      };
      reader.onerror = () => setError("Failed to read file.");
      reader.readAsText(file);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  }

  function addSupplementaryUrl() {
    if (supplementaryUrls.length < MAX_SUPPLEMENTARY) {
      setSupplementaryUrls([...supplementaryUrls, ""]);
    }
  }

  function updateSupplementaryUrl(index: number, value: string) {
    const updated = [...supplementaryUrls];
    updated[index] = value;
    setSupplementaryUrls(updated);
  }

  function removeSupplementaryUrl(index: number) {
    setSupplementaryUrls(supplementaryUrls.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setError(null);
    setLoading(true);
    try {
      const validSupplementaryUrls = supplementaryUrls.filter((u) => u.trim());
      const response = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          supplementaryUrls: validSupplementaryUrls.length > 0 ? validSupplementaryUrls : undefined,
          fileContent: fileContent || undefined,
          fileBase64: fileBase64 || undefined,
          clientId: existingClientId ?? undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }
      // Fire background pre-generation while user reads/edits brand DNA on /refine.
      // All three pages check DB first and skip generation if data already exists,
      // so these calls are safe to fire even if the page later re-triggers generation.
      const bgClientId = data.clientId as string;
      fetch("/api/personas/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: bgClientId }),
      }).catch(() => {}); // swallow — page generates on demand as fallback

      fetch("/api/facts/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: bgClientId }),
      }).catch(() => {});

      const likelyCompetitors = (data.brandDNA?.likely_competitors ?? []) as string[];
      if (likelyCompetitors.length > 0) {
        fetch("/api/competitors/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId: bgClientId,
            competitors: likelyCompetitors.map((name: string) => ({ name })),
          }),
        }).catch(() => {});
      }

      router.push(`/refine?client=${bgClientId}`);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      {/* Page header */}
      <div className="text-center mb-10">
        <h1 className="font-serif text-[32px] font-semibold text-[#0D0437] tracking-tight leading-tight">
          What does AI say about your brand?
        </h1>
        <p className="text-[14px] text-[#6B7280] mt-2">
          Add your website and any supporting context — see how ChatGPT, Claude,
          Perplexity, Gemini, and DeepSeek describe, rank, and compare you.
        </p>
      </div>

      {/* Form card */}
      <div className="bg-white border border-[#E2E8F0] rounded-lg p-6 space-y-5">
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Primary URL */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-[1.5px] text-[#6B7280]">
              Your main website
            </label>
            <Input
              type="url"
              placeholder="https://yourcompany.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="h-11 text-base border-[#E2E8F0] focus:border-[#0D0437] focus:ring-[#0D0437]"
              disabled={loading}
            />
          </div>

          {/* Section divider */}
          <div className="flex items-center gap-3">
            <span className="text-[9px] font-bold tracking-[2.5px] uppercase text-[#6B7280] whitespace-nowrap">
              Add more context
            </span>
            <span className="text-[9px] font-normal text-[#9CA3AF] whitespace-nowrap normal-case tracking-normal">
              optional
            </span>
            <div className="flex-1 h-px bg-[#E2E8F0]" />
          </div>

          {/* Supplementary URLs */}
          <div className="space-y-2">
            <p className="text-[12px] text-[#6B7280]">
              Supporting pages — pricing, docs, about, a blog post, etc.
            </p>
            {supplementaryUrls.map((u, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  type="url"
                  placeholder="https://yourcompany.com/pricing"
                  value={u}
                  onChange={(e) => updateSupplementaryUrl(i, e.target.value)}
                  className="h-9 text-sm border-[#E2E8F0]"
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => removeSupplementaryUrl(i)}
                  className="text-[#9CA3AF] hover:text-[#FF4B6E] transition-colors flex-shrink-0"
                  aria-label="Remove URL"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
            {supplementaryUrls.length < MAX_SUPPLEMENTARY && (
              <button
                type="button"
                onClick={addSupplementaryUrl}
                className="flex items-center gap-1.5 text-[12px] text-[#6B7280] hover:text-[#0D0437] transition-colors"
                disabled={loading}
              >
                <Plus className="h-3.5 w-3.5" />
                Add another URL
                <span className="text-[#9CA3AF]">
                  ({MAX_SUPPLEMENTARY - supplementaryUrls.length} remaining)
                </span>
              </button>
            )}
          </div>

          {/* File divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-[#E2E8F0]" />
            <span className="text-[11px] text-[#9CA3AF]">or attach a file</span>
            <div className="flex-1 h-px bg-[#E2E8F0]" />
          </div>

          {/* File upload zone */}
          {!uploadedFile ? (
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-5 cursor-pointer transition-colors ${
                isDragOver
                  ? "border-[#0D0437] bg-[rgba(13,4,55,0.03)]"
                  : "border-[#E2E8F0] hover:border-[#0D0437]/40 hover:bg-[#F4F6F9]"
              }`}
            >
              <Upload className="h-5 w-5 text-[#9CA3AF]" />
              <p className="text-sm text-center">
                <span className="font-medium text-[#0D0437]">Drop a file here</span>
                <span className="text-[#6B7280]"> or click to browse</span>
              </p>
              <p className="text-[11px] text-[#9CA3AF]">.txt, .md, .pdf · max 5MB</p>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_FILE_TYPES}
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }}
                disabled={loading}
              />
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-lg border border-[#E2E8F0] bg-[#F4F6F9] px-3 py-2.5">
              <FileText className="h-4 w-4 text-[#6B7280] flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium text-[#0D0437] truncate">{uploadedFile.name}</p>
                <p className="text-[11px] text-[#6B7280]">{(uploadedFile.size / 1024).toFixed(0)} KB</p>
              </div>
              <button
                type="button"
                onClick={() => { setUploadedFile(null); setFileContent(null); setFileBase64(null); }}
                className="text-[#9CA3AF] hover:text-[#FF4B6E] transition-colors flex-shrink-0"
                aria-label="Remove file"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {error && (
            <p className="text-[13px] font-medium text-[#FF4B6E]">{error}</p>
          )}

          {/* CTA — full-width at bottom so it clearly submits ALL inputs above.
              Uses the same grad-bar palette as the InsightMetric bars for brand consistency. */}
          <button
            type="submit"
            disabled={loading || !url.trim()}
            className="w-full h-12 rounded-md text-[15px] font-semibold text-white mt-2 transition-opacity disabled:opacity-40 grad-bar hover:opacity-90"
          >
            {loading ? "Analysing…" : "Analyse my AI presence →"}
          </button>
        </form>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="mt-8 space-y-4">
          <p className="text-[13px] text-[#6B7280] text-center">
            Analysing your AI presence across ChatGPT, Claude, Perplexity, Gemini, and DeepSeek… this takes 30–60 seconds.
          </p>
          <div className="grid grid-cols-2 gap-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="border border-[#E2E8F0] rounded-lg bg-white p-4 space-y-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-3/4" />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function DiscoverPage() {
  return (
    <Suspense>
      <DiscoverPageInner />
    </Suspense>
  );
}
