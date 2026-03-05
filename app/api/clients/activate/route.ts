import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { userHasClientAccess } from "@/lib/auth/check-client-access";
import type { LLMModel } from "@/types";

// Activates a client and persists tracking config.
// Uses createServiceClient for the DB write so RLS cannot silently drop the update —
// session-based clients return error=null with 0 rows when RLS filters the row out.
// The user is authenticated (and owns the client) before the service write runs.
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { clientId, selectedModels, selectedFrequency } = await request.json() as {
      clientId: string;
      selectedModels: LLMModel[];
      selectedFrequency: string;
    };

    if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

    // Verify access (direct ownership or user_clients junction) before service-role write
    const hasAccess = await userHasClientAccess(supabase, user.id, clientId);
    if (!hasAccess) return NextResponse.json({ error: "Client not found or access denied" }, { status: 403 });

    // Service client bypasses RLS — safe because ownership is already confirmed above
    const svc = createServiceClient();
    const { error } = await svc
      .from("clients")
      .update({ status: "active", selected_models: selectedModels, tracking_frequency: selectedFrequency })
      .eq("id", clientId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
