"use client";

// React hook for reading the currently active portfolio version for a client.
// Used by the sidebar indicator and any component that needs version metadata
// without owning the full data-loading lifecycle.
//
// For dashboard pages that do their own async data loading, the version fetch
// is inlined in the load function rather than going through this hook, so
// the version ID is available before the parallel Supabase queries fire.

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

export interface ActiveVersion {
  id: string;
  version_number: number;
  created_at: string;
}

export function useActiveVersion(clientId: string | null | undefined): {
  activeVersion: ActiveVersion | null;
  loading: boolean;
} {
  const [activeVersion, setActiveVersion] = useState<ActiveVersion | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!clientId) {
      setActiveVersion(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    const supabase = createClient();
    supabase
      .from("portfolio_versions")
      .select("id, version_number, created_at")
      .eq("client_id", clientId)
      .eq("is_active", true)
      .limit(1)
      .single()
      .then(({ data }) => {
        setActiveVersion(data ?? null);
        setLoading(false);
      });
  }, [clientId]);

  return { activeVersion, loading };
}
