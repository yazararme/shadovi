"use client";

import React, { useEffect, useState } from "react";
import { X, ChevronDown, ChevronUp, Download } from "lucide-react";
import { MarkdownBody } from "@/components/dashboard/ResponseDrawer";
import type { LLMModel, QueryIntent } from "@/types";

// ── Types ────────────────────────────────────────────────────────────────────

export interface MetricDetailRun {
  id: string;
  queryText: string;
  queryIntent: string;
  model: string;
  mentionSentiment: string | null;
  ranAt: string;
  rawResponse?: string;
  isBait?: boolean;
  baitTriggered?: boolean;
  competitorsMentioned?: string[];
}

export interface MetricDetailDrawerProps {
  title: string;
  metricValue: string;
  metricColor?: string;
  subtitle?: string;
  runs: MetricDetailRun[];
  brandName: string;
  onClose: () => void;
  csvFilenamePrefix: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const INTENT_LABEL: Record<string, string> = {
  problem_aware: "Problem-Aware",
  category:      "Category",
  comparative:   "Comparative",
  validation:    "Validation",
};

const INTENT_BADGE: Record<string, string> = {
  problem_aware: "bg-[rgba(31,182,255,0.08)] text-[#1580c0] border-[rgba(31,182,255,0.2)]",
  category:      "bg-[rgba(13,4,55,0.06)] text-[#0D0437] border-[rgba(13,4,55,0.15)]",
  comparative:   "bg-[rgba(123,94,167,0.08)] text-[#7B5EA7] border-[rgba(123,94,167,0.2)]",
  validation:    "bg-[rgba(26,143,92,0.08)] text-[#1A8F5C] border-[rgba(26,143,92,0.2)]",
};

const MODEL_LABEL: Record<string, string> = {
  "gpt-4o":            "GPT-4o",
  "claude-sonnet-4-6": "Claude",
  perplexity:          "Perplexity",
  gemini:              "Gemini",
  deepseek:            "DeepSeek",
};

const SENTIMENT_DOT: Record<string, string> = {
  positive: "bg-[#1A8F5C]",
  neutral:  "bg-[#9CA3AF]",
  negative: "bg-[#FF4B6E]",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatTimeAgo(iso: string): string {
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (h < 1) return "just now";
  if (h < 24) return `${Math.floor(h)}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function exportCSV(runs: MetricDetailRun[], filenamePrefix: string) {
  const header = ["Query", "Intent", "Model", "Sentiment", "Is Bait", "Bait Triggered", "Date", "Response Snippet"];
  const rows = runs.map((r) => {
    const snippet = r.rawResponse
      ? r.rawResponse.replace(/\n/g, " ").replace(/"/g, '""').slice(0, 300)
      : "";
    return [
      `"${(r.queryText ?? "").replace(/"/g, '""')}"`,
      INTENT_LABEL[r.queryIntent] ?? r.queryIntent,
      MODEL_LABEL[r.model] ?? r.model,
      r.mentionSentiment ? r.mentionSentiment.charAt(0).toUpperCase() + r.mentionSentiment.slice(1) : "",
      r.isBait ? "Yes" : "No",
      r.baitTriggered ? "Yes" : "No",
      r.ranAt ? new Date(r.ranAt).toISOString().slice(0, 10) : "",
      `"${snippet}"`,
    ];
  });

  const csv = [header.join(","), ...rows.map((r) => r.join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filenamePrefix}_${todayISO()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

// ── Component ────────────────────────────────────────────────────────────────

export function MetricDetailDrawer({
  title,
  metricValue,
  metricColor,
  subtitle,
  runs,
  brandName,
  onClose,
  csvFilenamePrefix,
}: MetricDetailDrawerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Slide-in animation
  useEffect(() => {
    const t = setTimeout(() => setIsOpen(true), 10);
    return () => clearTimeout(t);
  }, []);

  // Escape key to close
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") handleClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleClose() {
    setIsOpen(false);
    setTimeout(onClose, 220);
  }

  function toggleRow(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <>
      {/* Dim backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-black transition-opacity duration-200 ease-out ${
          isOpen ? "opacity-40" : "opacity-0"
        }`}
        onClick={handleClose}
        aria-hidden
      />

      {/* Drawer panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`fixed inset-y-0 right-0 z-50 flex flex-col w-[520px] max-w-[96vw] bg-white shadow-xl
          transition-transform duration-200 ease-out
          ${isOpen ? "translate-x-0" : "translate-x-full"}`}
      >
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="px-6 py-4 border-b border-[#E2E8F0] shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-[14px] font-bold text-[#0D0437] leading-snug">{title}</p>
              {subtitle && (
                <p className="text-[11px] text-[#6B7280] mt-1">{subtitle}</p>
              )}
            </div>
            <span
              className="text-[20px] font-bold leading-none shrink-0 mt-0.5"
              style={{ color: metricColor ?? "#0D0437" }}
            >
              {metricValue}
            </span>
            <button
              type="button"
              onClick={handleClose}
              className="h-7 w-7 flex items-center justify-center rounded hover:bg-[#F4F6F9] text-[#6B7280] hover:text-[#0D0437] transition-colors shrink-0"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* ── Action bar ──────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-2.5 border-b border-[#E2E8F0] shrink-0">
          <span className="text-[11px] text-[#6B7280]">
            {runs.length} query {runs.length === 1 ? "run" : "runs"}
          </span>
          <button
            type="button"
            onClick={() => exportCSV(runs, csvFilenamePrefix)}
            className="flex items-center gap-1.5 bg-[#0D0437] text-white hover:bg-[#1a1150] px-3 py-1.5 rounded-md transition-colors"
          >
            <Download className="h-3 w-3" />
            <span className="text-[10px] font-bold uppercase tracking-wide">Export CSV</span>
          </button>
        </div>

        {/* ── Scrollable query list ───────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {runs.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="text-[13px] text-[#9CA3AF]">No query runs match this metric.</p>
            </div>
          ) : (
            runs.map((run) => {
              const expanded = expandedIds.has(run.id);
              return (
                <div
                  key={run.id}
                  className="border-b border-[#E2E8F0]"
                >
                  {/* Collapsed row — always visible */}
                  <button
                    type="button"
                    onClick={() => toggleRow(run.id)}
                    className="w-full text-left px-5 py-3.5 hover:bg-[#F9FAFB] transition-colors cursor-pointer group"
                  >
                    {/* Query text */}
                    <p className={`text-[12px] font-medium text-[#0D0437] leading-snug ${expanded ? "" : "line-clamp-2"}`}>
                      &ldquo;{run.queryText}&rdquo;
                    </p>

                    {/* Meta row */}
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      {/* Intent badge */}
                      <span className={`text-[8px] font-bold uppercase tracking-[1.5px] px-1.5 py-0.5 rounded border ${INTENT_BADGE[run.queryIntent] ?? "bg-[#F4F6F9] text-[#6B7280] border-[#E2E8F0]"}`}>
                        {INTENT_LABEL[run.queryIntent] ?? run.queryIntent}
                      </span>

                      {/* Model badge */}
                      <span className="text-[8px] font-bold uppercase tracking-[1.5px] px-1.5 py-0.5 rounded border bg-[#F4F6F9] text-[#6B7280] border-[#E2E8F0]">
                        {MODEL_LABEL[run.model] ?? run.model}
                      </span>

                      {/* Sentiment dot + label */}
                      {run.mentionSentiment && run.mentionSentiment !== "not_mentioned" && (
                        <span className="flex items-center gap-1">
                          <span className={`inline-block h-1.5 w-1.5 rounded-full ${SENTIMENT_DOT[run.mentionSentiment] ?? "bg-[#9CA3AF]"}`} />
                          <span className="text-[9px] text-[#6B7280] capitalize">{run.mentionSentiment}</span>
                        </span>
                      )}

                      {/* Bait badge */}
                      {run.isBait && (
                        <span className="text-[8px] font-bold uppercase tracking-[1.5px] px-1.5 py-0.5 rounded border bg-[#FFF1F3] text-[#FF4B6E] border-[#FFD5DD]">
                          Bait
                        </span>
                      )}

                      {/* Bait triggered badge */}
                      {run.isBait && run.baitTriggered && (
                        <span className="text-[8px] font-bold uppercase tracking-[1.5px] px-1.5 py-0.5 rounded border bg-[rgba(255,75,110,0.12)] text-[#FF4B6E] border-[rgba(255,75,110,0.3)]">
                          Triggered
                        </span>
                      )}

                      {/* Expand/collapse indicator + timestamp pushed right */}
                      <span className="ml-auto flex items-center gap-2">
                        <span className="text-[10px] text-[#9CA3AF]">{formatTimeAgo(run.ranAt)}</span>
                        {expanded
                          ? <ChevronUp className="h-3 w-3 text-[#9CA3AF]" />
                          : <ChevronDown className="h-3 w-3 text-[#9CA3AF]" />}
                      </span>
                    </div>
                  </button>

                  {/* Expanded: response body */}
                  {expanded && (
                    <div className="px-5 pb-4">
                      <div className="bg-[#F9FAFB] rounded-lg p-4 max-h-[300px] overflow-y-auto">
                        {run.rawResponse?.trim() ? (
                          <MarkdownBody
                            text={run.rawResponse}
                            brandName={brandName}
                            competitorNames={run.competitorsMentioned ?? []}
                          />
                        ) : (
                          <p className="text-[11px] text-[#9CA3AF] italic">No response data available</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
