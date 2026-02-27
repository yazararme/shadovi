"use client";

import { Suspense } from "react";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PersonaCard } from "@/components/onboarding/PersonaCard";
import { RefinementChat } from "@/components/onboarding/RefinementChat";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { BrandDNA, Persona, RefineResponse } from "@/types";
import { toast } from "sonner";

function PersonasPageInner() {
  const searchParams = useSearchParams();
  const clientId = searchParams.get("client");
  const router = useRouter();

  const [brandDNA, setBrandDNA] = useState<BrandDNA | null>(null);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

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

    const { data: existingPersonas } = await supabase
      .from("personas")
      .select("*")
      .eq("client_id", clientId)
      .order("priority");

    if (existingPersonas && existingPersonas.length > 0) {
      setPersonas(existingPersonas);
      setLoading(false);
    } else {
      setLoading(false);
      await generatePersonas();
    }
  }

  async function generatePersonas() {
    setGenerating(true);
    const res = await fetch("/api/personas/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId }),
    });
    const data = await res.json();
    if (res.ok) {
      setPersonas(data.personas ?? []);
    } else {
      toast.error("Failed to generate personas: " + data.error);
    }
    setGenerating(false);
  }

  async function handleDeletePersona(personaId: string) {
    const supabase = createClient();
    await supabase.from("personas").delete().eq("id", personaId);
    setPersonas((prev) => prev.filter((p) => p.id !== personaId));
  }

  function handleFieldUpdate(field: RefineResponse["updatedField"], value: unknown) {
    if (field === "personas") {
      const supabase = createClient();
      supabase
        .from("personas")
        .select("*")
        .eq("client_id", clientId)
        .order("priority")
        .then(({ data }) => { if (data) setPersonas(data); });
    }
  }

  function handleContinue() {
    router.push(`/competitors?client=${clientId}`);
  }

  if (loading) {
    return (
      <div className="grid grid-cols-[1fr_380px] gap-6">
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="border border-[#E2E8F0] rounded-lg bg-white p-4 space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-full" />
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
            Ideal Customers
          </h1>
          <p className="text-[13px] text-[#6B7280] mt-1">
            These synthetic buyer personas shape which queries get generated for you.
          </p>
        </div>
        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={() => router.push(`/refine/battlegrounds?client=${clientId}`)}
            className="text-[13px] text-[#6B7280] hover:text-[#0D0437] transition-colors"
          >
            ← Go Back
          </button>
          <Button
            onClick={handleContinue}
            className="bg-[#0D0437] hover:bg-[#1a1150] text-white"
          >
            Continue →
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_380px] gap-6 items-start">
        <div className="space-y-3">
          {generating && (
            <div className="text-[13px] text-[#6B7280] animate-pulse">
              Generating personas…
            </div>
          )}
          {personas.map((p) => (
            <PersonaCard key={p.id} persona={p} onDelete={handleDeletePersona} />
          ))}
          {!generating && personas.length === 0 && (
            <div className="text-center py-8 space-y-3">
              <p className="text-[13px] text-[#6B7280]">No personas yet.</p>
              <Button
                variant="outline"
                onClick={generatePersonas}
                className="border-[#E2E8F0] text-[#0D0437] hover:border-[#0D0437]/40"
              >
                Generate personas
              </Button>
            </div>
          )}
        </div>

        <div className="sticky top-6 h-[600px]">
          {brandDNA && (
            <RefinementChat
              clientId={clientId!}
              brandDNA={brandDNA}
              personas={personas}
              section="personas"
              onFieldUpdate={handleFieldUpdate}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default function PersonasPage() {
  return (
    <Suspense>
      <PersonasPageInner />
    </Suspense>
  );
}
