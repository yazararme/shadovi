import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Returns { ready: true } when at least one pending_approval query exists for this client.
// Called by the discover page loading screen every 3s to know when to redirect.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ ready: false });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { count } = await supabase
    .from("queries")
    .select("*", { count: "exact", head: true })
    .eq("client_id", clientId)
    .eq("status", "pending_approval");

  return NextResponse.json({ ready: (count ?? 0) > 0 });
}
