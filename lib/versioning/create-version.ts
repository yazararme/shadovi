// Creates a new portfolio version for a client and deactivates the previous one.
// Called at every trigger point: onboarding activation, query regeneration, settings edit.
// This function ONLY manages portfolio_versions rows — it does NOT modify queries,
// brand_facts, or any other table. The caller is responsible for stamping version_id
// on entities after calling this function.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { VersionTrigger } from "@/types";

export interface CreateVersionResult {
  versionId: string;
  versionNumber: number;
}

export async function createPortfolioVersion(
  clientId: string,
  trigger: VersionTrigger,
  supabase: SupabaseClient
): Promise<CreateVersionResult> {
  // 1. Fetch the current active version (if any)
  const { data: currentVersion } = await supabase
    .from("portfolio_versions")
    .select("id, version_number, query_count, fact_count")
    .eq("client_id", clientId)
    .eq("is_active", true)
    .limit(1)
    .single();

  // 2. Deactivate the current version before creating the next one
  if (currentVersion) {
    await supabase
      .from("portfolio_versions")
      .update({ is_active: false })
      .eq("id", currentVersion.id);
  }

  // 3. Snapshot current entity counts for the new version row
  const [{ count: queryCount }, { count: factCount }] = await Promise.all([
    supabase
      .from("queries")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId)
      .in("status", ["pending_approval", "active"]),
    supabase
      .from("brand_facts")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId),
  ]);

  // 4. Compute change_summary relative to the previous version
  const changeSummary = currentVersion
    ? {
        queries_added:       Math.max(0, (queryCount ?? 0) - currentVersion.query_count),
        queries_removed:     Math.max(0, currentVersion.query_count - (queryCount ?? 0)),
        facts_changed:       [] as string[],
        competitors_changed: [] as string[],
      }
    : null;

  // 5. Insert the new active version
  const nextVersionNumber = currentVersion ? currentVersion.version_number + 1 : 1;
  const { data: newVersion, error } = await supabase
    .from("portfolio_versions")
    .insert({
      client_id:      clientId,
      version_number: nextVersionNumber,
      trigger,
      change_summary: changeSummary,
      query_count:    queryCount ?? 0,
      fact_count:     factCount ?? 0,
      is_active:      true,
    })
    .select("id, version_number")
    .single();

  if (error || !newVersion) {
    throw new Error(`createPortfolioVersion failed: ${error?.message ?? "no row returned"}`);
  }

  return { versionId: newVersion.id, versionNumber: newVersion.version_number };
}
