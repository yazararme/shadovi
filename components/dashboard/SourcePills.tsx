"use client";

import { useState } from "react";

interface SourceItem {
  url: string;
  domain: string;
}

/** Google S2 favicon with initial-letter fallback */
function FaviconImg({ domain }: { domain: string }) {
  const [errored, setErrored] = useState(false);
  const src = `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
  if (errored) {
    return (
      <div className="w-4 h-4 rounded-sm bg-[#E2E8F0] flex items-center justify-center shrink-0">
        <span className="text-[8px] font-bold text-[#6B7280] uppercase">{domain[0]}</span>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={domain}
      width={16}
      height={16}
      className="w-4 h-4 rounded-sm shrink-0"
      onError={() => setErrored(true)}
    />
  );
}

/**
 * Horizontal favicon pill chips for source URLs.
 * Shows favicon + domain, clickable with full-URL tooltip.
 */
export function SourcePills({
  sources,
  label = true,
}: {
  sources: SourceItem[];
  /** Show the "SOURCES" label above the pills. Default true. */
  label?: boolean;
}) {
  if (sources.length === 0) return null;

  return (
    <div>
      {label && (
        <p className="text-[9px] font-medium tracking-[1.5px] uppercase text-[#9CA3AF] mb-1.5">
          Sources
        </p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {sources.map((s, i) => {
          const pill = (
            <span className="inline-flex items-center gap-1.5 bg-muted/50 border border-border rounded-full px-2 py-0.5 text-xs text-muted-foreground">
              <FaviconImg domain={s.domain} />
              <span className="leading-none">{s.domain}</span>
            </span>
          );

          return s.url ? (
            <a
              key={i}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              title={s.url}
              className="no-underline hover:opacity-80 transition-opacity"
            >
              {pill}
            </a>
          ) : (
            <span key={i} title={s.domain}>
              {pill}
            </span>
          );
        })}
      </div>
    </div>
  );
}
