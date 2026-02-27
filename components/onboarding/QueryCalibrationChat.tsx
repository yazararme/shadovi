"use client";

import { useState, useRef, useEffect } from "react";
import { SendHorizonal, Sparkles } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import type { Query, QueryIntent, BrandDNA } from "@/types";

interface Message {
  role: "user" | "assistant";
  content: string;
  // How many queries were added/removed as a result of this assistant message
  addCount?: number;
  removeCount?: number;
}

interface Props {
  clientId: string;
  brandDNA: BrandDNA | null;
  currentQueries: Query[];
  activeIntent: QueryIntent;
  onAdd: (queries: Query[]) => void;
  onRemove: (ids: string[]) => void;
}

const INTENT_LABELS: Record<QueryIntent, string> = {
  problem_aware: "Problem-Aware",
  category: "Category",
  comparative: "Comparative",
  validation: "Validation",
};

// Intent-specific suggestions so the chip text always matches what the user sees on screen
const intentChip = (intent: QueryIntent) => `Add 3 ${INTENT_LABELS[intent]} queries`;

const STATIC_CHIPS = [
  "Make these more specific to our differentiators",
  "Balance intent coverage across all 4 layers",
];

export function QueryCalibrationChat({
  clientId,
  brandDNA,
  currentQueries,
  activeIntent,
  onAdd,
  onRemove,
}: Props) {
  const intro = `Your query portfolio shapes exactly what LLMs surface when buyers search your category. Tell me what's off — too generic, wrong angle, missing buyer moments — and I'll update the list on the left.`;

  const [messages, setMessages] = useState<Message[]>([{ role: "assistant", content: intro }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const activeCount = currentQueries.filter((q) => q.status !== "removed").length;

  async function handleSend(overrideText?: string) {
    const msg = (overrideText ?? input).trim();
    if (!msg || loading) return;

    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: msg }]);
    setLoading(true);

    try {
      const res = await fetch("/api/queries/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          message: msg,
          currentQueries: currentQueries.map((q) => ({
            id: q.id,
            text: q.text,
            intent: q.intent,
            status: q.status,
          })),
          activeIntent,
          brandDNA,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `Something went wrong: ${data.error}` },
        ]);
        return;
      }

      const adds: Query[] = data.adds ?? [];
      const removes: string[] = data.removes ?? [];

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.reply,
          addCount: adds.length > 0 ? adds.length : undefined,
          removeCount: removes.length > 0 ? removes.length : undefined,
        },
      ]);

      if (adds.length > 0) onAdd(adds);
      if (removes.length > 0) onRemove(removes);
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

  const chips = [intentChip(activeIntent), ...STATIC_CHIPS];

  return (
    <div className="flex flex-col h-full border border-[#E2E8F0] rounded-xl bg-white overflow-hidden shadow-sm">
      {/* Header — dark bar establishes this as a separate tool, not part of the list */}
      <div className="px-4 py-3 bg-[#0D0437] shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles className="h-3 w-3 text-[rgba(255,255,255,0.5)]" />
          <span className="text-[13px] font-bold tracking-wide text-white">
            Query Calibration
          </span>
          <span className="text-[10px] text-[rgba(255,255,255,0.4)] ml-1">
            {INTENT_LABELS[activeIntent]} · {activeCount} active
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
            <div className="max-w-[90%] space-y-1.5">
              <div
                className={`rounded-xl px-3.5 py-2.5 text-[12px] leading-relaxed ${
                  msg.role === "user"
                    ? "bg-[#0D0437] text-white"
                    : "bg-[#F4F6F9] text-[#1A1A2E] border border-[#E2E8F0]"
                }`}
              >
                {msg.content}
              </div>

              {/* Change receipt — appears below AI messages that mutated the portfolio */}
              {msg.role === "assistant" &&
                (msg.addCount !== undefined || msg.removeCount !== undefined) && (
                  <div className="flex gap-1.5 pl-1">
                    {msg.addCount !== undefined && (
                      <span className="text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-[rgba(26,143,92,0.1)] text-[#1A8F5C] border border-[rgba(26,143,92,0.2)]">
                        +{msg.addCount} added
                      </span>
                    )}
                    {msg.removeCount !== undefined && (
                      <span className="text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-[rgba(255,75,110,0.1)] text-[#FF4B6E] border border-[rgba(255,75,110,0.2)]">
                        −{msg.removeCount} removed
                      </span>
                    )}
                  </div>
                )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-[#F4F6F9] border border-[#E2E8F0] rounded-xl px-3.5 py-2.5">
              <span className="text-[12px] text-[#9CA3AF] animate-pulse">Calibrating…</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Quick-action chips — visible when input is empty and not loading.
          These solve the cold-start problem: users know what to ask for. */}
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

      {/* Input area */}
      <div className="p-3 border-t border-[#E2E8F0] flex gap-2 items-end bg-[#FAFAFA] shrink-0">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`e.g. "The comparative queries are too generic — mention my brand vs competitors"`}
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
