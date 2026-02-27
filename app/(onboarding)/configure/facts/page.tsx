"use client";

import { Suspense } from "react";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { BrandFact, BrandFactCategory } from "@/types";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";

const FACT_CATEGORY_OPTIONS: { value: BrandFactCategory; label: string }[] = [
  { value: "feature", label: "Feature" },
  { value: "market", label: "Market" },
  { value: "pricing", label: "Pricing" },
  { value: "messaging", label: "Messaging" },
];

function FactsPageInner() {
  const searchParams = useSearchParams();
  const clientId = searchParams.get("client");
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [facts, setFacts] = useState<BrandFact[]>([]);

  // Add form state
  const [newClaim, setNewClaim] = useState("");
  const [newCategory, setNewCategory] = useState<BrandFactCategory>("feature");
  const [newIsTrue, setNewIsTrue] = useState(true);
  const [addingFact, setAddingFact] = useState(false);

  // Edit state — only one fact editable at a time
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editClaim, setEditClaim] = useState("");
  const [editCategory, setEditCategory] = useState<BrandFactCategory>("feature");
  const [editIsTrue, setEditIsTrue] = useState(true);
  const [savingEdit, setSavingEdit] = useState(false);

  useEffect(() => {
    if (!clientId) { router.push("/discover"); return; }
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  async function loadAll() {
    setLoading(true);
    const supabase = createClient();
    const { data: existing } = await supabase
      .from("brand_facts")
      .select("*")
      .eq("client_id", clientId)
      .order("created_at", { ascending: true });

    if (existing && existing.length > 0) {
      setFacts(existing as BrandFact[]);
      setLoading(false);
    } else {
      setLoading(false);
      await generateFacts();
    }
  }

  async function generateFacts() {
    setGenerating(true);
    try {
      const res = await fetch("/api/facts/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId }),
      });
      const data = await res.json();
      if (res.ok) {
        setFacts(data.facts ?? []);
      } else {
        toast.error("Fact generation failed: " + data.error);
      }
    } catch {
      toast.error("Network error during fact generation");
    } finally {
      setGenerating(false);
    }
  }

  function startEdit(fact: BrandFact) {
    setEditingId(fact.id);
    setEditClaim(fact.claim);
    setEditCategory(fact.category);
    setEditIsTrue(fact.is_true);
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function handleSaveEdit() {
    const claim = editClaim.trim();
    if (!claim || !editingId) return;
    setSavingEdit(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("brand_facts")
      .update({ claim, category: editCategory, is_true: editIsTrue })
      .eq("id", editingId);
    setSavingEdit(false);
    if (error) {
      toast.error("Failed to save: " + error.message);
    } else {
      setFacts((prev) =>
        prev.map((f) =>
          f.id === editingId
            ? { ...f, claim, category: editCategory, is_true: editIsTrue }
            : f
        )
      );
      setEditingId(null);
    }
  }

  async function handleAddFact() {
    const claim = newClaim.trim();
    if (!claim) return;
    setAddingFact(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("brand_facts")
      .insert({ client_id: clientId, claim, category: newCategory, is_true: newIsTrue })
      .select()
      .single();
    setAddingFact(false);
    if (error) {
      toast.error("Failed to add fact: " + error.message);
    } else {
      setFacts((prev) => [...prev, data as BrandFact]);
      setNewClaim("");
    }
  }

  async function handleDeleteFact(factId: string) {
    const supabase = createClient();
    const { error } = await supabase.from("brand_facts").delete().eq("id", factId);
    if (error) {
      toast.error("Failed to delete fact");
    } else {
      setFacts((prev) => prev.filter((f) => f.id !== factId));
      if (editingId === factId) setEditingId(null);
    }
  }

  if (loading || generating) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-[13px] text-[#6B7280]">
          {generating && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
          {generating ? "Generating brand facts…" : "Loading…"}
        </div>
        {[...Array(4)].map((_, i) => (
          <div key={i} className="border border-[#E2E8F0] rounded-lg bg-white p-3 space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-3 w-32" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-serif text-[32px] font-semibold text-[#0D0437] tracking-tight leading-tight">
            Brand Facts
          </h1>
          <p className="text-[13px] text-[#6B7280] mt-1">
            Source-of-truth claims used to generate validation queries and score Brand Knowledge.
          </p>
        </div>
        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={() => router.push(`/configure/models?client=${clientId}`)}
            className="text-[13px] text-[#6B7280] hover:text-[#0D0437] transition-colors"
          >
            ← Go Back
          </button>
          <Button
            variant="outline"
            size="sm"
            onClick={generateFacts}
            disabled={generating}
            className="border-[#E2E8F0] text-[#0D0437] hover:border-[#0D0437]/40"
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${generating ? "animate-spin" : ""}`} />
            Regenerate
          </Button>
          <Button
            onClick={() => router.push(`/configure/queries?client=${clientId}`)}
            className="bg-[#0D0437] hover:bg-[#1a1150] text-white"
          >
            Continue →
          </Button>
        </div>
      </div>

      {/* Facts list */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <span className="text-[9px] font-bold tracking-[2.5px] uppercase text-[#6B7280] whitespace-nowrap">
            Your Facts
          </span>
          <div className="flex-1 h-px bg-[#E2E8F0]" />
        </div>

        {facts.length > 0 ? (
          <div className="space-y-2">
            {facts.map((fact) =>
              editingId === fact.id ? (
                /* ── Inline edit mode ── */
                <div key={fact.id} className="border border-[#0D0437]/30 rounded-lg bg-white p-3 space-y-2.5">
                  <textarea
                    autoFocus
                    value={editClaim}
                    onChange={(e) => setEditClaim(e.target.value)}
                    rows={2}
                    className="w-full text-sm border border-[#E2E8F0] rounded-lg px-3 py-2 resize-none bg-white text-[#0D0437] focus:outline-none focus:ring-1 focus:ring-[#0D0437]/20"
                  />
                  <div className="flex items-center gap-2 flex-wrap">
                    <select
                      value={editCategory}
                      onChange={(e) => setEditCategory(e.target.value as BrandFactCategory)}
                      className="text-sm border border-[#E2E8F0] rounded-lg px-2 py-1.5 bg-white text-[#0D0437] focus:outline-none focus:ring-1 focus:ring-[#0D0437]/20"
                    >
                      {FACT_CATEGORY_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => setEditIsTrue(true)}
                        className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                          editIsTrue
                            ? "border-[#0D0437] bg-[rgba(13,4,55,0.03)] text-[#0D0437] font-medium"
                            : "border-[#E2E8F0] text-[#6B7280] hover:border-[#0D0437]/30"
                        }`}
                      >
                        Verified fact
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditIsTrue(false)}
                        className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                          !editIsTrue
                            ? "border-[#0D0437] bg-[rgba(13,4,55,0.03)] text-[#0D0437] font-medium"
                            : "border-[#E2E8F0] text-[#6B7280] hover:border-[#0D0437]/30"
                        }`}
                      >
                        False claim test
                      </button>
                    </div>
                    <div className="flex items-center gap-2 ml-auto">
                      <button
                        onClick={cancelEdit}
                        className="text-xs text-[#6B7280] hover:text-[#0D0437] transition-colors"
                      >
                        Cancel
                      </button>
                      <Button
                        size="sm"
                        onClick={handleSaveEdit}
                        disabled={!editClaim.trim() || savingEdit}
                        className="bg-[#0D0437] hover:bg-[#1a1150] text-white"
                      >
                        {savingEdit ? "Saving…" : "Save"}
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                /* ── Read mode ── */
                <div key={fact.id} className="flex items-start gap-3 border border-[#E2E8F0] rounded-lg bg-white p-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-[#0D0437] leading-snug">{fact.claim}</p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#F4F6F9] text-[#6B7280] capitalize">
                        {fact.category}
                      </span>
                      <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${
                        fact.is_true
                          ? "bg-green-50 text-[#1A8F5C]"
                          : "bg-purple-50 text-purple-700"
                      }`}>
                        {fact.is_true ? "Verified fact" : "False claim test"}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 mt-0.5">
                    <button
                      onClick={() => startEdit(fact)}
                      className="text-xs text-[#6B7280] hover:text-[#0D0437] transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDeleteFact(fact.id)}
                      className="text-xs text-[#6B7280] hover:text-[#FF4B6E] transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              )
            )}
          </div>
        ) : (
          <p className="text-[13px] text-[#6B7280] text-center py-6 border border-[#E2E8F0] rounded-lg bg-white">
            No brand facts yet — add your first one below.
          </p>
        )}
      </div>

      {/* Add fact form */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <span className="text-[9px] font-bold tracking-[2.5px] uppercase text-[#6B7280] whitespace-nowrap">
            Add a Fact
          </span>
          <div className="flex-1 h-px bg-[#E2E8F0]" />
        </div>
        <div className="border border-[#E2E8F0] rounded-lg bg-white p-4 space-y-3">
          <textarea
            value={newClaim}
            onChange={(e) => setNewClaim(e.target.value)}
            placeholder='Enter a specific claim about your brand (e.g. "We offer a 14-day free trial with no credit card required")'
            rows={2}
            className="w-full text-sm border border-[#E2E8F0] rounded-lg px-3 py-2 resize-none bg-white text-[#0D0437] placeholder:text-[#9CA3AF] focus:outline-none focus:ring-1 focus:ring-[#0D0437]/20"
          />
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value as BrandFactCategory)}
              className="text-sm border border-[#E2E8F0] rounded-lg px-2 py-1.5 bg-white text-[#0D0437] focus:outline-none focus:ring-1 focus:ring-[#0D0437]/20"
            >
              {FACT_CATEGORY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setNewIsTrue(true)}
                className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                  newIsTrue
                    ? "border-[#0D0437] bg-[rgba(13,4,55,0.03)] text-[#0D0437] font-medium"
                    : "border-[#E2E8F0] text-[#6B7280] hover:border-[#0D0437]/30"
                }`}
              >
                Verified fact
              </button>
              <button
                type="button"
                onClick={() => setNewIsTrue(false)}
                title="A claim your brand does NOT make. We'll flag any AI that confidently confirms it."
                className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                  !newIsTrue
                    ? "border-[#0D0437] bg-[rgba(13,4,55,0.03)] text-[#0D0437] font-medium"
                    : "border-[#E2E8F0] text-[#6B7280] hover:border-[#0D0437]/30"
                }`}
              >
                False claim test
              </button>
            </div>
            <Button
              size="sm"
              onClick={handleAddFact}
              disabled={!newClaim.trim() || addingFact}
              className="ml-auto bg-[#0D0437] hover:bg-[#1a1150] text-white"
            >
              {addingFact ? "Adding…" : "Add Fact"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function FactsPage() {
  return (
    <Suspense>
      <FactsPageInner />
    </Suspense>
  );
}
