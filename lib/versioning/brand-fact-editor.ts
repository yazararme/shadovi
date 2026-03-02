// Brand fact lifecycle helpers.
//
// Edits are treated as delete + create rather than in-place updates so that
// historical tracking_runs and brand_knowledge_scores linked to the old fact_id
// remain valid. The old row is soft-deactivated; a new row is inserted with the
// current active version_id stamped on it.
//
// These functions are called by API routes — no UI exists yet for post-activation
// brand fact editing, but the pattern is established here for when it is built.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { BrandFactCategory } from "@/types";

// Returns the id of the currently active portfolio version for a client.
// Throws if no active version exists — callers must ensure activation has happened.
async function getActiveVersionId(clientId: string, supabase: SupabaseClient): Promise<string> {
  const { data, error } = await supabase
    .from("portfolio_versions")
    .select("id")
    .eq("client_id", clientId)
    .eq("is_active", true)
    .limit(1)
    .single();

  if (error || !data) {
    throw new Error(`No active portfolio version found for client ${clientId}: ${error?.message ?? "no row"}`);
  }
  return data.id;
}

// Add a new brand fact, stamped with the current active version.
export async function addBrandFact(
  clientId: string,
  claim: string,
  category: BrandFactCategory,
  isTrue: boolean,
  supabase: SupabaseClient
): Promise<{ id: string }> {
  const versionId = await getActiveVersionId(clientId, supabase);

  const { data, error } = await supabase
    .from("brand_facts")
    .insert({ client_id: clientId, claim, category, is_true: isTrue, version_id: versionId, status: "active" })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`addBrandFact failed: ${error?.message ?? "no row returned"}`);
  }
  return { id: data.id };
}

// Edit a brand fact: soft-deactivate the old row, insert a new one with updated fields.
// Returns the id of the newly created fact row.
export async function editBrandFact(
  clientId: string,
  oldFactId: string,
  updates: { claim?: string; category?: BrandFactCategory; isTrue?: boolean },
  supabase: SupabaseClient
): Promise<{ newFactId: string }> {
  const versionId = await getActiveVersionId(clientId, supabase);

  // 1. Fetch the old fact to carry forward unchanged fields
  const { data: oldFact, error: fetchError } = await supabase
    .from("brand_facts")
    .select("claim, category, is_true")
    .eq("id", oldFactId)
    .single();

  if (fetchError || !oldFact) {
    throw new Error(`editBrandFact: old fact ${oldFactId} not found`);
  }

  // 2. Soft-deactivate the old row
  const { error: deactivateError } = await supabase
    .from("brand_facts")
    .update({ status: "inactive", deactivated_at: new Date().toISOString() })
    .eq("id", oldFactId);

  if (deactivateError) {
    throw new Error(`editBrandFact: deactivation failed: ${deactivateError.message}`);
  }

  // 3. Insert the replacement row, merging the provided updates with the old values
  const { data: newFact, error: insertError } = await supabase
    .from("brand_facts")
    .insert({
      client_id: clientId,
      claim: updates.claim ?? oldFact.claim,
      category: updates.category ?? oldFact.category,
      is_true: updates.isTrue ?? oldFact.is_true,
      version_id: versionId,
      status: "active",
    })
    .select("id")
    .single();

  if (insertError || !newFact) {
    throw new Error(`editBrandFact: insert failed: ${insertError?.message ?? "no row returned"}`);
  }

  return { newFactId: newFact.id };
}

// Remove a brand fact by soft-deactivating it.
// Does not insert a replacement — the claim is simply no longer active.
export async function removeBrandFact(
  factId: string,
  supabase: SupabaseClient
): Promise<void> {
  const { error } = await supabase
    .from("brand_facts")
    .update({ status: "inactive", deactivated_at: new Date().toISOString() })
    .eq("id", factId);

  if (error) {
    throw new Error(`removeBrandFact failed: ${error.message}`);
  }
}
