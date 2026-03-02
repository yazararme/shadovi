import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

const ADMIN_EMAIL = "yazararme@gmail.com";

export async function GET() {
  // Verify the requesting user is the admin
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user || user.email !== ADMIN_EMAIL) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = createServiceClient();

  // ── 1. All clients ───────────────────────────────────────────────────────────
  const { data: clients, error: clientsError } = await supabase
    .from("clients")
    .select("*")
    .order("created_at", { ascending: false });

  if (clientsError) {
    return NextResponse.json({ error: clientsError.message }, { status: 500 });
  }

  // ── 2. Run counts — one HEAD request per client (N is small) ─────────────────
  const runCountResults = await Promise.all(
    (clients ?? []).map(async (c) => {
      const { count } = await supabase
        .from("tracking_runs")
        .select("*", { count: "exact", head: true })
        .eq("client_id", c.id);
      return { clientId: c.id, count: count ?? 0 };
    })
  );
  const runCountMap = Object.fromEntries(
    runCountResults.map((r) => [r.clientId, r.count])
  );

  // ── 3. Mapping counts — fetch all client_ids, count in JS ────────────────────
  const { data: ucClientIds } = await supabase
    .from("user_clients")
    .select("client_id");
  const mappingCountMap: Record<string, number> = {};
  for (const row of ucClientIds ?? []) {
    mappingCountMap[row.client_id] = (mappingCountMap[row.client_id] ?? 0) + 1;
  }

  // ── 4. User-client mappings with brand name ───────────────────────────────────
  const { data: mappings } = await supabase
    .from("user_clients")
    .select("id, user_id, email, client_id, role, created_at, clients(brand_name)")
    .order("created_at", { ascending: false });

  // ── 5. Recent tracking runs ───────────────────────────────────────────────────
  const { data: recentRuns } = await supabase
    .from("tracking_runs")
    .select("id, ran_at, model, query_intent, mention_sentiment, client_id, clients(brand_name)")
    .order("ran_at", { ascending: false })
    .limit(50);

  return NextResponse.json({
    clients: (clients ?? []).map((c) => ({
      ...c,
      runCount:     runCountMap[c.id]     ?? 0,
      mappingCount: mappingCountMap[c.id] ?? 0,
    })),
    mappings:    mappings    ?? [],
    recentRuns:  recentRuns  ?? [],
  });
}
