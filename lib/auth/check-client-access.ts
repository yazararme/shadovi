import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

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

// ── Role-based access ────────────────────────────────────────────────────────

/**
 * Resolve the authenticated user's role for a specific client.
 *
 * Resolution order (first match wins):
 * 1. Site-level admin (ADMIN_EMAIL env var) → 'admin'
 * 2. Direct owner (clients.user_id) → 'admin'
 * 3. Junction table (user_clients — matched by user_id OR email) → row's role
 * 4. No match → null
 *
 * Uses session client for auth, service client for lookups to avoid RLS edge cases.
 */
export async function getUserClientRole(
  clientId: string
): Promise<{ role: "admin" | "viewer" | null; user: { id: string; email: string } }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { role: null, user: { id: "", email: "" } };

  const userInfo = { id: user.id, email: user.email ?? "" };

  // 1. Site-level admin — the super-admin for all clients
  const adminEmail = process.env.ADMIN_EMAIL;
  if (adminEmail && userInfo.email === adminEmail) {
    return { role: "admin", user: userInfo };
  }

  const svc = createServiceClient();

  // 2. Direct owner
  const { data: owned } = await svc
    .from("clients")
    .select("id")
    .eq("id", clientId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (owned) return { role: "admin", user: userInfo };

  // 3. Junction table — match by user_id OR email (handles pre-signup invites)
  const { data: mapping } = await svc
    .from("user_clients")
    .select("role")
    .eq("client_id", clientId)
    .or(`user_id.eq.${user.id},email.eq.${userInfo.email}`)
    .maybeSingle();

  if (mapping) return { role: mapping.role as "admin" | "viewer", user: userInfo };

  // 4. No access
  return { role: null, user: userInfo };
}

/**
 * Guard for mutation routes — returns the user if admin, or a 403 NextResponse.
 *
 * Usage:
 *   const roleCheck = await requireAdminRole(clientId);
 *   if (roleCheck instanceof NextResponse) return roleCheck;
 *   // roleCheck.user is available downstream
 */
export async function requireAdminRole(
  clientId: string
): Promise<NextResponse | { user: { id: string; email: string } }> {
  const { role, user } = await getUserClientRole(clientId);

  if (role === "admin") return { user };
  if (role === "viewer") {
    return NextResponse.json(
      { error: "Viewer accounts cannot perform this action" },
      { status: 403 }
    );
  }
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
