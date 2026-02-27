"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

const steps = [
  { path: "/discover", label: "Discover", number: 1 },
  { path: "/refine", label: "Refine", number: 2 },
  { path: "/competitors", label: "Competitors", number: 3 },
  { path: "/configure", label: "Configure", number: 4 },
];

function getTarget(path: string, clientId: string | null): string {
  if (path === "/discover") return "/discover";
  if (path === "/refine") return clientId ? `/refine/brand?client=${clientId}` : "/discover";
  if (path === "/configure") return clientId ? `/configure/models?client=${clientId}` : "/discover";
  return clientId ? `${path}?client=${clientId}` : "/discover";
}

export function OnboardingStepper() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const clientId = searchParams.get("client");

  const currentIndex = steps.findIndex((s) => pathname.startsWith(s.path));

  return (
    <nav className="flex items-center justify-center gap-2 pb-6">
      {steps.map((step, i) => {
        const isComplete = i < currentIndex;
        const isCurrent = i === currentIndex;
        const isNavigable = step.path === "/discover" || !!clientId;

        return (
          <div key={step.path} className="flex items-center gap-2">
            <button
              onClick={() => isNavigable && router.push(getTarget(step.path, clientId))}
              className={cn(
                "flex items-center gap-2 rounded transition-opacity",
                isNavigable ? "cursor-pointer" : "cursor-default opacity-40"
              )}
              disabled={!isNavigable}
              aria-current={isCurrent ? "step" : undefined}
            >
              {/* Step circle */}
              <div
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold border-2 transition-colors",
                  isComplete
                    ? "bg-[#0D0437] text-white border-[#0D0437]"
                    : isCurrent
                    ? "bg-white text-[#0D0437] border-[#0D0437]"
                    : "bg-white text-[#9CA3AF] border-[#E2E8F0]"
                )}
              >
                {isComplete ? (
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  step.number
                )}
              </div>

              {/* Step label */}
              <span
                className={cn(
                  "text-[13px] transition-colors",
                  isComplete || isCurrent
                    ? "font-semibold text-[#0D0437]"
                    : "font-normal text-[#9CA3AF]",
                  // Subtle open-tab underline when this step owns a visible sub-stepper
                  isCurrent && "underline underline-offset-[5px] decoration-[#0D0437]/25 decoration-1"
                )}
              >
                {step.label}
              </span>
            </button>

            {/* Connector */}
            {i < steps.length - 1 && (
              <div
                className={cn(
                  "h-px w-8 ml-2 transition-colors",
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
