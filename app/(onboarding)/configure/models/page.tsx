"use client";

import { Suspense } from "react";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { LLMModel } from "@/types";
import { toast } from "sonner";

const MODELS: { id: LLMModel; name: string; description: string }[] = [
  {
    id: "gpt-4o",
    name: "GPT-4o",
    description: "OpenAI's most capable model. High signal on enterprise software recommendations.",
  },
  {
    id: "perplexity",
    name: "Perplexity",
    description: "Real-time web-sourced answers, prioritizes cited sources. Critical for understanding third-party citations.",
  },
  {
    id: "claude-sonnet-4-6",
    name: "Claude",
    description: "Strong on nuanced brand comparisons and technical B2B recommendations.",
  },
  {
    id: "gemini",
    name: "Gemini",
    description: "Google's model. High value for brands where Google Search and AI overlap.",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    description: "Chinese frontier model with strong technical reasoning. Growing share in developer and engineering audiences.",
  },
];

const FREQUENCIES = [
  { id: "daily", label: "Daily", desc: "Maximum tracking frequency." },
  { id: "weekly", label: "Weekly", desc: "Recommended for most teams." },
  { id: "monthly", label: "Monthly", desc: "Light footprint for early stage." },
] as const;

function ModelsPageInner() {
  const searchParams = useSearchParams();
  const clientId = searchParams.get("client");
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedModels, setSelectedModels] = useState<LLMModel[]>(["gpt-4o", "perplexity"]);
  const [frequency, setFrequency] = useState<"daily" | "weekly" | "monthly">("weekly");

  useEffect(() => {
    if (!clientId) { router.push("/discover"); return; }
    loadSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  async function loadSettings() {
    setLoading(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("clients")
      .select("selected_models, tracking_frequency")
      .eq("id", clientId)
      .single();

    if (data?.selected_models?.length) setSelectedModels(data.selected_models);
    if (data?.tracking_frequency) setFrequency(data.tracking_frequency);
    setLoading(false);
  }

  function toggleModel(model: LLMModel) {
    setSelectedModels((prev) =>
      prev.includes(model) ? prev.filter((m) => m !== model) : [...prev, model]
    );
  }

  async function handleContinue() {
    if (selectedModels.length === 0) {
      toast.error("Select at least one model to track");
      return;
    }
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("clients")
      .update({ selected_models: selectedModels, tracking_frequency: frequency })
      .eq("id", clientId);
    setSaving(false);
    if (error) {
      toast.error("Failed to save settings");
      return;
    }
    router.push(`/configure/facts?client=${clientId}`);
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-2 gap-3">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-serif text-[32px] font-semibold text-[#0D0437] tracking-tight leading-tight">
            Configure tracking
          </h1>
          <p className="text-[13px] text-[#6B7280] mt-1">
            Choose which AI models to monitor and how often to run your queries.
          </p>
        </div>
        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={() => router.push(`/competitors?client=${clientId}`)}
            className="text-[13px] text-[#6B7280] hover:text-[#0D0437] transition-colors"
          >
            ← Go Back
          </button>
          <Button
            onClick={handleContinue}
            disabled={saving}
            className="bg-[#0D0437] hover:bg-[#1a1150] text-white"
          >
            {saving ? "Saving…" : "Continue →"}
          </Button>
        </div>
      </div>

      {/* AI Models */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <span className="text-[9px] font-bold tracking-[2.5px] uppercase text-[#6B7280] whitespace-nowrap">
            AI Models
          </span>
          <div className="flex-1 h-px bg-[#E2E8F0]" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          {MODELS.map((model) => {
            const selected = selectedModels.includes(model.id);
            return (
              <button
                key={model.id}
                type="button"
                onClick={() => toggleModel(model.id)}
                className={`text-left border rounded-lg p-4 transition-colors ${
                  selected
                    ? "border-[#0D0437] bg-[rgba(13,4,55,0.03)]"
                    : "border-[#E2E8F0] bg-white hover:border-[#0D0437]/30"
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-medium text-[#0D0437]">{model.name}</span>
                  <div
                    className={`h-4 w-4 rounded-full border-2 transition-colors ${
                      selected ? "bg-[#0D0437] border-[#0D0437]" : "border-[#CBD5E1]"
                    }`}
                  />
                </div>
                <p className="text-xs text-[#6B7280] leading-relaxed">{model.description}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Tracking Frequency */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <span className="text-[9px] font-bold tracking-[2.5px] uppercase text-[#6B7280] whitespace-nowrap">
            Tracking Frequency
          </span>
          <div className="flex-1 h-px bg-[#E2E8F0]" />
        </div>
        <div className="flex gap-3">
          {FREQUENCIES.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFrequency(f.id)}
              className={`flex-1 text-left border rounded-lg p-4 transition-colors ${
                frequency === f.id
                  ? "border-[#0D0437] bg-[rgba(13,4,55,0.03)]"
                  : "border-[#E2E8F0] bg-white hover:border-[#0D0437]/30"
              }`}
            >
              <p className="text-sm font-medium text-[#0D0437]">{f.label}</p>
              <p className="text-xs text-[#6B7280] mt-0.5">{f.desc}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function ModelsPage() {
  return (
    <Suspense>
      <ModelsPageInner />
    </Suspense>
  );
}
