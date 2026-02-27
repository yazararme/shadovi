"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Pencil } from "lucide-react";
import type { BrandDNA } from "@/types";

interface Props {
  brandDNA: BrandDNA;
  onChange: (updated: BrandDNA) => void;
}

function EditableField({
  label,
  value,
  onSave,
  multiline = false,
}: {
  label: string;
  value: string;
  onSave: (v: string) => void;
  multiline?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  function handleBlur() {
    setEditing(false);
    if (draft !== value) onSave(draft);
  }

  return (
    <div>
      <div className="flex items-center gap-1 mb-1">
        <p className="text-[11px] font-medium text-[#6B7280] uppercase tracking-wider">{label}</p>
        {!editing && (
          <Pencil
            className="h-3 w-3 text-[#9CA3AF] hover:text-[#0D0437] cursor-pointer transition-colors"
            onClick={() => { setEditing(true); setDraft(value); }}
          />
        )}
      </div>
      {editing ? (
        multiline ? (
          <Textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={handleBlur}
            className="text-sm min-h-[80px] border-[#E2E8F0] focus-visible:ring-[#0D0437]/20"
          />
        ) : (
          <Input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={handleBlur}
            className="text-sm h-7 px-2 border-[#E2E8F0] focus-visible:ring-[#0D0437]/20"
          />
        )
      ) : (
        <p
          className="text-sm text-[#0D0437] cursor-text hover:bg-[#F4F6F9] rounded px-1 py-0.5 -mx-1 transition-colors"
          onClick={() => { setEditing(true); setDraft(value); }}
        >
          {value}
        </p>
      )}
    </div>
  );
}

function EditableList({
  label,
  items,
  onSave,
}: {
  label: string;
  items: string[];
  onSave: (items: string[]) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(items.join("\n"));

  function handleBlur() {
    setEditing(false);
    const updated = draft.split("\n").map((s) => s.trim()).filter(Boolean);
    onSave(updated);
  }

  return (
    <div>
      <div className="flex items-center gap-1 mb-1">
        <p className="text-[11px] font-medium text-[#6B7280] uppercase tracking-wider">{label}</p>
        {!editing && (
          <Pencil
            className="h-3 w-3 text-[#9CA3AF] hover:text-[#0D0437] cursor-pointer transition-colors"
            onClick={() => { setEditing(true); setDraft(items.join("\n")); }}
          />
        )}
      </div>
      {editing ? (
        <Textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={handleBlur}
          className="text-xs min-h-[100px] border-[#E2E8F0] focus-visible:ring-[#0D0437]/20"
          placeholder="One item per line"
        />
      ) : (
        <ul
          onClick={() => { setEditing(true); setDraft(items.join("\n")); }}
          className="space-y-1 cursor-text"
        >
          {items.map((item, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-[#0D0437]">
              <span className="text-[#9CA3AF] mt-0.5">–</span>
              <span>{item}</span>
            </li>
          ))}
          {items.length === 0 && (
            <li className="text-xs text-[#9CA3AF] italic">Click to add…</li>
          )}
        </ul>
      )}
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-[#E2E8F0] rounded-lg bg-white p-4 space-y-3">
      <div className="flex items-center gap-3 pb-2 border-b border-[#E2E8F0]">
        <span className="text-[9px] font-bold tracking-[2.5px] uppercase text-[#6B7280] whitespace-nowrap">
          {title}
        </span>
        <div className="flex-1 h-px bg-[#E2E8F0]" />
      </div>
      {children}
    </div>
  );
}

export function BrandDNACard({ brandDNA, onChange }: Props) {
  function update<K extends keyof BrandDNA>(field: K, value: BrandDNA[K]) {
    onChange({ ...brandDNA, [field]: value });
  }

  return (
    <div className="space-y-4">
      <SectionCard title="Brand Identity">
        <EditableField
          label="Name"
          value={brandDNA.brand_name}
          onSave={(v) => update("brand_name", v)}
        />
        <EditableField
          label="Category"
          value={brandDNA.category_name}
          onSave={(v) => update("category_name", v)}
        />
        <EditableField
          label="Point of View"
          value={brandDNA.brand_pov}
          onSave={(v) => update("brand_pov", v)}
          multiline
        />
      </SectionCard>

      <SectionCard title="Use Cases">
        <EditableList
          label="Use cases"
          items={brandDNA.use_cases ?? []}
          onSave={(v) => update("use_cases", v)}
        />
      </SectionCard>

      <SectionCard title="Differentiators">
        <EditableList
          label="Differentiators"
          items={brandDNA.differentiators ?? []}
          onSave={(v) => update("differentiators", v)}
        />
      </SectionCard>
    </div>
  );
}
