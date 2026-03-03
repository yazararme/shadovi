"use client";

import { Suspense, useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { QueryCard } from "@/components/onboarding/QueryCard";
import {
  RefreshCw, Plus, X, Loader2, Check,
  Fingerprint, Swords, Users, ShieldCheck, ChevronDown, Sparkles, SendHorizonal,
} from "lucide-react";
import { toast } from "sonner";
import type {
  Client, Query, Persona, Competitor, BrandFact, QueryIntent,
  BrandDNA, BrandFactCategory, RefineResponse, LLMModel,
} from "@/types";

// ── Constants ───────────────────────────────────────────────────────────────────

const INTENTS: { key: QueryIntent; label: string }[] = [
  { key: "problem_aware", label: "Problem-Aware" },
  { key: "category",      label: "Category" },
  { key: "comparative",   label: "Comparative" },
  { key: "validation",    label: "Validation" },
];

const FACT_CATEGORY_LABELS: Record<BrandFactCategory, string> = {
  feature: "Feature", market: "Market", pricing: "Pricing", messaging: "Messaging",
};

// Cost per query-model pair (USD, blended input+output estimate at ~500 tokens in / ~300 out)
// Sources: official pricing pages, verified Feb 2026
const MODEL_COSTS_USD: Record<LLMModel, number> = {
  "gpt-4o":            0.0068,   // $2.50/M input + $10.00/M output
  "claude-sonnet-4-6": 0.0054,   // $3.00/M input + $15.00/M output
  "perplexity":        0.0016,   // $1.00/M input + $1.00/M output (Sonar)
  "gemini":            0.00019,  // $0.10/M input + $0.40/M output (2.0 Flash)
  "deepseek":          0.00021,  // $0.28/M input + $0.42/M output (V3.2 cache miss)
};

const GBP_RATE = 0.79;

const MODEL_LABELS: Record<LLMModel, string> = {
  "gpt-4o":            "GPT-4o",
  "claude-sonnet-4-6": "Claude",
  "perplexity":        "Perplexity",
  "gemini":            "Gemini",
  "deepseek":          "DeepSeek",
};

const ALL_MODELS: LLMModel[] = ["gpt-4o", "perplexity", "claude-sonnet-4-6", "gemini", "deepseek"];

function calcMonthlyCost(
  queryCount: number,
  models: LLMModel[],
  frequency: "daily" | "weekly" | "monthly",
): number {
  const runsPerMonth = { daily: 30, weekly: 4, monthly: 1 }[frequency];
  const totalUSD = models.reduce((sum, m) => sum + (MODEL_COSTS_USD[m] ?? 0), 0);
  return queryCount * totalUSD * runsPerMonth * GBP_RATE;
}

// ── Types ───────────────────────────────────────────────────────────────────────

interface PageData {
  client: Client;
  personas: Persona[];
  competitors: Competitor[];
  facts: BrandFact[];
}

type ExpandedCard = "dna" | "competitors" | "personas" | "facts" | null;

const EMPTY_DNA: BrandDNA = {
  brand_name: "", category_name: "", brand_pov: "", product_description: "",
  key_products: [], industries_served: [], use_cases: [],
  likely_competitors: [], differentiators: [], strategic_battlegrounds: [],
};

// ── Loading skeleton ────────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,7fr)_minmax(0,3fr)] gap-6 py-8">
      <div className="bg-white rounded-xl border border-[#E2E8F0] p-6 space-y-4">
        <Skeleton className="h-5 w-40 mb-2" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-4 w-4 rounded shrink-0" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-5 w-20 rounded-full shrink-0" />
          </div>
        ))}
      </div>
      <div className="hidden md:flex flex-col gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-[#E2E8F0] p-5 space-y-3">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-8 w-full rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── AI command bar (persistent, purple-accented, bottom of modal) ────────────────

interface ModalChatProps {
  clientId: string;
  brandDNA: BrandDNA | null;
  personas: Persona[];
  section: string;
  intro: string;
  chips: string[];
  onFieldUpdate?: (field: RefineResponse["updatedField"], value: unknown) => void;
}

function AICommandBar({ clientId, brandDNA, personas, section, intro, chips, onFieldUpdate }: ModalChatProps) {
  const [input, setInput] = useState("");
  const [lastReply, setLastReply] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSend(override?: string) {
    const msg = (override ?? input).trim();
    if (!msg || loading) return;
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/personas/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, message: msg, currentProfile: { brandDNA, personas }, section }),
      });
      const data: RefineResponse | { error: string } = await res.json();
      if ("error" in data) { setLastReply(`Something went wrong: ${data.error}`); return; }
      setLastReply(data.reply);
      if (data.updatedField && data.updatedValue !== null && onFieldUpdate) {
        onFieldUpdate(data.updatedField, data.updatedValue);
      }
    } catch {
      setLastReply("Network error — please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-[#F9F7FF] border border-[#E4DBFF] rounded-xl p-3 space-y-2.5">
      {/* Most recent AI reply with dismiss */}
      {lastReply && (
        <div className="flex items-start gap-2">
          <p className="flex-1 text-xs text-[#4B5563] leading-relaxed bg-white/80 rounded-lg px-3 py-2 border border-[#E4DBFF]">
            {lastReply}
          </p>
          <button onClick={() => setLastReply(null)}
            className="shrink-0 text-[#C4B5D8] hover:text-[#7B5EA7] mt-1.5 transition-colors">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
      {/* Quick-action chips — visible when nothing typed and no reply showing */}
      {!input && !lastReply && (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <button key={chip} onClick={() => handleSend(chip)}
              className="text-xs px-2.5 py-1 rounded-full border border-[#D8CCF0] bg-white text-[#7B5EA7] hover:bg-[#F0EBFF] transition-colors">
              {chip}
            </button>
          ))}
        </div>
      )}
      {/* Input row */}
      <div className="flex items-center gap-2.5">
        <Sparkles className="h-3.5 w-3.5 text-[#9B72CF] shrink-0" />
        <input
          type="text" value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          placeholder={intro}
          disabled={loading}
          className="flex-1 text-sm bg-transparent outline-none placeholder:text-[#C4B5D8] text-[#0D0437] min-w-0"
        />
        <button onClick={() => handleSend()} disabled={!input.trim() || loading}
          className="shrink-0 text-[#7B5EA7] hover:text-[#5B3E8F] disabled:opacity-30 transition-colors">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SendHorizonal className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}

// ── Shared modal shell ──────────────────────────────────────────────────────────

function ModalShell({ title, subtitle, onClose, onSave, saving, children }: {
  title: string;
  subtitle: string;
  onClose: () => void;
  onSave: () => Promise<void>;
  saving: boolean;
  children: React.ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Move focus into the modal when it mounts
  useEffect(() => {
    dialogRef.current?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )?.focus();
  }, []);

  return (
    <div className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="modal-title"
        className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-5 border-b border-[#E2E8F0] shrink-0">
          <div>
            <h3 id="modal-title" className="font-exo2 font-bold text-lg text-[#0D0437]">{title}</h3>
            <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-[#0D0437] transition-colors ml-4 mt-0.5">
            <X className="h-5 w-5" />
          </button>
        </div>
        {/* Body */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {children}
        </div>
        {/* Footer */}
        <div className="border-t border-[#E2E8F0] p-4 flex justify-end gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={onClose} className="border-[#E2E8F0]">Cancel</Button>
          <Button size="sm" onClick={onSave} disabled={saving}
            className="bg-[#0D0437] hover:bg-[#1a1150] text-white">
            {saving ? "Saving…" : "Save Changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Brand DNA modal ─────────────────────────────────────────────────────────────

function DnaModal({ data, clientId, onSave, onClose }: {
  data: PageData;
  clientId: string;
  onSave: (dna: BrandDNA) => Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<BrandDNA>(data.client.brand_dna ?? EMPTY_DNA);
  const [saving, setSaving] = useState(false);
  const [newUseCase, setNewUseCase] = useState("");
  const [newDiff, setNewDiff] = useState("");

  function handleFieldUpdate(field: RefineResponse["updatedField"], value: unknown) {
    if (!field || field === "personas") return;
    setDraft((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSave() {
    setSaving(true);
    try { await onSave(draft); } finally { setSaving(false); }
  }

  const editContent = (
    <div className="p-6 space-y-5">
      {/* Name */}
      <div>
        <label className="text-xs font-medium text-[#6B7280] uppercase tracking-wider block mb-1.5">Brand Name</label>
        <input value={draft.brand_name}
          onChange={(e) => setDraft((p) => ({ ...p, brand_name: e.target.value }))}
          className="w-full text-sm border border-[#E2E8F0] rounded-lg px-3 py-2 outline-none focus:border-[#0D0437] focus:ring-2 focus:ring-[#0D0437]/10" />
      </div>
      {/* Category */}
      <div>
        <label className="text-xs font-medium text-[#6B7280] uppercase tracking-wider block mb-1.5">Category</label>
        <input value={draft.category_name}
          onChange={(e) => setDraft((p) => ({ ...p, category_name: e.target.value }))}
          className="w-full text-sm border border-[#E2E8F0] rounded-lg px-3 py-2 outline-none focus:border-[#0D0437] focus:ring-2 focus:ring-[#0D0437]/10" />
      </div>
      {/* POV */}
      <div>
        <label className="text-xs font-medium text-[#6B7280] uppercase tracking-wider block mb-1.5">Brand POV</label>
        <textarea value={draft.brand_pov} rows={3}
          onChange={(e) => setDraft((p) => ({ ...p, brand_pov: e.target.value }))}
          className="w-full text-sm border border-[#E2E8F0] rounded-lg px-3 py-2 outline-none focus:border-[#0D0437] focus:ring-2 focus:ring-[#0D0437]/10 resize-none" />
      </div>
      {/* Use Cases */}
      <div>
        <label className="text-xs font-medium text-[#6B7280] uppercase tracking-wider block mb-1.5">Use Cases</label>
        <div className="space-y-1.5">
          {(draft.use_cases ?? []).map((uc, i) => (
            <div key={i} className="flex items-center gap-2">
              <input value={uc}
                onChange={(e) => { const n = [...(draft.use_cases ?? [])]; n[i] = e.target.value; setDraft((p) => ({ ...p, use_cases: n })); }}
                className="flex-1 text-sm border border-[#E2E8F0] rounded-lg px-3 py-1 outline-none focus:border-[#0D0437]" />
              <button onClick={() => setDraft((p) => ({ ...p, use_cases: (p.use_cases ?? []).filter((_, j) => j !== i) }))}
                className="text-[#9CA3AF] hover:text-[#FF4B6E] transition-colors shrink-0">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <div className="flex gap-2">
            <input value={newUseCase} onChange={(e) => setNewUseCase(e.target.value)}
              placeholder="Add use case…"
              onKeyDown={(e) => { if (e.key === "Enter" && newUseCase.trim()) { setDraft((p) => ({ ...p, use_cases: [...(p.use_cases ?? []), newUseCase.trim()] })); setNewUseCase(""); } }}
              className="flex-1 text-sm border border-dashed border-[#CBD5E1] rounded-lg px-3 py-1 outline-none focus:border-[#0D0437] placeholder:text-[#9CA3AF]" />
            <button onClick={() => { if (newUseCase.trim()) { setDraft((p) => ({ ...p, use_cases: [...(p.use_cases ?? []), newUseCase.trim()] })); setNewUseCase(""); } }}
              className="px-3 py-1 border border-[#E2E8F0] rounded-lg hover:border-[#0D0437] transition-colors">
              <Plus className="h-3.5 w-3.5 text-[#0D0437]" />
            </button>
          </div>
        </div>
      </div>
      {/* Differentiators */}
      <div>
        <label className="text-xs font-medium text-[#6B7280] uppercase tracking-wider block mb-1.5">Differentiators</label>
        <div className="space-y-1.5">
          {(draft.differentiators ?? []).map((d, i) => (
            <div key={i} className="flex items-center gap-2">
              <input value={d}
                onChange={(e) => { const n = [...(draft.differentiators ?? [])]; n[i] = e.target.value; setDraft((p) => ({ ...p, differentiators: n })); }}
                className="flex-1 text-sm border border-[#E2E8F0] rounded-lg px-3 py-1 outline-none focus:border-[#0D0437]" />
              <button onClick={() => setDraft((p) => ({ ...p, differentiators: (p.differentiators ?? []).filter((_, j) => j !== i) }))}
                className="text-[#9CA3AF] hover:text-[#FF4B6E] transition-colors shrink-0">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <div className="flex gap-2">
            <input value={newDiff} onChange={(e) => setNewDiff(e.target.value)}
              placeholder="Add differentiator…"
              onKeyDown={(e) => { if (e.key === "Enter" && newDiff.trim()) { setDraft((p) => ({ ...p, differentiators: [...(p.differentiators ?? []), newDiff.trim()] })); setNewDiff(""); } }}
              className="flex-1 text-sm border border-dashed border-[#CBD5E1] rounded-lg px-3 py-1 outline-none focus:border-[#0D0437] placeholder:text-[#9CA3AF]" />
            <button onClick={() => { if (newDiff.trim()) { setDraft((p) => ({ ...p, differentiators: [...(p.differentiators ?? []), newDiff.trim()] })); setNewDiff(""); } }}
              className="px-3 py-1 border border-[#E2E8F0] rounded-lg hover:border-[#0D0437] transition-colors">
              <Plus className="h-3.5 w-3.5 text-[#0D0437]" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <ModalShell title="Brand DNA" subtitle="Review and correct your brand identity" onClose={onClose} onSave={handleSave} saving={saving}>
      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {editContent}
      </div>
      <div className="px-6 pb-3 shrink-0">
        <AICommandBar clientId={clientId} brandDNA={draft} personas={data.personas} section="brand"
          intro="Tell me anything that's off — category, POV, use cases, differentiators…"
          chips={["Sharpen the category name", "Rewrite the brand POV", "Update our key differentiators"]}
          onFieldUpdate={handleFieldUpdate} />
      </div>
    </ModalShell>
  );
}

// ── Competitors modal ───────────────────────────────────────────────────────────

function CompetitorsModal({ data, clientId, onSave, onClose }: {
  data: PageData;
  clientId: string;
  onSave: (competitors: Competitor[]) => Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Competitor[]>(data.competitors);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState("");

  async function handleSave() {
    setSaving(true);
    try { await onSave(draft); } finally { setSaving(false); }
  }

  function addCompetitor() {
    if (!newName.trim()) return;
    const comp: Competitor = {
      id: crypto.randomUUID(), client_id: clientId, name: newName.trim(),
      url: null, context_injection: "", llm_recognized: null, recognition_detail: null,
      created_at: new Date().toISOString(),
    };
    setDraft((p) => [...p, comp]);
    setNewName("");
  }

  const editContent = (
    <div className="p-6 space-y-3">
      {draft.map((comp) => (
        <div key={comp.id} className="border border-[#E2E8F0] rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-3">
            <input value={comp.name}
              onChange={(e) => setDraft((p) => p.map((c) => c.id === comp.id ? { ...c, name: e.target.value } : c))}
              className="flex-1 text-sm font-medium border border-[#E2E8F0] rounded-lg px-3 py-1.5 outline-none focus:border-[#0D0437] text-[#0D0437]" />
            <button onClick={() => setDraft((p) => p.filter((c) => c.id !== comp.id))}
              className="text-[#9CA3AF] hover:text-[#FF4B6E] transition-colors shrink-0">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div>
            <label className="text-xs text-[#6B7280] block mb-1">Context hint (optional)</label>
            <textarea value={comp.context_injection ?? ""} rows={2}
              onChange={(e) => setDraft((p) => p.map((c) => c.id === comp.id ? { ...c, context_injection: e.target.value } : c))}
              placeholder={`e.g. "${comp.name} is a [category] tool used by [persona]"`}
              className="w-full text-xs border border-[#E2E8F0] rounded-lg px-3 py-2 outline-none focus:border-[#0D0437] resize-none placeholder:text-[#9CA3AF]" />
          </div>
        </div>
      ))}
      {/* Add competitor */}
      <div className="flex gap-2 pt-1">
        <input value={newName} onChange={(e) => setNewName(e.target.value)}
          placeholder="Competitor name…"
          onKeyDown={(e) => { if (e.key === "Enter") addCompetitor(); }}
          className="flex-1 text-sm border border-dashed border-[#CBD5E1] rounded-lg px-3 py-2 outline-none focus:border-[#0D0437] placeholder:text-[#9CA3AF]" />
        <button onClick={addCompetitor}
          className="flex items-center gap-1.5 text-sm text-[#0D0437] px-3 py-2 border border-[#E2E8F0] rounded-lg hover:border-[#0D0437] transition-colors">
          <Plus className="h-3.5 w-3.5" /> Add
        </button>
      </div>
    </div>
  );

  return (
    <ModalShell title="Competitors" subtitle="Review your tracked competitors" onClose={onClose} onSave={handleSave} saving={saving}>
      <div className="flex-1 overflow-y-auto p-6 space-y-3">
        {editContent}
      </div>
      <div className="px-6 pb-3 shrink-0">
        <AICommandBar clientId={clientId} brandDNA={data.client.brand_dna} personas={data.personas} section="competitors"
          intro="Add, remove, or update your tracked competitors…"
          chips={["Add a missing competitor", "Remove the weakest match", "Add context to an unrecognised competitor"]} />
      </div>
    </ModalShell>
  );
}

// ── Personas modal ──────────────────────────────────────────────────────────────

function PersonasModal({ data, clientId, onSave, onClose }: {
  data: PageData;
  clientId: string;
  onSave: (personas: Persona[]) => Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Persona[]>(data.personas);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    try { await onSave(draft); } finally { setSaving(false); }
  }

  function addPersona() {
    if (!newName.trim() || !newRole.trim()) return;
    const p: Persona = {
      id: crypto.randomUUID(), client_id: clientId, name: newName.trim(), role: newRole.trim(),
      pain_points: [], buying_triggers: [], internal_monologue: "", skepticisms: [],
      priority: draft.length + 1, created_at: new Date().toISOString(),
    };
    setDraft((prev) => [...prev, p]);
    setNewName(""); setNewRole("");
  }

  const editContent = (
    <div className="p-6 space-y-3">
      {draft.map((p) => {
        const open = expandedId === p.id;
        return (
          <div key={p.id} className="border border-[#E2E8F0] rounded-lg p-4">
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[#0D0437]">{p.name}</p>
                <p className="text-xs text-muted-foreground">{p.role}</p>
                {p.internal_monologue && (
                  <p className="text-xs text-[#6B7280] italic mt-1.5 line-clamp-2">"{p.internal_monologue}"</p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => setExpandedId(open ? null : p.id)}
                  className="text-muted-foreground hover:text-[#0D0437] transition-colors">
                  <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
                </button>
                <button onClick={() => setDraft((prev) => prev.filter((x) => x.id !== p.id))}
                  className="text-[#9CA3AF] hover:text-[#FF4B6E] transition-colors">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            {open && p.pain_points.length > 0 && (
              <div className="mt-3 pt-3 border-t border-[#E2E8F0] space-y-2">
                <div>
                  <p className="text-xs font-medium text-[#0D0437] mb-1">Pain points</p>
                  {p.pain_points.map((pt, i) => (
                    <p key={i} className="text-xs text-muted-foreground flex gap-1.5"><span>–</span>{pt}</p>
                  ))}
                </div>
                {p.buying_triggers.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-[#0D0437] mb-1">Buying triggers</p>
                    {p.buying_triggers.map((t, i) => (
                      <p key={i} className="text-xs text-muted-foreground flex gap-1.5"><span>–</span>{t}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
      {/* Add persona */}
      <div className="border border-dashed border-[#CBD5E1] rounded-lg p-4 space-y-2">
        <p className="text-xs font-medium text-[#6B7280]">Add a persona</p>
        <input value={newName} onChange={(e) => setNewName(e.target.value)}
          placeholder="Name…"
          className="w-full text-sm border border-[#E2E8F0] rounded-lg px-3 py-1.5 outline-none focus:border-[#0D0437] placeholder:text-[#9CA3AF]" />
        <input value={newRole} onChange={(e) => setNewRole(e.target.value)}
          placeholder="Role / title…"
          onKeyDown={(e) => { if (e.key === "Enter") addPersona(); }}
          className="w-full text-sm border border-[#E2E8F0] rounded-lg px-3 py-1.5 outline-none focus:border-[#0D0437] placeholder:text-[#9CA3AF]" />
        <button onClick={addPersona} disabled={!newName.trim() || !newRole.trim()}
          className="flex items-center gap-1.5 text-sm text-[#0D0437] px-3 py-1.5 border border-[#E2E8F0] rounded-lg hover:border-[#0D0437] transition-colors disabled:opacity-40">
          <Plus className="h-3.5 w-3.5" /> Add persona
        </button>
      </div>
    </div>
  );

  return (
    <ModalShell title="Buyer Personas" subtitle="Review your synthetic buyer personas" onClose={onClose} onSave={handleSave} saving={saving}>
      <div className="flex-1 overflow-y-auto p-6 space-y-3">
        {editContent}
      </div>
      <div className="px-6 pb-3 shrink-0">
        <AICommandBar clientId={clientId} brandDNA={data.client.brand_dna} personas={draft} section="personas"
          intro="Ask me to update your buyer personas…"
          chips={["Remove the most generic persona", "Sharpen pain points", "Add a missing buyer role"]} />
      </div>
    </ModalShell>
  );
}

// ── Brand Facts modal ───────────────────────────────────────────────────────────

function FactsModal({ data, clientId, onSave, onClose }: {
  data: PageData;
  clientId: string;
  onSave: (facts: BrandFact[]) => Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<BrandFact[]>(data.facts);
  const [saving, setSaving] = useState(false);
  const [newClaim, setNewClaim] = useState("");
  const [newCategory, setNewCategory] = useState<BrandFactCategory>("feature");
  const [newIsTrue, setNewIsTrue] = useState(true);

  async function handleSave() {
    setSaving(true);
    try { await onSave(draft); } finally { setSaving(false); }
  }

  function addFact() {
    if (!newClaim.trim()) return;
    const f: BrandFact = {
      id: crypto.randomUUID(), client_id: clientId, claim: newClaim.trim(),
      category: newCategory, is_true: newIsTrue, created_at: new Date().toISOString(),
      version_id: null,
    };
    setDraft((p) => [...p, f]);
    setNewClaim("");
  }

  const verified = draft.filter((f) => f.is_true);
  const falseClaims = draft.filter((f) => !f.is_true);

  function FactRow({ fact }: { fact: BrandFact }) {
    return (
      <div className="flex items-start gap-2 py-2 border-b border-[#F4F6F9] last:border-0">
        <input value={fact.claim}
          onChange={(e) => setDraft((p) => p.map((f) => f.id === fact.id ? { ...f, claim: e.target.value } : f))}
          className="flex-1 text-xs border border-[#E2E8F0] rounded px-2 py-1 outline-none focus:border-[#0D0437] min-w-0" />
        <button onClick={() => setDraft((p) => p.filter((f) => f.id !== fact.id))}
          className="text-[#9CA3AF] hover:text-[#FF4B6E] transition-colors shrink-0 mt-0.5">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  const editContent = (
    <div className="p-6 space-y-5">
      {/* Verified facts */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-bold uppercase tracking-wide text-[#6B7280]">Verified Facts</span>
          <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border bg-[rgba(26,143,92,0.08)] text-[#1A8F5C] border-[rgba(26,143,92,0.2)]">
            {verified.length}
          </span>
        </div>
        {verified.length === 0
          ? <p className="text-xs text-muted-foreground italic">No verified facts yet.</p>
          : verified.map((f) => <FactRow key={f.id} fact={f} />)}
      </div>
      {/* False claim tests */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-bold uppercase tracking-wide text-[#6B7280]">False Claim Tests</span>
          <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border bg-[rgba(245,158,11,0.08)] text-[#B45309] border-[rgba(245,158,11,0.2)]">
            {falseClaims.length}
          </span>
        </div>
        {falseClaims.length === 0
          ? <p className="text-xs text-muted-foreground italic">No false claim tests yet.</p>
          : falseClaims.map((f) => <FactRow key={f.id} fact={f} />)}
      </div>
      {/* Add fact */}
      <div className="border border-dashed border-[#CBD5E1] rounded-lg p-4 space-y-2">
        <p className="text-xs font-medium text-[#6B7280]">Add a fact</p>
        <textarea value={newClaim} onChange={(e) => setNewClaim(e.target.value)} rows={2}
          placeholder="Fact claim…"
          className="w-full text-sm border border-[#E2E8F0] rounded-lg px-3 py-2 outline-none focus:border-[#0D0437] resize-none placeholder:text-[#9CA3AF]" />
        <div className="flex items-center gap-2 flex-wrap">
          <select value={newCategory} onChange={(e) => setNewCategory(e.target.value as BrandFactCategory)}
            className="text-xs border border-[#E2E8F0] rounded-lg px-2 py-1.5 outline-none focus:border-[#0D0437] bg-white">
            {(Object.keys(FACT_CATEGORY_LABELS) as BrandFactCategory[]).map((k) => (
              <option key={k} value={k}>{FACT_CATEGORY_LABELS[k]}</option>
            ))}
          </select>
          <div className="flex rounded-lg border border-[#E2E8F0] overflow-hidden text-xs font-medium">
            <button onClick={() => setNewIsTrue(true)}
              className={`px-3 py-1.5 transition-colors ${newIsTrue ? "bg-[#1A8F5C] text-white" : "bg-white text-[#6B7280] hover:bg-[#F4F6F9]"}`}>
              Verified
            </button>
            <button onClick={() => setNewIsTrue(false)}
              className={`px-3 py-1.5 transition-colors ${!newIsTrue ? "bg-[#F59E0B] text-white" : "bg-white text-[#6B7280] hover:bg-[#F4F6F9]"}`}>
              False Claim
            </button>
          </div>
          <button onClick={addFact} disabled={!newClaim.trim()}
            className="flex items-center gap-1.5 text-sm text-[#0D0437] px-3 py-1.5 border border-[#E2E8F0] rounded-lg hover:border-[#0D0437] transition-colors disabled:opacity-40">
            <Plus className="h-3.5 w-3.5" /> Add
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <ModalShell title="Brand Facts" subtitle="Review your brand facts and false claim tests" onClose={onClose} onSave={handleSave} saving={saving}>
      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {editContent}
      </div>
      <div className="px-6 pb-3 shrink-0">
        <AICommandBar clientId={clientId} brandDNA={data.client.brand_dna} personas={data.personas} section="facts"
          intro="Ask me to add, remove, or correct brand facts…"
          chips={["Add a missing feature claim", "Suggest false claim tests", "Remove a weak fact"]} />
      </div>
    </ModalShell>
  );
}

// ── Left panel ──────────────────────────────────────────────────────────────────

interface LeftPanelProps {
  queries: Query[];
  setQueries: React.Dispatch<React.SetStateAction<Query[]>>;
  activeIntent: QueryIntent;
  setActiveIntent: (intent: QueryIntent) => void;
  isDirty: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
  clientId: string;
  calibrationInput: string;
  setCalibrationInput: React.Dispatch<React.SetStateAction<string>>;
  isCalibrating: boolean;
  onCalibrate: () => void;
}

function LeftPanel({ queries, setQueries, activeIntent, setActiveIntent, isDirty, isRefreshing, onRefresh, clientId, calibrationInput, setCalibrationInput, isCalibrating, onCalibrate }: LeftPanelProps) {
  const [addingQueryForIntent, setAddingQueryForIntent] = useState<QueryIntent | null>(null);
  const [newQueryText, setNewQueryText] = useState("");
  const [newQueryPhrasingStyle, setNewQueryPhrasingStyle] = useState<"conversational" | "formal">("conversational");

  function countForIntent(intent: QueryIntent) {
    return queries.filter((q) => q.intent === intent && q.status !== "removed").length;
  }

  const visibleQueries = queries.filter((q) => q.intent === activeIntent && q.status !== "removed");
  const totalActive = queries.filter((q) => q.status !== "removed").length;
  const intentLayerCount = INTENTS.filter((i) => countForIntent(i.key) > 0).length;

  function handleRemove(id: string) {
    setQueries((prev) => prev.map((q) => (q.id === id ? { ...q, status: "removed" } : q)));
  }
  async function handleTextChange(id: string, text: string) {
    setQueries((prev) => prev.map((q) => (q.id === id ? { ...q, text } : q)));
    const supabase = createClient();
    await supabase.from("queries").update({ text }).eq("id", id);
  }

  function handleCancelAddQuery() {
    setAddingQueryForIntent(null);
    setNewQueryText("");
    setNewQueryPhrasingStyle("conversational");
  }

  async function handleSaveNewQuery() {
    if (!newQueryText.trim() || !addingQueryForIntent) return;
    const supabase = createClient();
    const { data, error } = await supabase.from("queries").insert({
      client_id: clientId,
      text: newQueryText.trim(),
      intent: addingQueryForIntent,
      phrasing_style: newQueryPhrasingStyle,
      manually_added: true,
      status: "pending_approval",
    }).select().single();
    if (error || !data) { toast.error("Failed to add query"); return; }
    setQueries((prev) => [...prev, data as Query]);
    handleCancelAddQuery();
  }

  function handleTabKeyDown(e: React.KeyboardEvent) {
    const intents: QueryIntent[] = ["problem_aware", "category", "comparative", "validation"];
    const current = intents.indexOf(activeIntent);
    if (e.key === "ArrowRight") {
      e.preventDefault();
      setActiveIntent(intents[(current + 1) % intents.length]);
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setActiveIntent(intents[(current - 1 + intents.length) % intents.length]);
    }
  }

  return (
    <div className="flex flex-col bg-white rounded-xl border border-[#E2E8F0] overflow-hidden">
      <div className="px-5 pt-5 pb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="font-exo2 font-bold text-xl text-[#0D0437] leading-tight">Your Query Portfolio</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {totalActive} {totalActive === 1 ? "query" : "queries"} · {intentLayerCount} intent {intentLayerCount === 1 ? "layer" : "layers"}
          </p>
        </div>
        {isDirty && (
          <Button size="sm" variant="outline" onClick={onRefresh} disabled={isRefreshing}
            className="shrink-0 border-[#F59E0B] text-[#F59E0B] bg-[#F59E0B]/10 hover:bg-[#F59E0B]/20 hover:text-[#F59E0B] hover:border-[#F59E0B]">
            {isRefreshing
              ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
            {isRefreshing ? "Refreshing…" : "Refresh Queries"}
          </Button>
        )}
      </div>
      <div role="tablist" aria-label="Query intent filters" onKeyDown={handleTabKeyDown}
        className="flex border-b border-[#E2E8F0] px-5 gap-0 overflow-x-auto">
        {INTENTS.map(({ key, label }) => {
          const isActive = activeIntent === key;
          return (
            <button key={key} onClick={() => setActiveIntent(key)}
              role="tab" aria-selected={isActive}
              aria-controls={`querylist-${key}`} id={`tab-${key}`}
              tabIndex={isActive ? 0 : -1}
              className={`shrink-0 pb-3 px-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
                isActive ? "border-[#0D0437] text-[#0D0437]" : "border-transparent text-muted-foreground hover:text-[#0D0437]"
              }`}>
              <span className={isActive && isCalibrating ? "animate-pulse" : ""}>{label}</span>
              <span className={`ml-1.5 text-xs ${isActive ? "text-[#0D0437]" : "text-muted-foreground"}`}>
                ({countForIntent(key)})
              </span>
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={`querylist-${activeIntent}`} aria-labelledby={`tab-${activeIntent}`}
        tabIndex={0} className="flex-1 px-4 py-4 space-y-2">
        {visibleQueries.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">No queries yet for this intent.</p>
        )}
        {visibleQueries.map((query) => (
          <QueryCard key={query.id} query={query} onRemove={handleRemove} onTextChange={handleTextChange}
            autoEdit={false} />
        ))}
        {/* Inline add form — shown when button is clicked */}
        {addingQueryForIntent === activeIntent && (
          <div className="border border-[#E2E8F0] rounded-lg p-4 space-y-3 bg-[#F9FAFB]">
            <textarea
              autoFocus
              rows={2}
              value={newQueryText}
              onChange={(e) => setNewQueryText(e.target.value)}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") handleSaveNewQuery(); if (e.key === "Escape") handleCancelAddQuery(); }}
              placeholder="Enter your query…"
              className="w-full text-sm border border-[#E2E8F0] rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-[#0D0437]/20 focus:border-[#0D0437] resize-none placeholder:text-[#9CA3AF]"
            />
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex rounded-lg border border-[#E2E8F0] overflow-hidden text-xs font-medium">
                <button type="button" onClick={() => setNewQueryPhrasingStyle("conversational")}
                  className={`px-3 py-1.5 transition-colors ${newQueryPhrasingStyle === "conversational" ? "bg-[#0D0437] text-white" : "bg-white text-[#6B7280] hover:bg-[#F4F6F9]"}`}>
                  Conversational
                </button>
                <button type="button" onClick={() => setNewQueryPhrasingStyle("formal")}
                  className={`px-3 py-1.5 transition-colors ${newQueryPhrasingStyle === "formal" ? "bg-[#0D0437] text-white" : "bg-white text-[#6B7280] hover:bg-[#F4F6F9]"}`}>
                  Formal
                </button>
              </div>
              <div className="flex gap-2 ml-auto">
                <button type="button" onClick={handleCancelAddQuery}
                  className="text-xs text-[#6B7280] hover:text-[#0D0437] transition-colors px-3 py-1.5">
                  Cancel
                </button>
                <button type="button" onClick={handleSaveNewQuery} disabled={!newQueryText.trim()}
                  className="text-xs font-semibold text-white bg-[#0D0437] hover:bg-[#1a1150] px-3 py-1.5 rounded-md transition-colors disabled:opacity-40">
                  Add Query
                </button>
              </div>
            </div>
          </div>
        )}
        {addingQueryForIntent !== activeIntent && (
          <button onClick={() => setAddingQueryForIntent(activeIntent)}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-[#0D0437] transition-colors py-2 px-1">
            <Plus className="h-4 w-4" /> Add a query
          </button>
        )}
      </div>
      <div className="sticky bottom-0 bg-white border-t border-[#E2E8F0] px-4 py-3">
        <div className="bg-[#F5F3FF] rounded-xl p-4 mx-4 mb-4 space-y-2.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#0D0437] mb-0">
            Fine-tune your portfolio
          </p>
          <p className="text-[11px] text-[#6B7280]">Describe changes and AI will rewrite matching queries.</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={calibrationInput}
              onChange={(e) => setCalibrationInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !isCalibrating) onCalibrate(); }}
              placeholder='e.g. "Make problem-aware queries more urgent"'
              aria-label="Calibration instruction"
              className="flex-1 text-sm border border-[#E2E8F0] rounded-lg px-3 py-2 outline-none bg-white text-[#0D0437] placeholder:text-[#9CA3AF] focus:border-[#7C3AED]" />
            <Button size="sm" onClick={onCalibrate} disabled={isCalibrating || !calibrationInput.trim()}
              aria-label="Apply calibration instruction"
              className="bg-[#7C3AED] hover:bg-[#6D28D9] text-white shrink-0 border-0">
              {isCalibrating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Apply"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Right panel — collapsed config cards ────────────────────────────────────────

function ConfigCard({ icon, title, summary, expanded, onToggle, onEdit, hasDot, children }: {
  icon: React.ReactNode;
  title: string;
  summary: string;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  hasDot?: boolean;
  children: React.ReactNode;
}) {
  const cardKey = title.toLowerCase().replace(/\s+/g, "-");
  return (
    <div onClick={onToggle}
      role="button" tabIndex={0}
      aria-expanded={expanded}
      aria-controls={`card-content-${cardKey}`}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
      className="relative bg-white border border-[#E2E8F0] rounded-lg p-4 cursor-pointer hover:border-[#CBD5E1] transition-colors">
      {hasDot && (
        <span className="absolute top-2 right-10 h-1.5 w-1.5 rounded-full bg-[#F59E0B]" />
      )}
      <div className="flex items-center gap-3">
        <div className="shrink-0 text-muted-foreground">{icon}</div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#0D0437] leading-tight">{title}</p>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{summary}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div onClick={(e) => e.stopPropagation()}>
            <button onClick={onEdit}
              aria-label={`Edit ${title}`} aria-haspopup="dialog"
              className="text-xs text-[#0D0437] border border-[#E2E8F0] hover:border-[#0D0437] px-2 py-1 rounded transition-colors">
              Review & Edit
            </button>
          </div>
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
        </div>
      </div>
      {expanded && (
        <div id={`card-content-${cardKey}`} role="region" aria-label={`${title} details`}
          className="mt-3 pt-3 border-t border-[#E2E8F0] space-y-1" onClick={(e) => e.stopPropagation()}>
          {children}
        </div>
      )}
    </div>
  );
}

function RightPanel({ data, queries, onEdit, selectedModels, setSelectedModels, selectedFrequency, setSelectedFrequency, activating, onActivate, dirtySections }: {
  data: PageData;
  queries: Query[];
  onEdit: (section: ExpandedCard) => void;
  selectedModels: LLMModel[];
  setSelectedModels: React.Dispatch<React.SetStateAction<LLMModel[]>>;
  selectedFrequency: "daily" | "weekly" | "monthly";
  setSelectedFrequency: React.Dispatch<React.SetStateAction<"daily" | "weekly" | "monthly">>;
  activating: boolean;
  onActivate: () => void;
  dirtySections: Set<"dna" | "competitors" | "personas" | "facts">;
}) {
  const { client, competitors, personas, facts } = data;
  const dna = client.brand_dna;
  const [expandedCard, setExpandedCard] = useState<ExpandedCard>(null);

  function toggle(id: ExpandedCard) { setExpandedCard((prev) => (prev === id ? null : id)); }

  const verifiedFacts = facts.filter((f) => f.is_true).length;
  const falseClaimTests = facts.filter((f) => !f.is_true).length;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Query Configuration</p>
      <div className="flex flex-col gap-3">
        <ConfigCard icon={<Fingerprint className="h-4 w-4" />} title="Brand DNA"
          summary={dna ? `${dna.brand_name} · ${dna.category_name} · ${dna.differentiators?.length ?? 0} differentiators` : "Not configured"}
          expanded={expandedCard === "dna"} onToggle={() => toggle("dna")} onEdit={() => onEdit("dna")}
          hasDot={dirtySections.has("dna")}>
          {dna ? (
            <>
              <p className="text-xs text-muted-foreground"><span className="font-medium text-[#0D0437]">Category:</span> {dna.category_name}</p>
              <p className="text-xs text-muted-foreground"><span className="font-medium text-[#0D0437]">POV:</span> {dna.brand_pov.length > 80 ? `${dna.brand_pov.slice(0, 80)}…` : dna.brand_pov}</p>
              {(dna.use_cases ?? []).slice(0, 3).map((uc, i) => (
                <p key={i} className="text-xs text-muted-foreground"><span className="font-medium text-[#0D0437]">Use case:</span> {uc}</p>
              ))}
              {(dna.use_cases?.length ?? 0) > 3 && (
                <button onClick={() => onEdit("dna")} className="text-xs text-[#6B7280] hover:text-[#0D0437] mt-1 transition-colors">
                  +{(dna.use_cases?.length ?? 0) - 3} more — click to view & edit
                </button>
              )}
              {(dna.differentiators ?? []).slice(0, 3).map((d, i) => (
                <p key={i} className="text-xs text-muted-foreground"><span className="font-medium text-[#0D0437]">Differentiator:</span> {d}</p>
              ))}
              {(dna.differentiators?.length ?? 0) > 3 && (
                <button onClick={() => onEdit("dna")} className="text-xs text-[#6B7280] hover:text-[#0D0437] mt-1 transition-colors">
                  +{(dna.differentiators?.length ?? 0) - 3} more — click to view & edit
                </button>
              )}
            </>
          ) : <p className="text-xs text-muted-foreground italic">No brand DNA configured.</p>}
        </ConfigCard>

        <ConfigCard icon={<Swords className="h-4 w-4" />} title="Competitors"
          summary={`${competitors.length} tracked`}
          expanded={expandedCard === "competitors"} onToggle={() => toggle("competitors")} onEdit={() => onEdit("competitors")}
          hasDot={dirtySections.has("competitors")}>
          {competitors.length === 0
            ? <p className="text-xs text-muted-foreground italic">No competitors added.</p>
            : <div className="space-y-1">
                {competitors.slice(0, 3).map((c) => <p key={c.id} className="text-xs text-[#0D0437]">{c.name}</p>)}
                {competitors.length > 3 && (
                  <button onClick={() => onEdit("competitors")} className="text-xs text-[#6B7280] hover:text-[#0D0437] mt-1 transition-colors">
                    +{competitors.length - 3} more — click to view & edit
                  </button>
                )}
              </div>}
        </ConfigCard>

        <ConfigCard icon={<Users className="h-4 w-4" />} title="Buyer Personas"
          summary={`${personas.length} ${personas.length === 1 ? "persona" : "personas"} · Generated from URL`}
          expanded={expandedCard === "personas"} onToggle={() => toggle("personas")} onEdit={() => onEdit("personas")}
          hasDot={dirtySections.has("personas")}>
          {personas.length === 0
            ? <p className="text-xs text-muted-foreground italic">No personas generated.</p>
            : <div className="space-y-2">
                {personas.slice(0, 3).map((p) => (
                  <div key={p.id}><p className="text-xs font-medium text-[#0D0437]">{p.name}</p><p className="text-xs text-muted-foreground">{p.role}</p></div>
                ))}
                {personas.length > 3 && (
                  <button onClick={() => onEdit("personas")} className="text-xs text-[#6B7280] hover:text-[#0D0437] mt-1 transition-colors">
                    +{personas.length - 3} more — click to view & edit
                  </button>
                )}
              </div>}
        </ConfigCard>

        <ConfigCard icon={<ShieldCheck className="h-4 w-4" />} title="Brand Facts"
          summary={`${verifiedFacts} verified · ${falseClaimTests} false claim ${falseClaimTests === 1 ? "test" : "tests"}`}
          expanded={expandedCard === "facts"} onToggle={() => toggle("facts")} onEdit={() => onEdit("facts")}
          hasDot={dirtySections.has("facts")}>
          {facts.length === 0
            ? <p className="text-xs text-muted-foreground italic">No brand facts added.</p>
            : <div className="space-y-1">
                {facts.slice(0, 3).map((f) => (
                  <p key={f.id} className="text-xs text-muted-foreground">
                    {f.claim.length > 60 ? `${f.claim.slice(0, 60)}…` : f.claim}
                  </p>
                ))}
                {facts.length > 3 && (
                  <button onClick={() => onEdit("facts")} className="text-xs text-[#6B7280] hover:text-[#0D0437] mt-1 transition-colors">
                    +{facts.length - 3} more — click to view & edit
                  </button>
                )}
              </div>}
        </ConfigCard>
      </div>

      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mt-1">Tracking Configuration</p>

      {/* Single white card containing models + frequency + cost */}
      <div className="bg-white border border-[#E2E8F0] rounded-lg p-4 space-y-4">
        {/* AI Models */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-[#0D0437]">AI Models</p>
          <div className="flex flex-wrap gap-2">
            {ALL_MODELS.map((m) => {
              const isSelected = selectedModels.includes(m);
              return (
                <button key={m}
                  onClick={() => setSelectedModels((prev) =>
                    isSelected ? prev.filter((x) => x !== m) : [...prev, m]
                  )}
                  className={`flex items-center gap-1 text-xs rounded-full px-3 py-1.5 cursor-pointer transition-colors ${
                    isSelected ? "bg-[#0D0437] text-white" : "bg-white border border-[#E2E8F0] text-[#6B7280]"
                  }`}
                >
                  {isSelected && <Check className="h-3 w-3 shrink-0" />}
                  {MODEL_LABELS[m]}
                </button>
              );
            })}
          </div>
        </div>

        {/* Frequency */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-[#0D0437]">Frequency</p>
          <div className="flex flex-wrap gap-2 items-start">
            {(["daily", "weekly", "monthly"] as const).map((f) => {
              const isSelected = selectedFrequency === f;
              return (
                <div key={f} className="flex flex-col items-center">
                  <button
                    onClick={() => setSelectedFrequency(f)}
                    className={`text-xs rounded-full px-3 py-1.5 cursor-pointer transition-colors ${
                      isSelected ? "bg-[#0D0437] text-white" : "bg-white border border-[#E2E8F0] text-[#6B7280]"
                    }`}
                  >
                    {f.charAt(0).toUpperCase() + f.slice(1)}
                  </button>
                  {f === "weekly" && (
                    <span className="text-[10px] text-muted-foreground text-center mt-0.5">Recommended</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Live cost estimate */}
        {(() => {
          const activeCount = queries.filter((q) => q.status !== "removed").length;
          const cost = calcMonthlyCost(activeCount, selectedModels, selectedFrequency);
          return (
            <div className="bg-[#F4F6F9] rounded-lg px-3 py-2.5 space-y-0.5">
              <p className="text-sm font-semibold text-[#0D0437]">
                ~£{cost.toFixed(2)}
                <span className="text-xs font-normal text-muted-foreground">/month</span>
              </p>
              <p className="text-xs text-muted-foreground">
                {activeCount} queries × {selectedModels.length} models × {selectedFrequency}
              </p>
            </div>
          );
        })()}
      </div>

      {/* Activate — extra top margin to breathe from the config card */}
      <div className="mt-2">
        <button
          onClick={onActivate}
          disabled={activating || selectedModels.length === 0}
          aria-label="Activate tracking and start monitoring"
          aria-busy={activating}
          className="w-full bg-gradient-to-r from-[#FF4B6E] to-[#00B4D8] text-white font-semibold py-3 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {activating
            ? <><Loader2 className="h-4 w-4 animate-spin" />Activating…</>
            : "Start Monitoring →"}
        </button>
        <p className="text-xs text-muted-foreground text-center mt-2">
          Your first Roadmap and intelligence report will be ready in ~4 hours.
        </p>
      </div>
    </div>
  );
}

// ── Inner component (needs useSearchParams) ─────────────────────────────────────

function PortfolioInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const clientId = searchParams.get("client");

  const [data, setData] = useState<PageData | null>(null);
  const [queries, setQueries] = useState<Query[]>([]);
  const [activeIntent, setActiveIntent] = useState<QueryIntent>("problem_aware");
  const [isDirty, setIsDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [activeModal, setActiveModal] = useState<ExpandedCard>(null);
  const [selectedModels, setSelectedModels] = useState<LLMModel[]>(ALL_MODELS);
  const [selectedFrequency, setSelectedFrequency] = useState<"daily" | "weekly" | "monthly">("weekly");
  const [activating, setActivating] = useState(false);
  const [dirtySections, setDirtySections] = useState<Set<"dna" | "competitors" | "personas" | "facts">>(new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [calibrationInput, setCalibrationInput] = useState("");
  const [isCalibrating, setIsCalibrating] = useState(false);

  const fetchData = useCallback(async () => {
    if (!clientId) { router.replace("/discover"); return; }
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const [
        { data: clients, error: cErr },
        { data: fetchedQueries, error: qErr },
        { data: personas, error: pErr },
        { data: competitors, error: compErr },
        { data: facts, error: fErr },
      ] = await Promise.all([
        supabase.from("clients").select("*").eq("id", clientId).limit(1),
        supabase.from("queries").select("*").eq("client_id", clientId).order("created_at"),
        supabase.from("personas").select("*").eq("client_id", clientId).order("priority"),
        supabase.from("competitors").select("*").eq("client_id", clientId).order("name"),
        supabase.from("brand_facts").select("*").eq("client_id", clientId).order("created_at"),
      ]);
      if (cErr || qErr || pErr || compErr || fErr) throw new Error("Fetch failed");
      const client = clients?.[0] ?? null;
      if (!client || (client.status !== "active" && client.status !== "onboarding")) {
        router.replace("/discover"); return;
      }
      setData({ client, personas: personas ?? [], competitors: competitors ?? [], facts: facts ?? [] });
      setQueries(fetchedQueries ?? []);
    } catch {
      setError("Something went wrong loading your query portfolio.");
    } finally {
      setLoading(false);
    }
  }, [clientId, router]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Sync tracking defaults from client record once data is loaded
  useEffect(() => {
    if (!data) return;
    if (data.client.selected_models?.length) setSelectedModels(data.client.selected_models);
    if (data.client.tracking_frequency) setSelectedFrequency(data.client.tracking_frequency);
  }, [data]);

  // Close active modal on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && activeModal) setActiveModal(null);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeModal]);

  // ── Calibration ─────────────────────────────────────────────────────────────

  // Simple keyword match to avoid a round-trip to the LLM just for intent detection.
  // Errs toward 'all' when the instruction is ambiguous — safe over-regeneration.
  function detectIntent(instruction: string): QueryIntent | "all" {
    const lower = instruction.toLowerCase();
    if (lower.includes("problem") || lower.includes("urgent") || lower.includes("broke")) return "problem_aware";
    if (lower.includes("categor") || lower.includes("compare") || lower.includes("vs ") || lower.includes("versus")) return "comparative";
    if (lower.includes("validat") || lower.includes("fact") || lower.includes("claim") || lower.includes("pricing")) return "validation";
    if (lower.includes("persona") || lower.includes("buyer") || lower.includes("audience")) return "category";
    return "all";
  }

  async function handleCalibrationApply() {
    if (!calibrationInput.trim() || !clientId) return;
    setIsCalibrating(true);
    const intent = detectIntent(calibrationInput);
    if (intent !== "all") setActiveIntent(intent);
    try {
      const res = await fetch("/api/queries/calibrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, instruction: calibrationInput, intent }),
      });
      const { queries: freshQueries, error } = await res.json();
      if (error) {
        toast.error("Calibration failed — try rephrasing your instruction");
        return;
      }
      // Merge: replace affected AI-generated intents, preserve manual and unaffected queries
      setQueries((prev) => {
        const manual = prev.filter((q) => q.manually_added);
        const unaffected = prev.filter(
          (q) => !q.manually_added && q.status !== "removed" && (intent === "all" ? false : q.intent !== intent)
        );
        return [...unaffected, ...(freshQueries as Query[]), ...manual];
      });
      setCalibrationInput("");
    } catch {
      toast.error("Calibration failed — please try again.");
    } finally {
      setIsCalibrating(false);
    }
  }

  // ── Activate handler ────────────────────────────────────────────────────────

  async function handleActivate() {
    if (!clientId || !data) return;
    setActivating(true);
    try {
      const supabase = createClient();

      // Steps 1+2: persist tracking config and mark client active
      await supabase.from("clients").update({
        selected_models: selectedModels,
        tracking_frequency: selectedFrequency,
        status: "active",
      }).eq("id", clientId);

      // Step 3: query regeneration — guarded to protect pre-seeded portfolios.
      // The generate endpoint deletes all existing queries before inserting new ones,
      // so we must skip it when active queries already exist (admin-seeded accounts).
      const { count } = await supabase
        .from("queries")
        .select("*", { count: "exact", head: true })
        .eq("client_id", clientId)
        .eq("status", "active");

      if ((count ?? 0) === 0) {
        // No queries yet (background generate from discover timed out or failed).
        // generate/route inserts as 'active' and also activates the client — but we've
        // already set status above so the client is covered either way.
        const genRes = await fetch("/api/queries/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId }),
        });
        if (!genRes.ok) {
          const { error } = await genRes.json().catch(() => ({}));
          throw new Error(error ?? "Query generation failed");
        }
      }

      // Step 4: trigger first tracking run
      await fetch("/api/inngest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "tracking/run.scheduled", data: { clientId } }),
      });

      // Step 5: navigate to dashboard
      router.push(`/dashboard/overview?client=${clientId}`);
    } catch {
      toast.error("Something went wrong. Please try again.");
      setActivating(false);
    }
  }

  // ── Modal save handlers ─────────────────────────────────────────────────────

  async function saveModalDna(dna: BrandDNA) {
    const supabase = createClient();
    await supabase.from("clients").update({ brand_dna: dna }).eq("id", clientId!);
    setData((prev) => prev ? { ...prev, client: { ...prev.client, brand_dna: dna } } : prev);
    setIsDirty(true);
    setDirtySections((prev) => new Set(prev).add("dna"));
    setActiveModal(null);
  }

  async function saveModalCompetitors(draft: Competitor[]) {
    const supabase = createClient();
    const originalIds = new Set(data!.competitors.map((c) => c.id));
    const draftIds = new Set(draft.map((c) => c.id));
    const deletedIds = [...originalIds].filter((id) => !draftIds.has(id));
    if (deletedIds.length > 0) await supabase.from("competitors").delete().in("id", deletedIds);
    if (draft.length > 0) await supabase.from("competitors").upsert(
      draft.map((c) => ({ ...c, client_id: clientId! })), { onConflict: "id" }
    );
    setData((prev) => prev ? { ...prev, competitors: draft } : prev);
    setIsDirty(true);
    setDirtySections((prev) => new Set(prev).add("competitors"));
    setActiveModal(null);
  }

  async function saveModalPersonas(draft: Persona[]) {
    const supabase = createClient();
    const originalIds = new Set(data!.personas.map((p) => p.id));
    const draftIds = new Set(draft.map((p) => p.id));
    const deletedIds = [...originalIds].filter((id) => !draftIds.has(id));
    if (deletedIds.length > 0) await supabase.from("personas").delete().in("id", deletedIds);
    if (draft.length > 0) await supabase.from("personas").upsert(
      draft.map((p) => ({ ...p, client_id: clientId! })), { onConflict: "id" }
    );
    setData((prev) => prev ? { ...prev, personas: draft } : prev);
    setIsDirty(true);
    setDirtySections((prev) => new Set(prev).add("personas"));
    setActiveModal(null);
  }

  async function saveModalFacts(draft: BrandFact[]) {
    const supabase = createClient();
    const originalIds = new Set(data!.facts.map((f) => f.id));
    const draftIds = new Set(draft.map((f) => f.id));
    const deletedIds = [...originalIds].filter((id) => !draftIds.has(id));
    if (deletedIds.length > 0) await supabase.from("brand_facts").delete().in("id", deletedIds);
    if (draft.length > 0) await supabase.from("brand_facts").upsert(
      draft.map((f) => ({ ...f, client_id: clientId! })), { onConflict: "id" }
    );
    setData((prev) => prev ? { ...prev, facts: draft } : prev);
    setIsDirty(true);
    setDirtySections((prev) => new Set(prev).add("facts"));
    setActiveModal(null);
  }

  // ── Refresh queries handler ─────────────────────────────────────────────────

  async function handleRefreshQueries() {
    if (!clientId) return;
    setIsRefreshing(true);
    try {
      // Map dirty sections to affected intent layers
      const affected = new Set<QueryIntent>();
      if (dirtySections.has("dna")) {
        affected.add("problem_aware");
        affected.add("category");
        affected.add("comparative");
        affected.add("validation");
      }
      if (dirtySections.has("competitors")) affected.add("comparative");
      if (dirtySections.has("personas")) {
        affected.add("problem_aware");
        affected.add("category");
      }
      if (dirtySections.has("facts")) affected.add("validation");

      const res = await fetch("/api/queries/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId }),
      });
      const { queries: freshQueries } = await res.json();

      // Merge: keep manual queries + unaffected AI queries, replace affected AI intents
      setQueries((prev) => {
        const manual = prev.filter((q) => q.manually_added);
        const aiGenerated = (freshQueries as Query[]).filter((q) => affected.has(q.intent));
        const unaffectedAI = prev.filter(
          (q) => !q.manually_added && !affected.has(q.intent) && q.status !== "removed"
        );
        return [...unaffectedAI, ...aiGenerated, ...manual];
      });

      setIsDirty(false);
      setDirtySections(new Set());
    } catch {
      toast.error("Failed to refresh queries — please try again.");
    } finally {
      setIsRefreshing(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-[#F4F6F9] flex flex-col overflow-y-auto">
      {/* Top bar */}
      <header className="bg-white border-b border-[#E2E8F0] shrink-0">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <span className="font-exo2 font-black text-[28px] leading-none tracking-tight text-[#0D0437]">Shadovi</span>
          <span className="text-sm text-[#6B7280]">Query Portfolio</span>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 w-full max-w-5xl mx-auto px-6">
        {loading ? <LoadingSkeleton />
          : error ? (
            <div className="flex flex-col items-center justify-center py-32 gap-4">
              <p className="text-sm text-[#374151]">{error}</p>
              <Button onClick={fetchData} size="sm" className="bg-[#0D0437] hover:bg-[#1a1150] text-white">Try again</Button>
            </div>
          ) : data ? (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,7fr)_minmax(0,3fr)] gap-6 py-8 pb-24 md:pb-8">
                <LeftPanel queries={queries} setQueries={setQueries} activeIntent={activeIntent}
                  setActiveIntent={setActiveIntent} isDirty={isDirty} isRefreshing={isRefreshing}
                  onRefresh={handleRefreshQueries} clientId={clientId!}
                  calibrationInput={calibrationInput} setCalibrationInput={setCalibrationInput}
                  isCalibrating={isCalibrating} onCalibrate={handleCalibrationApply} />
                <div className="hidden md:block">
                  <RightPanel data={data} queries={queries} onEdit={setActiveModal}
                    selectedModels={selectedModels} setSelectedModels={setSelectedModels}
                    selectedFrequency={selectedFrequency} setSelectedFrequency={setSelectedFrequency}
                    activating={activating} onActivate={handleActivate} dirtySections={dirtySections} />
                </div>
              </div>

              {/* Mobile: bottom button */}
              <div className="fixed bottom-0 left-0 right-0 px-4 py-3 bg-white border-t border-[#E2E8F0] md:hidden z-10">
                <Button onClick={() => setConfigOpen(true)} className="w-full bg-[#0D0437] hover:bg-[#1a1150] text-white">
                  Configuration
                </Button>
              </div>

              {/* Mobile: bottom sheet */}
              {configOpen && (
                <div className="fixed inset-0 z-[60] md:hidden flex flex-col justify-end">
                  <div className="absolute inset-0 bg-black/40" onClick={() => setConfigOpen(false)} />
                  <div className="relative h-[85%] bg-white rounded-t-2xl flex flex-col overflow-hidden">
                    <div className="flex items-center justify-between px-5 py-4 border-b border-[#E2E8F0] shrink-0">
                      <span className="text-sm font-semibold text-[#0D0437]">Configuration</span>
                      <button onClick={() => setConfigOpen(false)} className="text-[#6B7280] hover:text-[#0D0437] transition-colors" aria-label="Close">
                        <X className="h-5 w-5" />
                      </button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-5">
                      <RightPanel data={data} queries={queries}
                        onEdit={(section) => { setConfigOpen(false); setActiveModal(section); }}
                        selectedModels={selectedModels} setSelectedModels={setSelectedModels}
                        selectedFrequency={selectedFrequency} setSelectedFrequency={setSelectedFrequency}
                        activating={activating} onActivate={handleActivate} dirtySections={dirtySections} />
                    </div>
                  </div>
                </div>
              )}

              {/* Modals */}
              {activeModal === "dna" && (
                <DnaModal data={data} clientId={clientId!} onSave={saveModalDna} onClose={() => setActiveModal(null)} />
              )}
              {activeModal === "competitors" && (
                <CompetitorsModal data={data} clientId={clientId!} onSave={saveModalCompetitors} onClose={() => setActiveModal(null)} />
              )}
              {activeModal === "personas" && (
                <PersonasModal data={data} clientId={clientId!} onSave={saveModalPersonas} onClose={() => setActiveModal(null)} />
              )}
              {activeModal === "facts" && (
                <FactsModal data={data} clientId={clientId!} onSave={saveModalFacts} onClose={() => setActiveModal(null)} />
              )}
            </>
          ) : null}
      </div>
    </div>
  );
}

// ── Page export ─────────────────────────────────────────────────────────────────

export default function PortfolioPage() {
  return (
    <Suspense fallback={
      <div className="fixed inset-0 z-50 bg-[#F4F6F9] flex flex-col">
        <header className="bg-white border-b border-[#E2E8F0] shrink-0">
          <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
            <span className="font-exo2 font-black text-[28px] leading-none tracking-tight text-[#0D0437]">Shadovi</span>
            <span className="text-sm text-[#6B7280]">Query Portfolio</span>
          </div>
        </header>
        <div className="flex-1 w-full max-w-5xl mx-auto px-6"><LoadingSkeleton /></div>
      </div>
    }>
      <PortfolioInner />
    </Suspense>
  );
}
