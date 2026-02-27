"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SendHorizonal, Sparkles } from "lucide-react";
import type { BrandDNA, Persona, RefineResponse } from "@/types";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface Props {
  clientId: string;
  brandDNA: BrandDNA;
  personas: Persona[];
  onFieldUpdate: (field: RefineResponse["updatedField"], value: unknown) => void;
  section?: "brand" | "battlegrounds" | "personas";
}

const SECTION_LABELS: Record<string, string> = {
  brand: "Brand Calibration",
  battlegrounds: "Battlegrounds Calibration",
  personas: "Personas Calibration",
};


const SECTION_PLACEHOLDERS: Record<string, string> = {
  brand: "e.g. We're not 'energy software,' we're compliance-first infrastructure",
  battlegrounds: "e.g. Add 'SMB vs enterprise pricing' as a key competitive tension",
  personas: "e.g. Remove the CTO persona — our buyers are always VP of Ops",
};

const SECTION_INTROS: Record<string, string> = {
  brand: "Tell me anything that's off about the brand identity — wrong category, POV, use cases, or differentiators. I'll update the profile on the left.",
  battlegrounds: "These are your strategic battlegrounds — the competitive contexts where you should be winning AI narrative. Tell me what's missing or wrong.",
  personas: "These are your synthetic buyer personas. Tell me if any persona doesn't fit, or if you need a different role added. I'll update the list on the left.",
};

const SECTION_CHIPS: Record<string, string[]> = {
  brand: [
    "Sharpen the category name",
    "Rewrite the brand POV",
    "Update our key differentiators",
  ],
  battlegrounds: [
    "Add a pricing battleground",
    "Add an enterprise vs SMB angle",
    "Remove the weakest battleground",
  ],
  personas: [
    "Add a VP of Operations persona",
    "Remove the most generic persona",
    "Sharpen pain points for each persona",
  ],
};

export function RefinementChat({ clientId, brandDNA, personas, onFieldUpdate, section }: Props) {
  const key = section ?? "brand";
  const intro = SECTION_INTROS[key];

  const [messages, setMessages] = useState<Message[]>([{ role: "assistant", content: intro }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend(overrideText?: string) {
    const msg = (overrideText ?? input).trim();
    if (!msg || loading) return;

    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: msg }]);
    setLoading(true);

    try {
      const response = await fetch("/api/personas/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          message: msg,
          currentProfile: { brandDNA, personas },
          section,
        }),
      });

      const data: RefineResponse | { error: string } = await response.json();

      if ("error" in data) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `Sorry, something went wrong: ${data.error}` },
        ]);
        return;
      }

      setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);

      if (data.updatedField && data.updatedValue !== null) {
        onFieldUpdate(data.updatedField, data.updatedValue);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Network error — please try again." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const chips = SECTION_CHIPS[key] ?? [];

  return (
    <div className="flex flex-col h-full border border-[#E2E8F0] rounded-xl bg-white overflow-hidden shadow-sm">
      {/* Header */}
      <div className="px-4 py-3 bg-[#0D0437] shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles className="h-3 w-3 text-[rgba(255,255,255,0.5)]" />
          <span className="text-[13px] font-bold tracking-wide text-white">
            {SECTION_LABELS[key]}
          </span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[90%] rounded-xl px-3.5 py-2.5 text-[12px] leading-relaxed ${
                msg.role === "user"
                  ? "bg-[#0D0437] text-white"
                  : "bg-[#F4F6F9] text-[#1A1A2E] border border-[#E2E8F0]"
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-[#F4F6F9] border border-[#E2E8F0] rounded-xl px-3.5 py-2.5">
              <span className="text-[12px] text-[#9CA3AF] animate-pulse">Thinking…</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Quick-action chips */}
      {!input && !loading && (
        <div className="px-3 pb-2 flex flex-wrap gap-1.5 shrink-0">
          {chips.map((chip) => (
            <button
              key={chip}
              onClick={() => handleSend(chip)}
              className="text-[10px] font-medium px-2.5 py-1 rounded-full border border-[#E2E8F0] text-[#6B7280] hover:border-[#0D0437] hover:text-[#0D0437] bg-white transition-colors"
            >
              {chip}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="p-3 border-t border-[#E2E8F0] flex gap-2 items-end bg-[#FAFAFA] shrink-0">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={SECTION_PLACEHOLDERS[key]}
          className="resize-none min-h-[56px] max-h-[120px] text-[12px] border-[#E2E8F0] focus-visible:ring-[#0D0437] bg-white"
          disabled={loading}
        />
        <Button
          size="icon"
          onClick={() => handleSend()}
          disabled={!input.trim() || loading}
          className="shrink-0 h-9 w-9 bg-[#0D0437] hover:bg-[#1a1150] text-white"
        >
          <SendHorizonal className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
