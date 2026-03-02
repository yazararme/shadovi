import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

const ADMIN_EMAIL = "yazararme@gmail.com";

export async function POST(request: Request) {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user || user.email !== ADMIN_EMAIL) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { email, client_id, role } = await request.json() as {
    email: string;
    client_id: string;
    role: "admin" | "viewer";
  };

  if (!email || !client_id || !role) {
    return NextResponse.json({ error: "email, client_id, and role are required" }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { error } = await supabase
    .from("user_clients")
    .insert({ email: email.toLowerCase().trim(), client_id, role });

  if (error) {
    // Postgres unique violation (user already mapped to this client)
    if (error.code === "23505") {
      return NextResponse.json({ error: "duplicate" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
