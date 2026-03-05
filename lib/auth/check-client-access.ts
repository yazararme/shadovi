import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Check if an authenticated user has access to a client, either through
 * direct ownership (clients.user_id) or the user_clients junction table.
 *
 * Uses the session-scoped supabase client so RLS applies to the lookups.
 * Call this before any service-client write to verify access.
 */
export async function userHasClientAccess(
  supabase: SupabaseClient,
  userId: string,
  clientId: string
): Promise<boolean> {
  // Path 1: direct ownership (admin/owner accounts)
  const { data: owned } = await supabase
    .from("clients")
    .select("id")
    .eq("id", clientId)
    .eq("user_id", userId)
    .maybeSingle();

  if (owned) return true;

  // Path 2: junction table (beta users mapped via admin panel)
  const { count } = await supabase
    .from("user_clients")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("client_id", clientId);

  return (count ?? 0) > 0;
}
