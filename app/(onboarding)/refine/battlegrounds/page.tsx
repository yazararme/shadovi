"use client";

import { Suspense } from "react";
import { useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BattlegroundsCard } from "@/components/onboarding/BattlegroundsCard";
import { RefinementChat } from "@/components/onboarding/RefinementChat";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { BrandDNA, RefineResponse } from "@/types";
import { toast } from "sonner";

function BattlegroundsPageInner() {
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

  const saveBattlegrounds = useCallback(
    async (updated: string[]) => {
      if (!clientId || !brandDNA) return;
      setSaving(true);
      const supabase = createClient();
      const updatedDNA = { ...brandDNA, strategic_battlegrounds: updated };
      const { error } = await supabase
        .from("clients")
        .update({ brand_dna: updatedDNA })
        .eq("id", clientId);
      setSaving(false);
      if (error) toast.error("Failed to save: " + error.message);
      else setBrandDNA(updatedDNA);
    },
    [clientId, brandDNA]
  );

  function handleFieldUpdate(field: RefineResponse["updatedField"], value: unknown) {
    if (field === "strategic_battlegrounds" && Array.isArray(value) && brandDNA) {
      setBrandDNA({ ...brandDNA, strategic_battlegrounds: value as string[] });
    }
  }

  function handleContinue() {
    router.push(`/refine/personas?client=${clientId}`);
  }

  if (loading) {
    return (
      <div className="grid grid-cols-[1fr_380px] gap-6">
        <Skeleton className="h-64 rounded-lg" />
        <Skeleton className="h-96 rounded-lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-serif text-[32px] font-semibold text-[#0D0437] tracking-tight leading-tight">
            Strategic Positioning
          </h1>
          <p className="text-[13px] text-[#6B7280] mt-1">
            Define the competitive contexts where your brand should be winning AI narrative.
          </p>
        </div>
        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={() => router.push(`/refine/brand?client=${clientId}`)}
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
            <BattlegroundsCard
              battlegrounds={brandDNA.strategic_battlegrounds ?? []}
              onChange={saveBattlegrounds}
            />
          )}
        </div>
        <div className="sticky top-6 h-[600px]">
          {brandDNA && (
            <RefinementChat
              clientId={clientId!}
              brandDNA={brandDNA}
              personas={[]}
              section="battlegrounds"
              onFieldUpdate={handleFieldUpdate}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default function BattlegroundsPage() {
  return (
    <Suspense>
      <BattlegroundsPageInner />
    </Suspense>
  );
}
