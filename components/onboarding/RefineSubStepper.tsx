"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

const SUB_STEPS = [
  { path: "/refine/brand", label: "Brand DNA", number: 1 },
  { path: "/refine/battlegrounds", label: "Positioning", number: 2 },
  { path: "/refine/personas", label: "Ideal Customers", number: 3 },
];

export function RefineSubStepper() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const clientId = searchParams.get("client");

  // Only render on /refine/* sub-pages
  if (!pathname.startsWith("/refine/")) return null;

  const currentIndex = SUB_STEPS.findIndex((s) => pathname.startsWith(s.path));

  return (
    <nav className="relative flex items-center justify-center gap-2 py-3 border-t border-[#E2E8F0] bg-[#F4F6F9]">
      {/* Parent step attribution — anchors sub-steps to "Refine" visually */}
      <span className="absolute left-6 top-1/2 -translate-y-1/2 text-[10px] font-semibold tracking-widest uppercase text-[#0D0437]/30 select-none">
        Refine
      </span>
      {SUB_STEPS.map((step, i) => {
        const isComplete = i < currentIndex;
        const isCurrent = i === currentIndex;
        const isNavigable = !!clientId;

        return (
          <div key={step.path} className="flex items-center gap-2">
            <button
              onClick={() => isNavigable && router.push(`${step.path}?client=${clientId}`)}
              className={cn(
                "flex items-center gap-1.5 rounded transition-opacity",
                isNavigable ? "cursor-pointer" : "cursor-default opacity-40"
              )}
              disabled={!isNavigable}
              aria-current={isCurrent ? "step" : undefined}
            >
              {/* Sub-step circle — smaller than main stepper */}
              <div
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold border-2 transition-colors",
                  isComplete
                    ? "bg-[#0D0437] text-white border-[#0D0437]"
                    : isCurrent
                    ? "bg-white text-[#0D0437] border-[#0D0437]"
                    : "bg-white text-[#9CA3AF] border-[#E2E8F0]"
                )}
              >
                {isComplete ? (
                  <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  step.number
                )}
              </div>

              <span
                className={cn(
                  "text-[12px] transition-colors",
                  isComplete || isCurrent
                    ? "font-semibold text-[#0D0437]"
                    : "font-normal text-[#9CA3AF]"
                )}
              >
                {step.label}
              </span>
            </button>

            {i < SUB_STEPS.length - 1 && (
              <div
                className={cn(
                  "h-px w-6 ml-1 transition-colors",
                  isComplete ? "bg-[#0D0437]" : "bg-[#E2E8F0]"
                )}
              />
            )}
          </div>
        );
      })}
    </nav>
  );
}
