"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { createClient } from "@/lib/supabase/client";
import type { Client } from "@/types";

// Hardcoded admin email — must match the value in .env.local ADMIN_EMAIL
// and supabase/migrations/010_user_clients.sql
const ADMIN_EMAIL = "yazararme@gmail.com";

// ─── Types ────────────────────────────────────────────────────────────────────

type AccessibleClient = Pick<Client, "id" | "brand_name" | "status">;

interface ClientContextValue {
  activeClientId: string | null;
  setActiveClientId: (id: string) => void;
  accessibleClients: AccessibleClient[];
  isAdmin: boolean;
  /** True while the initial user_clients fetch is in flight */
  loading: boolean;
}

const defaultValue: ClientContextValue = {
  activeClientId: null,
  setActiveClientId: () => {},
  accessibleClients: [],
  isAdmin: false,
  loading: true,
};

const ClientContext = createContext<ClientContextValue>(defaultValue);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function ClientContextProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [activeClientId, setActiveClientIdState] = useState<string | null>(null);
  const [accessibleClients, setAccessibleClients] = useState<AccessibleClient[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Read the ?client= URL param directly from the browser — synchronous,
    // no useSearchParams / Suspense needed.
    const urlClientId =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("client")
        : null;

    resolveClients(urlClientId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function resolveClients(urlClientId: string | null) {
    setLoading(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) return;

      const admin = user.email === ADMIN_EMAIL;
      setIsAdmin(admin);

      let clients: AccessibleClient[];

      if (admin) {
        // Admin sees every client directly from the clients table
        const { data } = await supabase
          .from("clients")
          .select("id, brand_name, status")
          .order("created_at", { ascending: false });
        clients = (data ?? []) as AccessibleClient[];
      } else {
        // Regular users: resolve via user_clients junction table.
        // Rows can be matched by user_id (post-signup) or email (pre-signup invite).
        const { data: ucRows } = await supabase
          .from("user_clients")
          .select("id, user_id, email, clients(id, brand_name, status)")
          .or(`user_id.eq.${user.id},email.eq.${user.email ?? ""}`);

        // Backfill user_id for rows that were mapped by email before the user
        // signed up — ensures future queries match on user_id.
        const emailOnlyRows = (ucRows ?? []).filter(
          (r) => !r.user_id && r.email === user.email
        );
        if (emailOnlyRows.length > 0) {
          await supabase
            .from("user_clients")
            .update({ user_id: user.id })
            .in("id", emailOnlyRows.map((r) => r.id));
        }

        // Supabase infers FK-joined tables as arrays in its TS types even for
        // many-to-one relations; cast via unknown to the real shape.
        clients = (ucRows ?? [])
          .map((r) => r.clients as unknown as AccessibleClient | null)
          .filter((c): c is AccessibleClient => c !== null);
      }

      setAccessibleClients(clients);

      // Seed active client: prefer the URL param when it points to an accessible
      // client, otherwise fall back to the first accessible client.
      const fromUrl =
        urlClientId && clients.some((c) => c.id === urlClientId)
          ? urlClientId
          : (clients[0]?.id ?? null);
      setActiveClientIdState(fromUrl);
    } finally {
      setLoading(false);
    }
  }

  const setActiveClientId = useCallback((id: string) => {
    setActiveClientIdState(id);
  }, []);

  return (
    <ClientContext.Provider
      value={{ activeClientId, setActiveClientId, accessibleClients, isAdmin, loading }}
    >
      {children}
    </ClientContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useClientContext() {
  return useContext(ClientContext);
}
