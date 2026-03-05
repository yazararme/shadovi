"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import {
  ChevronDown, ChevronRight, LogOut,
  Map, LayoutDashboard, Signal, AudioWaveform, Brain, Globe, Activity, Settings,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useClientContext } from "@/context/ClientContext";

// ── Brand tokens ──────────────────────────────────────────────────────────────
const BRAND_GRADIENT = "linear-gradient(135deg, #FF4B6E, #00B4D8)";
const ACCENT_GRADIENT = "linear-gradient(to bottom, #FF4B6E, #00B4D8)";

// ── Nav structure ─────────────────────────────────────────────────────────────
const NAV_GROUPS: {
  label: string;
  items: { href: string; label: string; Icon: LucideIcon }[];
}[] = [
  {
    label: "ACTION CENTER",
    items: [
      { href: "/dashboard/roadmap",         label: "AEO Roadmap",       Icon: Map },
    ],
  },
  {
    label: "PERFORMANCE",
    items: [
      { href: "/dashboard/overview",        label: "Overview",          Icon: LayoutDashboard },
      { href: "/dashboard/share-of-voice",  label: "AI Share of Voice", Icon: Signal },
      { href: "/dashboard/tone-of-voice",   label: "AI Tone of Voice",  Icon: AudioWaveform },
    ],
  },
  {
    label: "DIAGNOSTICS",
    items: [
      { href: "/dashboard/brand-knowledge",    label: "Brand Knowledge",    Icon: Brain },
      { href: "/dashboard/source-intelligence",label: "Source Intelligence", Icon: Globe },
      { href: "/dashboard/query-runs",         label: "Query Runs",          Icon: Activity },
    ],
  },
  {
    label: "ACCOUNT",
    items: [
      { href: "/dashboard/settings", label: "Tracking Setup", Icon: Settings },
    ],
  },
];

// ── Inner component ───────────────────────────────────────────────────────────

function SidebarInner({ onSignOut }: { onSignOut: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { activeClientId, setActiveClientId, accessibleClients, isAdmin } = useClientContext();
  const [open, setOpen] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const currentClient =
    accessibleClients.find((c) => c.id === activeClientId) ??
    accessibleClients[0] ??
    null;

  const clientParam  = currentClient ? `?client=${currentClient.id}` : "";
  const showSelector = isAdmin || accessibleClients.length > 1;
  const brandInitial = currentClient?.brand_name?.[0]?.toUpperCase() ?? "?";
  const userInitial  = (userEmail?.[0] ?? "U").toUpperCase();

  // Fetch authenticated user email for the footer zone
  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => {
      setUserEmail(data.user?.email ?? null);
    });
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function selectClient(id: string) {
    setOpen(false);
    setActiveClientId(id);
    router.push(`${pathname}?client=${id}`);
  }

  return (
    <>
      {/* ── Workspace / brand switcher ─────────────────────────────────────── */}
      {currentClient && (
        <div ref={ref} className="relative px-3 pb-3 mb-1 border-b border-white/10">
          {showSelector ? (
            <>
              <button
                onClick={() => setOpen(!open)}
                className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-white/5 transition-colors duration-[120ms] text-left"
              >
                {/* Brand initial avatar */}
                <span
                  className="h-6 w-6 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0"
                  style={{ background: BRAND_GRADIENT }}
                >
                  {brandInitial}
                </span>
                <span className="flex-1 text-[14px] font-medium text-white/90 truncate leading-none">
                  {currentClient.brand_name}
                </span>
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 text-white/35 shrink-0 transition-transform duration-150",
                    open && "rotate-180"
                  )}
                  strokeWidth={1.5}
                />
              </button>

              {open && (
                <div
                  className="absolute left-3 right-3 top-full mt-1 z-50 border border-white/10 rounded-md shadow-xl overflow-hidden"
                  style={{ background: "#182030" }}
                >
                  {accessibleClients.map((client) => (
                    <button
                      key={client.id}
                      onClick={() => selectClient(client.id)}
                      className={cn(
                        "w-full flex items-center gap-2 text-left px-3 py-2 text-[12px] transition-colors hover:bg-white/8",
                        client.id === currentClient.id
                          ? "text-white"
                          : "text-white/55"
                      )}
                    >
                      <span
                        className="h-4 w-4 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0"
                        style={{ background: BRAND_GRADIENT }}
                      >
                        {client.brand_name?.[0]?.toUpperCase()}
                      </span>
                      <span className="truncate">{client.brand_name}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            /* Static label for single-client non-admin */
            <div className="flex items-center gap-2.5 px-2 py-1.5">
              <span
                className="h-6 w-6 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0"
                style={{ background: BRAND_GRADIENT }}
              >
                {brandInitial}
              </span>
              <span className="flex-1 text-[14px] font-medium text-white/90 truncate leading-none">
                {currentClient.brand_name}
              </span>
              <ChevronRight className="h-3.5 w-3.5 text-white/25 shrink-0" strokeWidth={1.5} />
            </div>
          )}
        </div>
      )}

      {/* ── Nav groups ────────────────────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto py-1">
        {NAV_GROUPS.map(({ label, items }, groupIdx) => {
          const groupHasActive = items.some(
            ({ href }) => pathname === href || pathname.startsWith(href + "/")
          );
          return (
            <div key={label} className={groupIdx === 0 ? "mt-2" : "mt-5"}>
              {/* Section label — structural, not navigational */}
              <p className="px-4 mb-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-white/45 select-none">
                {label}
              </p>

              {/* Items container — carries group context border when any item is active */}
              <div className="relative">
                {groupHasActive && (
                  <span className="absolute left-0 top-0 bottom-0 w-px bg-white/20" />
                )}
                <div className="space-y-1">
                  {items.map(({ href, label: itemLabel, Icon }) => {
                    const active = pathname === href || pathname.startsWith(href + "/");
                    return (
                      <div key={href} className="relative">
                        {/* 2px coral-to-cyan gradient accent bar for active item */}
                        {active && (
                          <span
                            className="absolute left-0 top-0 bottom-0 w-0.5 z-10"
                            style={{ background: ACCENT_GRADIENT }}
                          />
                        )}
                        <Link
                          href={`${href}${clientParam}`}
                          className={cn(
                            "flex items-center gap-2.5 py-2 pl-4 pr-3 text-[13px] transition-colors duration-[120ms]",
                            active
                              ? "bg-white/8 text-white"
                              : "text-white/55 hover:bg-white/5 hover:text-white/80"
                          )}
                        >
                          <Icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                          {itemLabel}
                        </Link>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </nav>

      {/* ── Admin link (admin-only) ────────────────────────────────────────── */}
      {isAdmin && (
        <div className="px-3 pb-1">
          <div className="relative">
            {pathname === "/admin" && (
              <span
                className="absolute left-0 top-0 bottom-0 w-0.5"
                style={{ background: ACCENT_GRADIENT }}
              />
            )}
            <Link
              href="/admin"
              className={cn(
                "flex items-center py-1.5 pl-4 pr-3 text-[12px] transition-colors duration-[120ms]",
                pathname === "/admin"
                  ? "bg-white/8 text-white"
                  : "text-white/28 hover:bg-white/5 hover:text-white/55"
              )}
            >
              Admin
            </Link>
          </div>
        </div>
      )}

      {/* ── Footer zone: user avatar + email + sign out ────────────────────── */}
      <div className="border-t border-white/15 px-4 py-2 mt-1">
        <div className="flex items-center gap-2.5">
          {/* User initial avatar */}
          <span
            className="h-6 w-6 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0"
            style={{ background: BRAND_GRADIENT }}
          >
            {userInitial}
          </span>
          {/* Truncated email */}
          <span className="flex-1 text-[11px] text-white/45 truncate leading-none min-w-0">
            {userEmail ?? "…"}
          </span>
          {/* Sign out icon */}
          <button
            onClick={onSignOut}
            aria-label="Sign out"
            className="shrink-0 text-white/30 hover:text-white/70 transition-colors duration-[120ms] p-0.5 rounded"
          >
            <LogOut className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
        </div>
      </div>
    </>
  );
}

// ── Sidebar shell ─────────────────────────────────────────────────────────────

export function DashboardSidebar() {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <aside className="flex h-screen w-[210px] flex-col bg-[#0F1623] py-4 print:hidden shrink-0">
      {/* Logo lockup */}
      <div className="px-5 pt-1 pb-3">
        <span className="font-exo2 font-black text-[22px] leading-none tracking-tight text-white">
          Shadovi
        </span>
      </div>

      <SidebarInner onSignOut={handleSignOut} />
    </aside>
  );
}
