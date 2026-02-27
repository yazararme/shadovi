"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, Suspense } from "react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import {
  BarChart2,
  FileText,
  Swords,
  Map,
  LogOut,
  ChevronDown,
  Building2,
  Brain,
  Globe,
  List,
} from "lucide-react";
import type { Client } from "@/types";

const navItems = [
  { href: "/overview", label: "Overview", icon: BarChart2 },
  { href: "/narrative", label: "Competitive Gaps", icon: FileText },
  { href: "/competitive", label: "Unaided Visibility", icon: Swords },
  { href: "/knowledge", label: "Brand Knowledge", icon: Brain },
  { href: "/sources", label: "Source Intelligence", icon: Globe },
  { href: "/runs", label: "Query Runs", icon: List },
  { href: "/blueprint", label: "Roadmap", icon: Map },
];

// Merged into one component so we only call useSearchParams once (requires a single Suspense boundary)
function SidebarInner({ onSignOut }: { onSignOut: () => void }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [clients, setClients] = useState<Client[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const currentClientId = searchParams.get("client");
  const currentClient =
    clients.find((c) => c.id === currentClientId) ?? clients[0] ?? null;

  // Append ?client=ID to every nav link so the selection persists across pages
  const clientParam = currentClient ? `?client=${currentClient.id}` : "";

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("clients")
      .select("id, brand_name, url, status")
      .in("status", ["active", "onboarding"])
      .order("created_at", { ascending: false })
      .then(({ data }) => setClients((data as Client[]) ?? []));
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
    // Navigate to current page with new client param
    router.push(`${pathname}?client=${id}`);
  }

  return (
    <>
      {/* Company switcher */}
      {clients.length > 0 && currentClient && (
        <div ref={ref} className="relative px-3 mb-4">
          <button
            onClick={() => setOpen(!open)}
            className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md bg-white/8 hover:bg-white/12 transition-colors text-left"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Building2 className="h-3.5 w-3.5 text-white/50 shrink-0" />
              <span className="text-[12px] font-medium text-white/80 truncate">
                {currentClient.brand_name ?? currentClient.url}
              </span>
            </div>
            <ChevronDown
              className={cn(
                "h-3 w-3 text-white/40 shrink-0 transition-transform duration-150",
                open && "rotate-180"
              )}
            />
          </button>

          {open && (
            <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-[#1a1150] border border-white/10 rounded-md shadow-xl overflow-hidden">
              {clients.map((client) => (
                <button
                  key={client.id}
                  onClick={() => selectClient(client.id)}
                  className={cn(
                    "w-full text-left px-3 py-2 text-[12px] transition-colors hover:bg-white/8 truncate",
                    client.id === currentClient.id
                      ? "text-white font-semibold"
                      : "text-white/60"
                  )}
                >
                  {client.brand_name ?? client.url}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Nav — links carry the ?client param so selection survives page navigation */}
      <nav className="flex-1 space-y-1">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={`${href}${clientParam}`}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-white/10 text-white"
                  : "text-white/60 hover:bg-white/8 hover:text-white"
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Sign out */}
      <button
        onClick={onSignOut}
        className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-white/60 hover:bg-white/8 hover:text-white transition-colors w-full"
      >
        <LogOut className="h-4 w-4" />
        Sign out
      </button>
    </>
  );
}

export function Sidebar() {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <aside className="flex h-screen w-56 flex-col bg-[#0D0437] px-3 py-4 print:hidden">
      {/* Logo lockup */}
      <div className="flex items-center gap-2 px-3 py-2 mb-5">
        <span className="font-exo2 font-black text-[24px] leading-none tracking-tight text-white">
          Shadovi
        </span>
      </div>

      <Suspense fallback={<div className="flex-1" />}>
        <SidebarInner onSignOut={handleSignOut} />
      </Suspense>
    </aside>
  );
}
