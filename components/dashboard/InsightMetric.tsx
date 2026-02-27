"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";

export interface InsightMetricProps {
  label: string;
  value: string;
  /** Numeric percentage for the gradient bar fill (0–100). Omit to hide bar. */
  barPercent?: number | null;
  insight: string;
  sentiment: "positive" | "negative" | "neutral";
  /** Optional monospace sub-text (e.g. run timestamp) */
  meta?: string;
  /** Optional teaser link rendered below the insight text */
  navLink?: { href: string; label: string };
}

export function InsightMetric({
  label,
  value,
  barPercent,
  insight,
  meta,
  navLink,
}: InsightMetricProps) {
  return (
    <div className="bg-white border border-[#E2E8F0] rounded-lg p-5">
      {/* Label — 10px uppercase like .mbc-name */}
      <p className="text-[10px] font-bold tracking-[1.5px] uppercase text-[#6B7280] mb-3">
        {label}
      </p>

      {/* Big serif number like .mbc-pct */}
      <p className="font-serif text-[42px] font-bold text-[#0D0437] leading-none tracking-[-1px] mb-3">
        {value}
      </p>

      {/* Gradient bar like .mbc-track / .mbc-fill */}
      {barPercent != null && (
        <div className="h-[5px] bg-[#F4F6F9] rounded-full mb-3 overflow-hidden">
          <div
            className="h-full rounded-full grad-bar transition-all duration-500"
            style={{ width: `${Math.min(100, Math.max(0, barPercent))}%` }}
          />
        </div>
      )}

      {/* Insight text */}
      <p className="text-[11px] text-[#6B7280] leading-[1.65]">{insight}</p>

      {/* Optional monospace meta */}
      {meta && (
        <p className="font-mono text-[9px] text-[#6B7280] mt-1">{meta}</p>
      )}

      {/* Optional teaser nav link */}
      {navLink && (
        <Link
          href={navLink.href}
          className="flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wide text-[#9CA3AF] hover:text-[#0D0437] mt-2 transition-colors w-fit"
        >
          {navLink.label}
          <ChevronRight className="h-3 w-3" />
        </Link>
      )}
    </div>
  );
}
