// Temporary route — call this once to cluster existing gap data without a full tracking run.
// DELETE this file once gap_clusters is populated.
import { NextResponse } from "next/server";
import { clusterGapsForClient } from "@/lib/tracking/gap-clusterer";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const clientId = body.clientId ?? process.env.BEKO_CLIENT_ID;
  if (!clientId) return NextResponse.json({ error: "clientId required (or set BEKO_CLIENT_ID in .env.local)" }, { status: 400 });

  await clusterGapsForClient(clientId);
  return NextResponse.json({ ok: true, clientId });
}
