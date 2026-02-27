"use client";

import { Suspense } from "react";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { CompetitorCard } from "@/components/onboarding/CompetitorCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { Competitor } from "@/types";
import { toast } from "sonner";
import { Plus, RefreshCw } from "lucide-react";

function CompetitorsPageInner() {
  const searchParams = useSearchParams();
  const clientId = searchParams.get("client");
  const router = useRouter();

  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    if (!clientId) { router.push("/discover"); return; }
    loadCompetitors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  async function loadCompetitors() {
    setLoading(true);
    const supabase = createClient();

    const { data: existing } = await supabase
      .from("competitors")
      .select("*")
      .eq("client_id", clientId)
      .order("created_at");

    if (existing && existing.length > 0) {
      setCompetitors(existing);
      setLoading(false);
      return;
    }

    // First visit — seed from brand_dna.likely_competitors and run validation
    const { data: client } = await supabase
      .from("clients")
      .select("brand_dna")
      .eq("id", clientId)
      .single();

    const likelyCompetitors: string[] = client?.brand_dna?.likely_competitors ?? [];

    if (likelyCompetitors.length > 0) {
      await runValidation(likelyCompetitors.map((name: string) => ({ name })));
    }

    setLoading(false);
  }

  async function runValidation(toCheck: { name: string }[]) {
    if (!toCheck.length) return;
    setChecking(true);
    try {
      const res = await fetch("/api/competitors/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, competitors: toCheck }),
      });
      const data = await res.json();
      if (res.ok) {
        setCompetitors(data.competitors ?? []);
      } else {
        toast.error("Validation failed: " + data.error);
      }
    } catch {
      toast.error("Network error during validation");
    } finally {
      setChecking(false);
    }
  }

  async function handleAddCompetitor() {
    const name = newName.trim();
    if (!name) return;
    setNewName("");
    await runValidation([...competitors.map((c) => ({ name: c.name })), { name }]);
  }

  async function handleDelete(competitorId: string) {
    const supabase = createClient();
    await supabase.from("competitors").delete().eq("id", competitorId);
    setCompetitors((prev) => prev.filter((c) => c.id !== competitorId));
  }

  async function handleContextInjectionChange(id: string, value: string) {
    const supabase = createClient();
    const { error } = await supabase
      .from("competitors")
      .update({ context_injection: value })
      .eq("id", id);
    if (error) toast.error("Failed to save context");
    else setCompetitors((prev) =>
      prev.map((c) => (c.id === id ? { ...c, context_injection: value } : c))
    );
  }

  function handleContinue() {
    router.push(`/configure?client=${clientId}`);
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="border border-[#E2E8F0] rounded-lg bg-white p-4">
            <Skeleton className="h-4 w-32 mb-2" />
            <Skeleton className="h-3 w-48" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-serif text-[32px] font-semibold text-[#0D0437] tracking-tight leading-tight">
            Who are your competitors?
          </h1>
          <p className="text-[13px] text-[#6B7280] mt-1">
            We&apos;ve checked which competitors AI models recognize. Add any we missed.
          </p>
        </div>
        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={() => router.push(`/refine/personas?client=${clientId}`)}
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

      {checking && (
        <div className="flex items-center gap-2 text-[13px] text-[#6B7280]">
          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          Checking AI recognition…
        </div>
      )}

      <div className="space-y-3">
        {competitors.map((comp) => (
          <CompetitorCard
            key={comp.id}
            competitor={comp}
            onDelete={handleDelete}
            onContextInjectionChange={handleContextInjectionChange}
          />
        ))}
        {competitors.length === 0 && !checking && (
          <p className="text-[13px] text-[#6B7280] text-center py-8">
            No competitors added yet. Add one below.
          </p>
        )}
      </div>

      <div className="flex gap-2">
        <Input
          placeholder="Add competitor name…"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleAddCompetitor(); }}
          disabled={checking}
          className="border-[#E2E8F0] focus-visible:ring-[#0D0437]/20"
        />
        <Button
          variant="outline"
          onClick={handleAddCompetitor}
          disabled={!newName.trim() || checking}
          className="border-[#E2E8F0] text-[#0D0437] hover:border-[#0D0437]/40 shrink-0"
        >
          <Plus className="h-4 w-4 mr-1.5" />
          Add
        </Button>
      </div>
    </div>
  );
}

export default function CompetitorsPage() {
  return (
    <Suspense>
      <CompetitorsPageInner />
    </Suspense>
  );
}
