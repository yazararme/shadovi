import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generatePersonas } from "@/lib/synthetic-buyer/persona-generator";
import type { ClientContext } from "@/types";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { clientId } = await request.json() as { clientId: string };
    if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

    // Fetch client — verify ownership via RLS
    const { data: client, error: clientError } = await supabase
      .from("clients")
      .select("*")
      .eq("id", clientId)
      .single();

    if (clientError || !client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    if (!client.brand_dna) {
      return NextResponse.json({ error: "Client has no brand DNA yet" }, { status: 400 });
    }

    const ctx: ClientContext = {
      client,
      personas: [],
      competitors: [],
      brandDNA: client.brand_dna,
    };

    const personas = await generatePersonas(ctx);

    // Delete any existing personas for this client then re-insert
    await supabase.from("personas").delete().eq("client_id", clientId);

    const { data: inserted, error: insertError } = await supabase
      .from("personas")
      .insert(personas.map((p) => ({ ...p, client_id: clientId })))
      .select();

    if (insertError) throw new Error(`DB insert error: ${insertError.message}`);

    return NextResponse.json({ personas: inserted });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
