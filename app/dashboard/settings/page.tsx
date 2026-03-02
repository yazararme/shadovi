"use client";

import { Suspense, useState, useEffect, useCallback, useRef } from "react";
import { useClientContext } from "@/context/ClientContext";
import { createClient } from "@/lib/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { QueryCard } from "@/components/onboarding/QueryCard";
import {
  Fingerprint, Swords, Users, ShieldCheck,
  X, Plus, ChevronDown, Check, Sparkles, SendHorizonal, RefreshCw, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import type {
  Client, Query, Persona, Competitor, BrandFact,
  BrandDNA, BrandFactCategory, RefineResponse, LLMModel, QueryIntent,
} from "@/types";

// ── Constants ────────────────────────────────────────────────────────────────

const INTENTS: { key: QueryIntent; label: string }[] = [
  { key: "problem_aware", label: "Problem-Aware" },
  { key: "category",      label: "Category" },
  { key: "comparative",   label: "Comparative" },
  { key: "validation",    label: "Validation" },
];

const FACT_CATEGORY_LABELS: Record<BrandFactCategory, string> = {
  feature: "Feature", market: "Market", pricing: "Pricing", messaging: "Messaging",
};

// Cost per query-model pair (USD, blended estimate at ~500 tokens in / ~300 out)
const MODEL_COSTS_USD: Record<LLMModel, number> = {
  "gpt-4o":            0.0068,
  "claude-sonnet-4-6": 0.0054,
  "perplexity":        0.0016,
  "gemini":            0.00019,
  "deepseek":          0.00021,
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

const EMPTY_DNA: BrandDNA = {
  brand_name: "", category_name: "", brand_pov: "", product_description: "",
  key_products: [], industries_served: [], use_cases: [],
  likely_competitors: [], differentiators: [], strategic_battlegrounds: [],
};

function calcMonthlyCost(
  queryCount: number,
  models: LLMModel[],
  frequency: "daily" | "weekly" | "monthly",
): number {
  const runsPerMonth = { daily: 30, weekly: 4, monthly: 1 }[frequency];
  const totalUSD = models.reduce((sum, m) => sum + (MODEL_COSTS_USD[m] ?? 0), 0);
  return queryCount * totalUSD * runsPerMonth * GBP_RATE;
}

// ── Types ────────────────────────────────────────────────────────────────────

interface PageData {
  client: Client;
  personas: Persona[];
  competitors: Competitor[];
  facts: BrandFact[];
}

type ActiveModal = "dna" | "competitors" | "personas" | "facts" | null;

// ── Loading skeleton ──────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,7fr)_minmax(0,3fr)] gap-6 py-4">
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

// ── Regen prompt ──────────────────────────────────────────────────────────────

function RegenPrompt({ onRegenerate, onDismiss, isRegenerating }: {
  onRegenerate: () => void;
  onDismiss: () => void;
  isRegenerating: boolean;
}) {
  return (
    <div className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <h3 className="font-exo2 font-bold text-lg text-[#0D0437]">Regenerate queries?</h3>
        <p className="text-sm text-muted-foreground">
          Your brand profile has changed. Regenerating will replace all AI-generated queries with
          a fresh set tailored to your updated profile. Manually added queries are preserved.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onDismiss} disabled={isRegenerating}
            className="border-[#E2E8F0]">
            Keep current queries
          </Button>
          <Button size="sm" onClick={onRegenerate} disabled={isRegenerating}
            className="bg-[#0D0437] hover:bg-[#1a1150] text-white">
            {isRegenerating
              ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Regenerating…</>
              : <><RefreshCw className="h-3.5 w-3.5 mr-1.5" />Regenerate queries</>}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── AI command bar ────────────────────────────────────────────────────────────

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

// ── Shared modal shell ────────────────────────────────────────────────────────

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
        <div className="flex items-start justify-between px-6 py-5 border-b border-[#E2E8F0] shrink-0">
          <div>
            <h3 id="modal-title" className="font-exo2 font-bold text-lg text-[#0D0437]">{title}</h3>
            <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-[#0D0437] transition-colors ml-4 mt-0.5">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {children}
        </div>
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

// ── Brand DNA modal ───────────────────────────────────────────────────────────

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
      <div>
        <label className="text-xs font-medium text-[#6B7280] uppercase tracking-wider block mb-1.5">Brand Name</label>
        <input value={draft.brand_name}
          onChange={(e) => setDraft((p) => ({ ...p, brand_name: e.target.value }))}
          className="w-full text-sm border border-[#E2E8F0] rounded-lg px-3 py-2 outline-none focus:border-[#0D0437] focus:ring-2 focus:ring-[#0D0437]/10" />
      </div>
      <div>
        <label className="text-xs font-medium text-[#6B7280] uppercase tracking-wider block mb-1.5">Category</label>
        <input value={draft.category_name}
          onChange={(e) => setDraft((p) => ({ ...p, category_name: e.target.value }))}
          className="w-full text-sm border border-[#E2E8F0] rounded-lg px-3 py-2 outline-none focus:border-[#0D0437] focus:ring-2 focus:ring-[#0D0437]/10" />
      </div>
      <div>
        <label className="text-xs font-medium text-[#6B7280] uppercase tracking-wider block mb-1.5">Brand POV</label>
        <textarea value={draft.brand_pov} rows={3}
          onChange={(e) => setDraft((p) => ({ ...p, brand_pov: e.target.value }))}
          className="w-full text-sm border border-[#E2E8F0] rounded-lg px-3 py-2 outline-none focus:border-[#0D0437] focus:ring-2 focus:ring-[#0D0437]/10 resize-none" />
      </div>
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

// ── Competitors modal ─────────────────────────────────────────────────────────

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

  return (
    <ModalShell title="Competitors" subtitle="Review your tracked competitors" onClose={onClose} onSave={handleSave} saving={saving}>
      <div className="flex-1 overflow-y-auto p-6 space-y-3">
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
      <div className="px-6 pb-3 shrink-0">
        <AICommandBar clientId={clientId} brandDNA={data.client.brand_dna} personas={data.personas} section="competitors"
          intro="Add, remove, or update your tracked competitors…"
          chips={["Add a missing competitor", "Remove the weakest match", "Add context to an unrecognised competitor"]} />
      </div>
    </ModalShell>
  );
}

// ── Personas modal ────────────────────────────────────────────────────────────

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

  return (
    <ModalShell title="Buyer Personas" subtitle="Review your synthetic buyer personas" onClose={onClose} onSave={handleSave} saving={saving}>
      <div className="flex-1 overflow-y-auto p-6 space-y-3">
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
      <div className="px-6 pb-3 shrink-0">
        <AICommandBar clientId={clientId} brandDNA={data.client.brand_dna} personas={draft} section="personas"
          intro="Ask me to update your buyer personas…"
          chips={["Remove the most generic persona", "Sharpen pain points", "Add a missing buyer role"]} />
      </div>
    </ModalShell>
  );
}

// ── Brand Facts modal ─────────────────────────────────────────────────────────

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

  return (
    <ModalShell title="Brand Facts" subtitle="Review your brand facts and false claim tests" onClose={onClose} onSave={handleSave} saving={saving}>
      <div className="flex-1 overflow-y-auto p-6 space-y-5">
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
      <div className="px-6 pb-3 shrink-0">
        <AICommandBar clientId={clientId} brandDNA={data.client.brand_dna} personas={data.personas} section="facts"
          intro="Ask me to add, remove, or correct brand facts…"
          chips={["Add a missing feature claim", "Suggest false claim tests", "Remove a weak fact"]} />
      </div>
    </ModalShell>
  );
}

// ── Config card (right panel) ─────────────────────────────────────────────────

function ConfigCard({ icon, title, summary, expanded, onToggle, onEdit, children }: {
  icon: React.ReactNode;
  title: string;
  summary: string;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  children: React.ReactNode;
}) {
  const cardKey = title.toLowerCase().replace(/\s+/g, "-");
  return (
    <div onClick={onToggle}
      role="button" tabIndex={0}
      aria-expanded={expanded}
      aria-controls={`settings-card-${cardKey}`}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
      className="bg-white border border-[#E2E8F0] rounded-lg p-4 cursor-pointer hover:border-[#CBD5E1] transition-colors">
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
        <div id={`settings-card-${cardKey}`} role="region" aria-label={`${title} details`}
          className="mt-3 pt-3 border-t border-[#E2E8F0] space-y-1" onClick={(e) => e.stopPropagation()}>
          {children}
        </div>
      )}
    </div>
  );
}

// ── Left panel ────────────────────────────────────────────────────────────────

function LeftPanel({ queries, setQueries, activeIntent, setActiveIntent, clientId, calibrationInput, setCalibrationInput, isCalibrating, onCalibrate }: {
  queries: Query[];
  setQueries: React.Dispatch<React.SetStateAction<Query[]>>;
  activeIntent: QueryIntent;
  setActiveIntent: (intent: QueryIntent) => void;
  clientId: string;
  calibrationInput: string;
  setCalibrationInput: React.Dispatch<React.SetStateAction<string>>;
  isCalibrating: boolean;
  onCalibrate: () => void;
}) {
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
    setQueries((prev) => prev.map((q) => q.id === id ? { ...q, status: "removed" } : q));
    const supabase = createClient();
    supabase.from("queries").update({ status: "removed" }).eq("id", id);
  }

  async function handleTextChange(id: string, text: string) {
    setQueries((prev) => prev.map((q) => q.id === id ? { ...q, text } : q));
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
      status: "active",
    }).select().single();
    if (error || !data) { toast.error("Failed to add query"); return; }
    setQueries((prev) => [...prev, data as Query]);
    handleCancelAddQuery();
  }

  function handleTabKeyDown(e: React.KeyboardEvent) {
    const intents: QueryIntent[] = ["problem_aware", "category", "comparative", "validation"];
    const current = intents.indexOf(activeIntent);
    if (e.key === "ArrowRight") { e.preventDefault(); setActiveIntent(intents[(current + 1) % intents.length]); }
    if (e.key === "ArrowLeft") { e.preventDefault(); setActiveIntent(intents[(current - 1 + intents.length) % intents.length]); }
  }

  return (
    <div className="flex flex-col bg-white rounded-xl border border-[#E2E8F0] overflow-hidden">
      <div className="px-5 pt-5 pb-4">
        <h2 className="font-exo2 font-bold text-xl text-[#0D0437] leading-tight">Query Portfolio</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          {totalActive} {totalActive === 1 ? "query" : "queries"} · {intentLayerCount} intent {intentLayerCount === 1 ? "layer" : "layers"}
        </p>
      </div>
      <div role="tablist" aria-label="Query intent filters" onKeyDown={handleTabKeyDown}
        className="flex border-b border-[#E2E8F0] px-5 gap-0 overflow-x-auto">
        {INTENTS.map(({ key, label }) => {
          const isActive = activeIntent === key;
          return (
            <button key={key} onClick={() => setActiveIntent(key)}
              role="tab" aria-selected={isActive}
              aria-controls={`querylist-settings-${key}`} id={`tab-settings-${key}`}
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
      <div role="tabpanel" id={`querylist-settings-${activeIntent}`} aria-labelledby={`tab-settings-${activeIntent}`}
        tabIndex={0} className="flex-1 px-4 py-4 space-y-2">
        {visibleQueries.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">No queries yet for this intent.</p>
        )}
        {visibleQueries.map((query) => (
          <QueryCard key={query.id} query={query} onRemove={handleRemove} onTextChange={handleTextChange} autoEdit={false} />
        ))}
        {/* Inline add form */}
        {addingQueryForIntent === activeIntent && (
          <div className="border border-[#E2E8F0] rounded-lg p-4 space-y-3 bg-[#F9FAFB]">
            <textarea
              autoFocus rows={2}
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
      {/* Calibration bar — sticky to bottom of panel */}
      <div className="sticky bottom-0 bg-white border-t border-[#E2E8F0] px-4 py-3">
        <div className="bg-[#F5F3FF] rounded-xl p-4 space-y-2.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#0D0437]">Fine-tune your portfolio</p>
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

// ── Inner component ───────────────────────────────────────────────────────────

function SettingsInner() {
  const { activeClientId: clientId } = useClientContext();

  const [data, setData] = useState<PageData | null>(null);
  const [queries, setQueries] = useState<Query[]>([]);
  const [activeIntent, setActiveIntent] = useState<QueryIntent>("problem_aware");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);
  const [showRegenPrompt, setShowRegenPrompt] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [expandedCard, setExpandedCard] = useState<ActiveModal>(null);

  // Tracking config — initialised from client data after fetch
  const [selectedModels, setSelectedModels] = useState<LLMModel[]>(ALL_MODELS);
  const [selectedFrequency, setSelectedFrequency] = useState<"daily" | "weekly" | "monthly">("weekly");
  const [savingTracking, setSavingTracking] = useState(false);

  // Run now
  const [running, setRunning] = useState(false);

  // Calibration
  const [calibrationInput, setCalibrationInput] = useState("");
  const [isCalibrating, setIsCalibrating] = useState(false);

  const fetchData = useCallback(async () => {
    if (!clientId) return;
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
        supabase.from("queries").select("*").eq("client_id", clientId).neq("status", "removed").order("created_at"),
        supabase.from("personas").select("*").eq("client_id", clientId).order("priority"),
        supabase.from("competitors").select("*").eq("client_id", clientId).order("name"),
        supabase.from("brand_facts").select("*").eq("client_id", clientId).order("created_at"),
      ]);
      if (cErr || qErr || pErr || compErr || fErr) throw new Error("Fetch failed");
      const client = clients?.[0] ?? null;
      if (!client) { setError("Client not found."); return; }
      setData({ client, personas: personas ?? [], competitors: competitors ?? [], facts: facts ?? [] });
      setQueries(fetchedQueries ?? []);
      setSelectedModels((client.selected_models as LLMModel[]) ?? ALL_MODELS);
      setSelectedFrequency(client.tracking_frequency ?? "weekly");
    } catch {
      setError("Something went wrong loading your settings.");
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && activeModal) setActiveModal(null);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeModal]);

  // Auto-save tracking config immediately when models/frequency are toggled
  async function saveTrackingWith(models: LLMModel[], freq: "daily" | "weekly" | "monthly") {
    if (!clientId || models.length === 0) return;
    setSavingTracking(true);
    try {
      const supabase = createClient();
      await supabase.from("clients")
        .update({ selected_models: models, tracking_frequency: freq })
        .eq("id", clientId);
    } catch {
      toast.error("Failed to save tracking settings");
    } finally {
      setSavingTracking(false);
    }
  }

  async function handleRegenerate() {
    if (!clientId) return;
    setIsRegenerating(true);
    try {
      const res = await fetch("/api/queries/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId }),
      });
      const { error: genError } = await res.json();
      if (genError) { toast.error("Failed to regenerate queries"); return; }
      toast.success("Queries regenerated successfully");
      setShowRegenPrompt(false);
      // Refresh the query list to show newly generated queries
      const supabase = createClient();
      const { data: freshQueries } = await supabase
        .from("queries").select("*").eq("client_id", clientId).neq("status", "removed").order("created_at");
      setQueries(freshQueries ?? []);
    } catch {
      toast.error("Failed to regenerate queries — please try again.");
    } finally {
      setIsRegenerating(false);
    }
  }

  async function handleRunNow() {
    if (!clientId) return;
    setRunning(true);
    try {
      const res = await fetch("/api/tracking/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId }),
      });
      const body = await res.json();
      if (res.ok) {
        toast.success("Tracking run queued — check back in a few minutes.");
      } else {
        toast.error(body.error ?? "Failed to queue run");
      }
    } catch {
      toast.error("Network error — try again");
    } finally {
      setRunning(false);
    }
  }

  // Simple keyword match to avoid a round-trip to the LLM just for intent detection
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
      if (error) { toast.error("Calibration failed — try rephrasing your instruction"); return; }
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

  // ── Modal save handlers ───────────────────────────────────────────────────

  async function saveModalDna(dna: BrandDNA) {
    const supabase = createClient();
    await supabase.from("clients").update({ brand_dna: dna }).eq("id", clientId!);
    setData((prev) => prev ? { ...prev, client: { ...prev.client, brand_dna: dna } } : prev);
    setActiveModal(null);
    setShowRegenPrompt(true);
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
    setActiveModal(null);
    setShowRegenPrompt(true);
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
    setActiveModal(null);
    setShowRegenPrompt(true);
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
    setActiveModal(null);
    setShowRegenPrompt(true);
  }

  if (loading) return <LoadingSkeleton />;
  if (error || !data) return (
    <div className="py-32 text-center">
      <p className="text-sm text-[#374151]">{error ?? "No client selected."}</p>
    </div>
  );

  const { client, competitors, personas, facts } = data;
  const dna = client.brand_dna;
  const verifiedFacts = facts.filter((f) => f.is_true).length;
  const falseClaimTests = facts.filter((f) => !f.is_true).length;
  const activeQueryCount = queries.filter((q) => q.status !== "removed").length;
  const monthlyCost = calcMonthlyCost(activeQueryCount, selectedModels, selectedFrequency);

  function toggleCard(id: ActiveModal) {
    setExpandedCard((prev) => (prev === id ? null : id));
  }

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,7fr)_minmax(0,3fr)] gap-6">
        {/* Left panel — query portfolio */}
        <LeftPanel
          queries={queries} setQueries={setQueries}
          activeIntent={activeIntent} setActiveIntent={setActiveIntent}
          clientId={clientId!}
          calibrationInput={calibrationInput} setCalibrationInput={setCalibrationInput}
          isCalibrating={isCalibrating} onCalibrate={handleCalibrationApply}
        />

        {/* Right panel — config + tracking + actions */}
        <div className="flex flex-col gap-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Query Configuration</p>

          <div className="flex flex-col gap-3">
            {/* Brand DNA */}
            <ConfigCard
              icon={<Fingerprint className="h-4 w-4" />}
              title="Brand DNA"
              summary={dna ? `${dna.brand_name} · ${dna.category_name} · ${dna.differentiators?.length ?? 0} differentiators` : "Not configured"}
              expanded={expandedCard === "dna"}
              onToggle={() => toggleCard("dna")}
              onEdit={() => setActiveModal("dna")}>
              {dna ? (
                <>
                  <p className="text-xs text-muted-foreground"><span className="font-medium text-[#0D0437]">Category:</span> {dna.category_name}</p>
                  <p className="text-xs text-muted-foreground"><span className="font-medium text-[#0D0437]">POV:</span> {dna.brand_pov.length > 80 ? `${dna.brand_pov.slice(0, 80)}…` : dna.brand_pov}</p>
                  {(dna.use_cases ?? []).slice(0, 2).map((uc, i) => (
                    <p key={i} className="text-xs text-muted-foreground"><span className="font-medium text-[#0D0437]">Use case:</span> {uc}</p>
                  ))}
                  {(dna.differentiators ?? []).slice(0, 2).map((d, i) => (
                    <p key={i} className="text-xs text-muted-foreground"><span className="font-medium text-[#0D0437]">Diff:</span> {d}</p>
                  ))}
                </>
              ) : <p className="text-xs text-muted-foreground italic">No brand DNA configured.</p>}
            </ConfigCard>

            {/* Competitors */}
            <ConfigCard
              icon={<Swords className="h-4 w-4" />}
              title="Competitors"
              summary={`${competitors.length} tracked`}
              expanded={expandedCard === "competitors"}
              onToggle={() => toggleCard("competitors")}
              onEdit={() => setActiveModal("competitors")}>
              {competitors.length === 0
                ? <p className="text-xs text-muted-foreground italic">No competitors added.</p>
                : <div className="space-y-1">
                    {competitors.slice(0, 3).map((c) => <p key={c.id} className="text-xs text-[#0D0437]">{c.name}</p>)}
                    {competitors.length > 3 && <p className="text-xs text-muted-foreground">+{competitors.length - 3} more</p>}
                  </div>}
            </ConfigCard>

            {/* Buyer Personas */}
            <ConfigCard
              icon={<Users className="h-4 w-4" />}
              title="Buyer Personas"
              summary={`${personas.length} ${personas.length === 1 ? "persona" : "personas"}`}
              expanded={expandedCard === "personas"}
              onToggle={() => toggleCard("personas")}
              onEdit={() => setActiveModal("personas")}>
              {personas.length === 0
                ? <p className="text-xs text-muted-foreground italic">No personas generated.</p>
                : <div className="space-y-2">
                    {personas.slice(0, 3).map((p) => (
                      <div key={p.id}>
                        <p className="text-xs font-medium text-[#0D0437]">{p.name}</p>
                        <p className="text-xs text-muted-foreground">{p.role}</p>
                      </div>
                    ))}
                    {personas.length > 3 && <p className="text-xs text-muted-foreground">+{personas.length - 3} more</p>}
                  </div>}
            </ConfigCard>

            {/* Brand Facts */}
            <ConfigCard
              icon={<ShieldCheck className="h-4 w-4" />}
              title="Brand Facts"
              summary={`${verifiedFacts} verified · ${falseClaimTests} false claim ${falseClaimTests === 1 ? "test" : "tests"}`}
              expanded={expandedCard === "facts"}
              onToggle={() => toggleCard("facts")}
              onEdit={() => setActiveModal("facts")}>
              {facts.length === 0
                ? <p className="text-xs text-muted-foreground italic">No brand facts added.</p>
                : <div className="space-y-1">
                    {facts.slice(0, 3).map((f) => (
                      <p key={f.id} className="text-xs text-muted-foreground">
                        {f.claim.length > 60 ? `${f.claim.slice(0, 60)}…` : f.claim}
                      </p>
                    ))}
                    {facts.length > 3 && <p className="text-xs text-muted-foreground">+{facts.length - 3} more</p>}
                  </div>}
            </ConfigCard>
          </div>

          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mt-1">Tracking Configuration</p>

          {/* Tracking config card — auto-saves on toggle */}
          <div className="bg-white border border-[#E2E8F0] rounded-lg p-4 space-y-4">
            <div className="space-y-2">
              <p className="text-xs font-medium text-[#0D0437]">AI Models</p>
              <div className="flex flex-wrap gap-2">
                {ALL_MODELS.map((m) => {
                  const isSelected = selectedModels.includes(m);
                  return (
                    <button key={m}
                      onClick={() => {
                        const newModels = isSelected
                          ? selectedModels.filter((x) => x !== m)
                          : [...selectedModels, m];
                        setSelectedModels(newModels);
                        saveTrackingWith(newModels, selectedFrequency);
                      }}
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

            <div className="space-y-2">
              <p className="text-xs font-medium text-[#0D0437]">Frequency</p>
              <div className="flex flex-wrap gap-2 items-start">
                {(["daily", "weekly", "monthly"] as const).map((f) => {
                  const isSelected = selectedFrequency === f;
                  return (
                    <div key={f} className="flex flex-col items-center">
                      <button
                        onClick={() => {
                          setSelectedFrequency(f);
                          saveTrackingWith(selectedModels, f);
                        }}
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
            <div className="bg-[#F4F6F9] rounded-lg px-3 py-2.5 space-y-0.5">
              <p className="text-sm font-semibold text-[#0D0437]">
                ~£{monthlyCost.toFixed(2)}
                <span className="text-xs font-normal text-muted-foreground">/month</span>
                {savingTracking && <Loader2 className="inline h-3 w-3 ml-1.5 animate-spin text-muted-foreground" />}
              </p>
              <p className="text-xs text-muted-foreground">
                {activeQueryCount} queries × {selectedModels.length} models × {selectedFrequency}
              </p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-col gap-2 mt-1">
            <button
              onClick={() => setShowRegenPrompt(true)}
              disabled={isRegenerating}
              className="flex items-center justify-center gap-2 w-full text-sm font-medium text-[#0D0437] border border-[#E2E8F0] hover:border-[#0D0437] bg-white rounded-lg py-2.5 transition-colors disabled:opacity-50">
              <RefreshCw className="h-3.5 w-3.5" />
              Regenerate Queries
            </button>
            <button
              onClick={handleRunNow}
              disabled={running}
              className="flex items-center justify-center gap-2 w-full text-sm font-semibold text-white bg-[#0D0437] hover:bg-[#1a1150] rounded-lg py-2.5 transition-colors disabled:opacity-50">
              {running
                ? <><Loader2 className="h-4 w-4 animate-spin" />Queuing…</>
                : "Run now →"}
            </button>
          </div>
        </div>
      </div>

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

      {/* Regeneration prompt */}
      {showRegenPrompt && (
        <RegenPrompt
          onRegenerate={handleRegenerate}
          onDismiss={() => setShowRegenPrompt(false)}
          isRegenerating={isRegenerating}
        />
      )}
    </>
  );
}

// ── Page export ───────────────────────────────────────────────────────────────

export default function SettingsPage() {
  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="font-exo2 font-bold text-2xl text-[#0D0437]">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your query portfolio and brand profile. Profile changes will prompt you to regenerate queries.
        </p>
      </div>
      <Suspense fallback={<LoadingSkeleton />}>
        <SettingsInner />
      </Suspense>
    </div>
  );
}
