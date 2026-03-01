"use client";

import { Suspense, useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Fingerprint, Swords, Users, ShieldCheck,
  X, Plus, ChevronDown, Sparkles, SendHorizonal, RefreshCw, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import type {
  Client, Persona, Competitor, BrandFact,
  BrandDNA, BrandFactCategory, RefineResponse,
} from "@/types";

// ── Constants ────────────────────────────────────────────────────────────────

const FACT_CATEGORY_LABELS: Record<BrandFactCategory, string> = {
  feature: "Feature", market: "Market", pricing: "Pricing", messaging: "Messaging",
};

const EMPTY_DNA: BrandDNA = {
  brand_name: "", category_name: "", brand_pov: "", product_description: "",
  key_products: [], industries_served: [], use_cases: [],
  likely_competitors: [], differentiators: [], strategic_battlegrounds: [],
};

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
    <div className="max-w-2xl space-y-3 py-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="bg-white rounded-xl border border-[#E2E8F0] p-5 space-y-3 animate-pulse">
          <div className="flex items-center gap-3">
            <Skeleton className="h-4 w-4 rounded" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-3 w-48" />
            </div>
            <Skeleton className="h-6 w-10 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Regen prompt dialog ───────────────────────────────────────────────────────

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

// ── Section card ──────────────────────────────────────────────────────────────

function SectionCard({ icon, title, summary, onEdit, children, expanded, onToggle }: {
  icon: React.ReactNode;
  title: string;
  summary: string;
  onEdit: () => void;
  children: React.ReactNode;
  expanded: boolean;
  onToggle: () => void;
}) {
  const cardKey = title.toLowerCase().replace(/\s+/g, "-");
  return (
    <div onClick={onToggle}
      role="button" tabIndex={0}
      aria-expanded={expanded}
      aria-controls={`card-content-${cardKey}`}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
      className="bg-white border border-[#E2E8F0] rounded-xl p-5 cursor-pointer hover:border-[#CBD5E1] transition-colors">
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
              Edit
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

// ── Inner component (needs useSearchParams) ───────────────────────────────────

function BrandProfileInner() {
  const searchParams = useSearchParams();
  const clientId = searchParams.get("client");

  const [data, setData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);
  const [showRegenPrompt, setShowRegenPrompt] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [expandedCard, setExpandedCard] = useState<ActiveModal>(null);

  const fetchData = useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const [
        { data: clients, error: cErr },
        { data: personas, error: pErr },
        { data: competitors, error: compErr },
        { data: facts, error: fErr },
      ] = await Promise.all([
        supabase.from("clients").select("*").eq("id", clientId).limit(1),
        supabase.from("personas").select("*").eq("client_id", clientId).order("priority"),
        supabase.from("competitors").select("*").eq("client_id", clientId).order("name"),
        supabase.from("brand_facts").select("*").eq("client_id", clientId).order("created_at"),
      ]);
      if (cErr || pErr || compErr || fErr) throw new Error("Fetch failed");
      const client = clients?.[0] ?? null;
      if (!client) { setError("Client not found."); return; }
      setData({ client, personas: personas ?? [], competitors: competitors ?? [], facts: facts ?? [] });
    } catch {
      setError("Something went wrong loading your brand profile.");
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Close modal on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && activeModal) setActiveModal(null);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeModal]);

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
    } catch {
      toast.error("Failed to regenerate queries — please try again.");
    } finally {
      setIsRegenerating(false);
    }
  }

  // ── Modal save handlers — call setShowRegenPrompt instead of setIsDirty ──

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

  function toggleCard(id: ActiveModal) {
    setExpandedCard((prev) => (prev === id ? null : id));
  }

  return (
    <>
      {/* In-progress banner while regeneration runs */}
      {isRegenerating && (
        <div className="mb-4 flex items-center gap-2 text-sm text-[#0D0437] bg-[#EEF2FF] border border-[#C7D2FE] rounded-lg px-4 py-2.5">
          <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
          Regenerating your query portfolio — this may take a moment…
        </div>
      )}

      <div className="max-w-2xl space-y-3">
        <SectionCard icon={<Fingerprint className="h-4 w-4" />} title="Brand DNA"
          summary={dna ? `${dna.brand_name} · ${dna.category_name} · ${dna.differentiators?.length ?? 0} differentiators` : "Not configured"}
          expanded={expandedCard === "dna"} onToggle={() => toggleCard("dna")}
          onEdit={() => setActiveModal("dna")}>
          {dna ? (
            <>
              <p className="text-xs text-muted-foreground"><span className="font-medium text-[#0D0437]">Category:</span> {dna.category_name}</p>
              <p className="text-xs text-muted-foreground"><span className="font-medium text-[#0D0437]">POV:</span> {dna.brand_pov.length > 100 ? `${dna.brand_pov.slice(0, 100)}…` : dna.brand_pov}</p>
              <p className="text-xs text-muted-foreground"><span className="font-medium text-[#0D0437]">Use cases:</span> {dna.use_cases?.length ?? 0}</p>
              <p className="text-xs text-muted-foreground"><span className="font-medium text-[#0D0437]">Differentiators:</span> {dna.differentiators?.length ?? 0}</p>
            </>
          ) : <p className="text-xs text-muted-foreground italic">No brand DNA configured.</p>}
        </SectionCard>

        <SectionCard icon={<Swords className="h-4 w-4" />} title="Competitors"
          summary={`${competitors.length} tracked`}
          expanded={expandedCard === "competitors"} onToggle={() => toggleCard("competitors")}
          onEdit={() => setActiveModal("competitors")}>
          {competitors.length === 0
            ? <p className="text-xs text-muted-foreground italic">No competitors added.</p>
            : <div className="space-y-1">{competitors.map((c) => <p key={c.id} className="text-xs text-[#0D0437]">{c.name}</p>)}</div>}
        </SectionCard>

        <SectionCard icon={<Users className="h-4 w-4" />} title="Buyer Personas"
          summary={`${personas.length} ${personas.length === 1 ? "persona" : "personas"}`}
          expanded={expandedCard === "personas"} onToggle={() => toggleCard("personas")}
          onEdit={() => setActiveModal("personas")}>
          {personas.length === 0
            ? <p className="text-xs text-muted-foreground italic">No personas generated.</p>
            : <div className="space-y-2">{personas.map((p) => (
                <div key={p.id}><p className="text-xs font-medium text-[#0D0437]">{p.name}</p><p className="text-xs text-muted-foreground">{p.role}</p></div>
              ))}</div>}
        </SectionCard>

        <SectionCard icon={<ShieldCheck className="h-4 w-4" />} title="Brand Facts"
          summary={`${verifiedFacts} verified · ${falseClaimTests} false claim ${falseClaimTests === 1 ? "test" : "tests"}`}
          expanded={expandedCard === "facts"} onToggle={() => toggleCard("facts")}
          onEdit={() => setActiveModal("facts")}>
          {facts.length === 0
            ? <p className="text-xs text-muted-foreground italic">No brand facts added.</p>
            : <div className="space-y-1">
                {facts.slice(0, 3).map((f) => (
                  <p key={f.id} className="text-xs text-muted-foreground">
                    {f.claim.length > 80 ? `${f.claim.slice(0, 80)}…` : f.claim}
                  </p>
                ))}
                {facts.length > 3 && <p className="text-xs text-muted-foreground italic">+{facts.length - 3} more</p>}
              </div>}
        </SectionCard>
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

export default function BrandProfilePage() {
  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="font-exo2 font-bold text-2xl text-[#0D0437]">Brand Profile</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Update your brand profile. Changes will prompt you to regenerate your query portfolio.
        </p>
      </div>
      <Suspense fallback={<LoadingSkeleton />}>
        <BrandProfileInner />
      </Suspense>
    </div>
  );
}
