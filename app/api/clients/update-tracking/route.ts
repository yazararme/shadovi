import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { userHasClientAccess } from "@/lib/auth/check-client-access";
import type { LLMModel } from "@/types";

// Persists tracking config (models + frequency) to the clients table.
// Uses service client so RLS cannot silently swallow the write — the session
// client's UPDATE policy requires user_id = auth.uid(), which blocks beta users.
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { clientId, selectedModels, trackingFrequency } = await request.json() as {
      clientId: string;
      selectedModels: LLMModel[];
      trackingFrequency: "daily" | "weekly" | "monthly";
    };

    if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });
    if (!selectedModels?.length) return NextResponse.json({ error: "At least one model required" }, { status: 400 });

    const hasAccess = await userHasClientAccess(supabase, user.id, clientId);
    if (!hasAccess) return NextResponse.json({ error: "Client not found or access denied" }, { status: 403 });

    const svc = createServiceClient();
    const { error } = await svc
      .from("clients")
      .update({ selected_models: selectedModels, tracking_frequency: trackingFrequency })
      .eq("id", clientId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
