import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { queryId } = await request.json() as { queryId: string };
    if (!queryId) return NextResponse.json({ error: "queryId required" }, { status: 400 });

    // Ownership check on the session client so RLS scopes the read to the user's own data.
    // We need to confirm the query belongs to a client this user owns before writing.
    const { data: queryRow, error: qErr } = await supabase
      .from("queries")
      .select("id, client_id")
      .eq("id", queryId)
      .single();

    if (qErr || !queryRow) return NextResponse.json({ error: "Query not found" }, { status: 404 });

    const { data: clientRow } = await supabase
      .from("clients")
      .select("user_id")
      .eq("id", queryRow.client_id)
      .single();

    const isOwner = clientRow?.user_id === user.id;
    if (!isOwner) {
      const { count } = await supabase
        .from("user_clients")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("client_id", queryRow.client_id);
      if (!count || count === 0) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Use service client for the write — session clients are subject to RLS and silently
    // return success with 0 rows updated when the policy filters out the target row.
    const svc = createServiceClient();
    const { error: updateError } = await svc
      .from("queries")
      .update({ status: "inactive", deactivated_at: new Date().toISOString() })
      .eq("id", queryId);

    if (updateError) {
      console.error("[queries/deactivate] DB update failed:", updateError.message, { queryId });
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[queries/deactivate] Unhandled error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
