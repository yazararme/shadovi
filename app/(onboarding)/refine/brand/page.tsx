"use client";

import { Suspense } from "react";
import { useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BrandDNACard } from "@/components/onboarding/BrandDNACard";
import { RefinementChat } from "@/components/onboarding/RefinementChat";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { BrandDNA, RefineResponse } from "@/types";
import { toast } from "sonner";

function BrandPageInner() {
  const searchParams = useSearchParams();
  const clientId = searchParams.get("client");
  const router = useRouter();

  const [brandDNA, setBrandDNA] = useState<BrandDNA | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!clientId) { router.push("/discover"); return; }
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  async function loadData() {
    setLoading(true);
    const supabase = createClient();
    const { data: client } = await supabase
      .from("clients")
      .select("brand_dna")
      .eq("id", clientId)
      .single();

    if (!client?.brand_dna) { router.push("/discover"); return; }
    setBrandDNA(client.brand_dna);
    setLoading(false);
  }

  const saveBrandDNA = useCallback(
    async (updated: BrandDNA) => {
      if (!clientId) return;
      setSaving(true);
      const supabase = createClient();
      const { error } = await supabase
        .from("clients")
        .update({ brand_dna: updated, brand_name: updated.brand_name })
        .eq("id", clientId);
      setSaving(false);
      if (error) toast.error("Failed to save: " + error.message);
    },
    [clientId]
  );

  function handleBrandDNAChange(updated: BrandDNA) {
    setBrandDNA(updated);
    saveBrandDNA(updated);
  }

  function handleFieldUpdate(field: RefineResponse["updatedField"], value: unknown) {
    if (!field || !brandDNA) return;
    setBrandDNA({ ...brandDNA, [field]: value } as BrandDNA);
  }

  function handleContinue() {
    router.push(`/refine/battlegrounds?client=${clientId}`);
  }

  if (loading) {
    return (
      <div className="grid grid-cols-[1fr_380px] gap-6">
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="border border-[#E2E8F0] rounded-lg bg-white p-4 space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-3/4" />
            </div>
          ))}
        </div>
        <Skeleton className="h-96 rounded-lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-serif text-[32px] font-semibold text-[#0D0437] tracking-tight leading-tight">
            Brand Identity
          </h1>
          <p className="text-[13px] text-[#6B7280] mt-1">
            Correct your name, category, point of view, use cases, and differentiators.
          </p>
        </div>
        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={() => router.push("/discover")}
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

      <div className="grid grid-cols-[1fr_380px] gap-6 items-start">
        <div>
          {brandDNA && (
            <BrandDNACard brandDNA={brandDNA} onChange={handleBrandDNAChange} />
          )}
        </div>
        <div className="sticky top-6 h-[600px]">
          {brandDNA && (
            <RefinementChat
              clientId={clientId!}
              brandDNA={brandDNA}
              personas={[]}
              section="brand"
              onFieldUpdate={handleFieldUpdate}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default function BrandPage() {
  return (
    <Suspense>
      <BrandPageInner />
    </Suspense>
  );
}
